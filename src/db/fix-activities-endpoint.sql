-- Fix activities endpoint by ensuring proper database structure
-- Run this in Supabase SQL Editor

-- First, let's check what tables we have
DO $$ 
BEGIN
    RAISE NOTICE 'Checking existing tables...';
    
    -- Check for plan_node_logs
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'plan_node_logs') THEN
        RAISE NOTICE 'Table plan_node_logs exists';
    ELSE
        RAISE NOTICE 'Table plan_node_logs does NOT exist';
    END IF;
    
    -- Check for plan_comments
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'plan_comments') THEN
        RAISE NOTICE 'Table plan_comments exists';
    ELSE
        RAISE NOTICE 'Table plan_comments does NOT exist';
    END IF;
    
    -- Check for plan_node_artifacts
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'plan_node_artifacts') THEN
        RAISE NOTICE 'Table plan_node_artifacts exists';
    ELSE
        RAISE NOTICE 'Table plan_node_artifacts does NOT exist';
    END IF;
    
    -- Check for node_assignments
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'node_assignments') THEN
        RAISE NOTICE 'Table node_assignments exists';
    ELSE
        RAISE NOTICE 'Table node_assignments does NOT exist';
    END IF;
END $$;

-- Create node_assignments table if it doesn't exist
CREATE TABLE IF NOT EXISTS node_assignments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    node_id UUID NOT NULL REFERENCES plan_nodes(id) ON DELETE CASCADE,
    user_id UUID NOT NULL,
    assigned_by UUID,
    assigned_at TIMESTAMPTZ DEFAULT NOW(),
    role TEXT DEFAULT 'assignee',
    UNIQUE(node_id, user_id)
);

-- Create index for better query performance
CREATE INDEX IF NOT EXISTS idx_node_assignments_node_id ON node_assignments(node_id);
CREATE INDEX IF NOT EXISTS idx_node_assignments_user_id ON node_assignments(user_id);

-- Create a view for assignments with user info if auth.users is accessible
-- This is optional and might fail if auth.users is not accessible
DO $$ 
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables 
               WHERE table_schema = 'auth' AND table_name = 'users') THEN
        
        -- Drop view if it exists
        DROP VIEW IF EXISTS node_assignments_with_users CASCADE;
        
        -- Create the view
        EXECUTE '
        CREATE VIEW node_assignments_with_users AS
        SELECT 
            na.*,
            u.email as user_email,
            u.raw_user_meta_data->>''name'' as user_name,
            au.email as assigned_by_email,
            au.raw_user_meta_data->>''name'' as assigned_by_name
        FROM node_assignments na
        LEFT JOIN auth.users u ON na.user_id = u.id
        LEFT JOIN auth.users au ON na.assigned_by = au.id';
        
        RAISE NOTICE 'Created view node_assignments_with_users';
    ELSE
        RAISE NOTICE 'Cannot create node_assignments_with_users view - auth.users not accessible';
    END IF;
END $$;

-- Create audit_logs table if it doesn't exist (for tracking status changes)
CREATE TABLE IF NOT EXISTS audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    resource_type TEXT NOT NULL, -- 'plan', 'node', etc.
    resource_id UUID NOT NULL,
    action TEXT NOT NULL, -- 'create', 'update', 'delete', 'status_change', etc.
    user_id UUID,
    details JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create index for audit logs
CREATE INDEX IF NOT EXISTS idx_audit_logs_resource ON audit_logs(resource_type, resource_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at DESC);

-- Grant necessary permissions for the service role
GRANT ALL ON node_assignments TO service_role;
GRANT ALL ON audit_logs TO service_role;

-- Grant permissions for authenticated users with RLS
ALTER TABLE node_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

-- RLS Policy for node_assignments: Users can see assignments for plans they have access to
CREATE POLICY "Users can view assignments for their plans" ON node_assignments
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM plan_nodes pn
            JOIN plans p ON pn.plan_id = p.id
            WHERE pn.id = node_assignments.node_id
            AND (
                p.owner_id = auth.uid()
                OR EXISTS (
                    SELECT 1 FROM plan_collaborators pc
                    WHERE pc.plan_id = p.id AND pc.user_id = auth.uid()
                )
            )
        )
    );

-- RLS Policy for node_assignments: Only plan owners and editors can create/update/delete assignments
CREATE POLICY "Plan owners and editors can manage assignments" ON node_assignments
    FOR ALL
    USING (
        EXISTS (
            SELECT 1 FROM plan_nodes pn
            JOIN plans p ON pn.plan_id = p.id
            WHERE pn.id = node_assignments.node_id
            AND (
                p.owner_id = auth.uid()
                OR EXISTS (
                    SELECT 1 FROM plan_collaborators pc
                    WHERE pc.plan_id = p.id 
                    AND pc.user_id = auth.uid()
                    AND pc.role IN ('admin', 'editor')
                )
            )
        )
    );

-- RLS Policy for audit_logs: Users can view logs for their resources
CREATE POLICY "Users can view audit logs for their resources" ON audit_logs
    FOR SELECT
    USING (
        CASE 
            WHEN resource_type = 'plan' THEN
                EXISTS (
                    SELECT 1 FROM plans p
                    WHERE p.id = audit_logs.resource_id
                    AND (
                        p.owner_id = auth.uid()
                        OR EXISTS (
                            SELECT 1 FROM plan_collaborators pc
                            WHERE pc.plan_id = p.id AND pc.user_id = auth.uid()
                        )
                    )
                )
            WHEN resource_type = 'node' THEN
                EXISTS (
                    SELECT 1 FROM plan_nodes pn
                    JOIN plans p ON pn.plan_id = p.id
                    WHERE pn.id = audit_logs.resource_id
                    AND (
                        p.owner_id = auth.uid()
                        OR EXISTS (
                            SELECT 1 FROM plan_collaborators pc
                            WHERE pc.plan_id = p.id AND pc.user_id = auth.uid()
                        )
                    )
                )
            ELSE false
        END
    );

-- Function to log status changes (optional, for better tracking)
CREATE OR REPLACE FUNCTION log_node_status_change()
RETURNS TRIGGER AS $$
BEGIN
    IF OLD.status IS DISTINCT FROM NEW.status THEN
        INSERT INTO audit_logs (resource_type, resource_id, action, user_id, details)
        VALUES (
            'node',
            NEW.id,
            'status_change',
            auth.uid(),
            jsonb_build_object(
                'from_status', OLD.status,
                'to_status', NEW.status,
                'node_title', NEW.title
            )
        );
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for status changes (optional)
DROP TRIGGER IF EXISTS log_node_status_changes ON plan_nodes;
CREATE TRIGGER log_node_status_changes
    AFTER UPDATE ON plan_nodes
    FOR EACH ROW
    EXECUTE FUNCTION log_node_status_change();

-- Verify the setup
SELECT 
    'Setup Complete' as status,
    (SELECT COUNT(*) FROM information_schema.tables WHERE table_name = 'node_assignments') as assignments_table_exists,
    (SELECT COUNT(*) FROM information_schema.tables WHERE table_name = 'audit_logs') as audit_logs_table_exists,
    (SELECT COUNT(*) FROM information_schema.views WHERE table_name = 'node_assignments_with_users') as assignments_view_exists;
