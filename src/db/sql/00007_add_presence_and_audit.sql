-- Create user_presence table for tracking real-time presence
CREATE TABLE IF NOT EXISTS user_presence (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    plan_id UUID NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
    node_id UUID REFERENCES plan_nodes(id) ON DELETE SET NULL,
    status VARCHAR(50) DEFAULT 'active' CHECK (status IN ('active', 'idle', 'away')),
    last_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    -- Ensure one presence record per user per plan
    UNIQUE(user_id, plan_id)
);

-- Create indexes for performance
CREATE INDEX idx_user_presence_user_id ON user_presence(user_id);
CREATE INDEX idx_user_presence_plan_id ON user_presence(plan_id);
CREATE INDEX idx_user_presence_node_id ON user_presence(node_id);
CREATE INDEX idx_user_presence_last_seen ON user_presence(last_seen);

-- Create audit_logs table if it doesn't exist (for tracking status changes)
CREATE TABLE IF NOT EXISTS audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id),
    action VARCHAR(100) NOT NULL,
    resource_type VARCHAR(50) NOT NULL,
    resource_id UUID NOT NULL,
    details JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Create indexes for audit logs
CREATE INDEX idx_audit_logs_user_id ON audit_logs(user_id);
CREATE INDEX idx_audit_logs_resource ON audit_logs(resource_type, resource_id);
CREATE INDEX idx_audit_logs_created_at ON audit_logs(created_at);

-- Function to automatically log status changes
CREATE OR REPLACE FUNCTION log_status_change() RETURNS TRIGGER AS $$
BEGIN
    IF OLD.status IS DISTINCT FROM NEW.status THEN
        INSERT INTO audit_logs (user_id, action, resource_type, resource_id, details)
        VALUES (
            auth.uid(),
            'status_change',
            'node',
            NEW.id,
            jsonb_build_object(
                'from_status', OLD.status,
                'to_status', NEW.status,
                'node_title', NEW.title
            )
        );
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create trigger for status changes
DROP TRIGGER IF EXISTS log_node_status_changes ON plan_nodes;
CREATE TRIGGER log_node_status_changes
    AFTER UPDATE ON plan_nodes
    FOR EACH ROW
    EXECUTE FUNCTION log_status_change();

-- RLS policies for user_presence
ALTER TABLE user_presence ENABLE ROW LEVEL SECURITY;

-- Users can view presence for plans they have access to
CREATE POLICY "Users can view presence" ON user_presence
    FOR SELECT USING (
        plan_id IN (
            SELECT id FROM plans WHERE owner_id = auth.uid()
            UNION
            SELECT plan_id FROM plan_collaborators WHERE user_id = auth.uid()
        )
    );

-- Users can update their own presence
CREATE POLICY "Users can update own presence" ON user_presence
    FOR ALL USING (user_id = auth.uid())
    WITH CHECK (user_id = auth.uid());

-- RLS policies for audit_logs
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

-- Users can view audit logs for resources they have access to
CREATE POLICY "Users can view audit logs" ON audit_logs
    FOR SELECT USING (
        (resource_type = 'node' AND resource_id IN (
            SELECT pn.id FROM plan_nodes pn
            JOIN plans p ON pn.plan_id = p.id
            WHERE p.owner_id = auth.uid()
            OR p.id IN (SELECT plan_id FROM plan_collaborators WHERE user_id = auth.uid())
        ))
        OR
        (resource_type = 'plan' AND resource_id IN (
            SELECT id FROM plans WHERE owner_id = auth.uid()
            UNION
            SELECT plan_id FROM plan_collaborators WHERE user_id = auth.uid()
        ))
    );

-- Function to clean up old presence records
CREATE OR REPLACE FUNCTION cleanup_old_presence() RETURNS void AS $$
BEGIN
    DELETE FROM user_presence 
    WHERE last_seen < NOW() - INTERVAL '1 hour';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
