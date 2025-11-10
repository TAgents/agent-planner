-- ============================================================================
-- Agent Planner Database Schema - Complete Clean Install
-- ============================================================================
-- This file contains the complete database schema for Agent Planner
-- It can be run on a fresh Supabase database to set up everything needed
-- ============================================================================

-- ============================================================================
-- EXTENSIONS
-- ============================================================================
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================================
-- TABLES
-- ============================================================================

-- Users table
-- Note: Actual user authentication is handled by Supabase Auth
CREATE TABLE users (
  id UUID PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  name TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Plans table
CREATE TABLE plans (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  title TEXT NOT NULL,
  description TEXT,
  owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  status TEXT NOT NULL CHECK (status IN ('draft', 'active', 'completed', 'archived')),
  metadata JSONB DEFAULT '{}'::jsonb
);

-- Plan nodes table (hierarchical structure for plans)
CREATE TABLE plan_nodes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  plan_id UUID NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  parent_id UUID REFERENCES plan_nodes(id) ON DELETE CASCADE,
  node_type TEXT NOT NULL CHECK (node_type IN ('root', 'phase', 'task', 'milestone')),
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL CHECK (status IN ('not_started', 'in_progress', 'completed', 'blocked')),
  order_index INTEGER NOT NULL DEFAULT 0,
  due_date TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  context TEXT,
  agent_instructions TEXT,
  acceptance_criteria TEXT,
  metadata JSONB DEFAULT '{}'::jsonb
);

-- Plan collaborators table
CREATE TABLE plan_collaborators (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  plan_id UUID NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('viewer', 'editor', 'admin')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (plan_id, user_id)
);

-- Plan comments table
CREATE TABLE plan_comments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  plan_node_id UUID NOT NULL REFERENCES plan_nodes(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  comment_type TEXT NOT NULL CHECK (comment_type IN ('human', 'agent', 'system')) DEFAULT 'human'
);

-- Plan node labels table
CREATE TABLE plan_node_labels (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  plan_node_id UUID NOT NULL REFERENCES plan_nodes(id) ON DELETE CASCADE,
  label TEXT NOT NULL
);

-- Plan node artifacts table
CREATE TABLE plan_node_artifacts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  plan_node_id UUID NOT NULL REFERENCES plan_nodes(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  content_type TEXT NOT NULL,
  url TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  created_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  metadata JSONB DEFAULT '{}'::jsonb
);

-- Plan node logs table
CREATE TABLE plan_node_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  plan_node_id UUID NOT NULL REFERENCES plan_nodes(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  log_type TEXT NOT NULL CHECK (log_type IN ('progress', 'reasoning', 'challenge', 'decision')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  metadata JSONB DEFAULT '{}'::jsonb,
  tags TEXT[] DEFAULT '{}'::text[]
);

-- API tokens table (for API access)
CREATE TABLE api_tokens (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  permissions TEXT[] DEFAULT ARRAY['read']::TEXT[],
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  last_used TIMESTAMP WITH TIME ZONE,
  revoked BOOLEAN NOT NULL DEFAULT FALSE
);

-- ============================================================================
-- INDEXES
-- ============================================================================

-- Primary indexes for foreign keys and lookups
CREATE INDEX plan_nodes_plan_id_idx ON plan_nodes (plan_id);
CREATE INDEX plan_nodes_parent_id_idx ON plan_nodes (parent_id);
CREATE INDEX plan_collaborators_plan_id_idx ON plan_collaborators (plan_id);
CREATE INDEX plan_collaborators_user_id_idx ON plan_collaborators (user_id);
CREATE INDEX plan_comments_plan_node_id_idx ON plan_comments (plan_node_id);
CREATE INDEX plan_node_labels_plan_node_id_idx ON plan_node_labels (plan_node_id);
CREATE INDEX plan_node_artifacts_plan_node_id_idx ON plan_node_artifacts (plan_node_id);
CREATE INDEX plan_node_logs_plan_node_id_idx ON plan_node_logs (plan_node_id);
CREATE INDEX api_tokens_user_id_idx ON api_tokens (user_id);
CREATE INDEX idx_api_tokens_token_hash ON api_tokens (token_hash);

-- Full-text search indexes
CREATE INDEX idx_plan_nodes_title_description ON plan_nodes 
  USING gin (to_tsvector('english', title || ' ' || COALESCE(description, '')));
CREATE INDEX idx_plan_nodes_context ON plan_nodes 
  USING gin (to_tsvector('english', COALESCE(context, '')));
CREATE INDEX idx_plan_comments_content ON plan_comments 
  USING gin (to_tsvector('english', content));
CREATE INDEX idx_plan_node_logs_content ON plan_node_logs 
  USING gin (to_tsvector('english', content));
CREATE INDEX idx_plan_node_artifacts_name ON plan_node_artifacts 
  USING gin (to_tsvector('english', name));

-- Performance indexes
CREATE INDEX idx_plan_nodes_status ON plan_nodes (status);
CREATE INDEX idx_plan_nodes_node_type ON plan_nodes (node_type);
CREATE INDEX idx_plan_nodes_created_at ON plan_nodes (created_at);
CREATE INDEX idx_plan_node_logs_log_type ON plan_node_logs (log_type);
CREATE INDEX idx_plan_node_logs_tags ON plan_node_logs USING gin (tags);
CREATE INDEX idx_plan_node_artifacts_content_type ON plan_node_artifacts (content_type);

-- ============================================================================
-- FUNCTIONS
-- ============================================================================

-- Function to update the 'updated_at' timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Function to perform plan-wide searches
CREATE OR REPLACE FUNCTION search_plan(
    input_plan_id UUID,
    search_query TEXT
) RETURNS TABLE (
    id UUID,
    type TEXT,
    title TEXT,
    content TEXT,
    created_at TIMESTAMPTZ,
    user_id UUID
) AS $$
BEGIN
    -- Return matching nodes
    RETURN QUERY
    SELECT 
        n.id,
        'node'::TEXT as type,
        n.title,
        n.description as content,
        n.created_at,
        p.owner_id as user_id
    FROM 
        plan_nodes n
    JOIN 
        plans p ON n.plan_id = p.id
    WHERE 
        n.plan_id = input_plan_id AND
        (
            n.title ILIKE '%' || search_query || '%' OR
            n.description ILIKE '%' || search_query || '%' OR
            n.context ILIKE '%' || search_query || '%' OR
            n.agent_instructions ILIKE '%' || search_query || '%' OR
            n.acceptance_criteria ILIKE '%' || search_query || '%'
        );
    
    -- Return matching comments
    RETURN QUERY
    SELECT 
        c.id,
        'comment'::TEXT as type,
        'Comment on ' || n.title as title,
        c.content,
        c.created_at,
        c.user_id
    FROM 
        plan_comments c
    JOIN 
        plan_nodes n ON c.plan_node_id = n.id
    WHERE 
        n.plan_id = input_plan_id AND
        c.content ILIKE '%' || search_query || '%';
    
    -- Return matching logs
    RETURN QUERY
    SELECT 
        l.id,
        'log'::TEXT as type,
        'Log for ' || n.title as title,
        l.content,
        l.created_at,
        l.user_id
    FROM 
        plan_node_logs l
    JOIN 
        plan_nodes n ON l.plan_node_id = n.id
    WHERE 
        n.plan_id = input_plan_id AND
        l.content ILIKE '%' || search_query || '%';
    
    -- Return matching artifacts
    RETURN QUERY
    SELECT 
        a.id,
        'artifact'::TEXT as type,
        a.name as title,
        a.url as content,
        a.created_at,
        a.created_by as user_id
    FROM 
        plan_node_artifacts a
    JOIN 
        plan_nodes n ON a.plan_node_id = n.id
    WHERE 
        n.plan_id = input_plan_id AND
        a.name ILIKE '%' || search_query || '%';
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- TRIGGERS
-- ============================================================================

CREATE TRIGGER update_users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_plans_updated_at
  BEFORE UPDATE ON plans
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_plan_nodes_updated_at
  BEFORE UPDATE ON plan_nodes
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_plan_comments_updated_at
  BEFORE UPDATE ON plan_comments
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- ROW LEVEL SECURITY (RLS)
-- ============================================================================

-- Enable RLS on all tables
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE plan_nodes ENABLE ROW LEVEL SECURITY;
ALTER TABLE plan_collaborators ENABLE ROW LEVEL SECURITY;
ALTER TABLE plan_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE plan_node_labels ENABLE ROW LEVEL SECURITY;
ALTER TABLE plan_node_artifacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE plan_node_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_tokens ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- RLS POLICIES
-- ============================================================================

-- Users policies
CREATE POLICY users_policy ON users
  FOR ALL USING (auth.uid() = id);

-- Plans policies
CREATE POLICY plans_select_policy ON plans
  FOR SELECT USING (
    owner_id = auth.uid() OR 
    EXISTS (
      SELECT 1 FROM plan_collaborators 
      WHERE plan_id = plans.id AND user_id = auth.uid()
    )
  );

CREATE POLICY plans_insert_policy ON plans
  FOR INSERT WITH CHECK (owner_id = auth.uid());

CREATE POLICY plans_update_policy ON plans
  FOR UPDATE USING (
    owner_id = auth.uid() OR 
    EXISTS (
      SELECT 1 FROM plan_collaborators 
      WHERE plan_id = plans.id AND user_id = auth.uid() AND role IN ('admin', 'editor')
    )
  );

CREATE POLICY plans_delete_policy ON plans
  FOR DELETE USING (owner_id = auth.uid());

-- Plan nodes policies
CREATE POLICY plan_nodes_select_policy ON plan_nodes
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM plans 
      WHERE id = plan_nodes.plan_id AND (
        owner_id = auth.uid() OR 
        EXISTS (
          SELECT 1 FROM plan_collaborators 
          WHERE plan_id = plans.id AND user_id = auth.uid()
        )
      )
    )
  );

CREATE POLICY plan_nodes_insert_policy ON plan_nodes
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM plans 
      WHERE id = plan_nodes.plan_id AND (
        owner_id = auth.uid() OR 
        EXISTS (
          SELECT 1 FROM plan_collaborators 
          WHERE plan_id = plans.id AND user_id = auth.uid() AND role IN ('admin', 'editor')
        )
      )
    )
  );

CREATE POLICY plan_nodes_update_policy ON plan_nodes
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM plans 
      WHERE id = plan_nodes.plan_id AND (
        owner_id = auth.uid() OR 
        EXISTS (
          SELECT 1 FROM plan_collaborators 
          WHERE plan_id = plans.id AND user_id = auth.uid() AND role IN ('admin', 'editor')
        )
      )
    )
  );

CREATE POLICY plan_nodes_delete_policy ON plan_nodes
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM plans 
      WHERE id = plan_nodes.plan_id AND (
        owner_id = auth.uid() OR 
        EXISTS (
          SELECT 1 FROM plan_collaborators 
          WHERE plan_id = plans.id AND user_id = auth.uid() AND role IN ('admin', 'editor')
        )
      )
    )
  );

-- Plan collaborators policies
CREATE POLICY plan_collaborators_select_policy ON plan_collaborators
  FOR SELECT USING (
    user_id = auth.uid() OR
    EXISTS (
      SELECT 1 FROM plans 
      WHERE id = plan_collaborators.plan_id AND owner_id = auth.uid()
    )
  );

CREATE POLICY plan_collaborators_insert_policy ON plan_collaborators
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM plans 
      WHERE id = plan_collaborators.plan_id AND owner_id = auth.uid()
    )
  );

CREATE POLICY plan_collaborators_update_policy ON plan_collaborators
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM plans 
      WHERE id = plan_collaborators.plan_id AND owner_id = auth.uid()
    )
  );

CREATE POLICY plan_collaborators_delete_policy ON plan_collaborators
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM plans 
      WHERE id = plan_collaborators.plan_id AND owner_id = auth.uid()
    )
  );

-- Plan comments policies
CREATE POLICY plan_comments_select_policy ON plan_comments
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM plan_nodes 
      WHERE id = plan_comments.plan_node_id AND
      EXISTS (
        SELECT 1 FROM plans 
        WHERE id = plan_nodes.plan_id AND (
          owner_id = auth.uid() OR 
          EXISTS (
            SELECT 1 FROM plan_collaborators 
            WHERE plan_id = plans.id AND user_id = auth.uid()
          )
        )
      )
    )
  );

CREATE POLICY plan_comments_insert_policy ON plan_comments
  FOR INSERT WITH CHECK (
    user_id = auth.uid() AND
    EXISTS (
      SELECT 1 FROM plan_nodes 
      WHERE id = plan_comments.plan_node_id AND
      EXISTS (
        SELECT 1 FROM plans 
        WHERE id = plan_nodes.plan_id AND (
          owner_id = auth.uid() OR 
          EXISTS (
            SELECT 1 FROM plan_collaborators 
            WHERE plan_id = plans.id AND user_id = auth.uid()
          )
        )
      )
    )
  );

CREATE POLICY plan_comments_update_policy ON plan_comments
  FOR UPDATE USING (
    user_id = auth.uid()
  );

CREATE POLICY plan_comments_delete_policy ON plan_comments
  FOR DELETE USING (
    user_id = auth.uid() OR
    EXISTS (
      SELECT 1 FROM plan_nodes 
      WHERE id = plan_comments.plan_node_id AND
      EXISTS (
        SELECT 1 FROM plans 
        WHERE id = plan_nodes.plan_id AND owner_id = auth.uid()
      )
    )
  );

-- Plan node labels policies
CREATE POLICY plan_node_labels_select_policy ON plan_node_labels
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM plan_nodes 
      WHERE id = plan_node_labels.plan_node_id AND
      EXISTS (
        SELECT 1 FROM plans 
        WHERE id = plan_nodes.plan_id AND (
          owner_id = auth.uid() OR 
          EXISTS (
            SELECT 1 FROM plan_collaborators 
            WHERE plan_id = plans.id AND user_id = auth.uid()
          )
        )
      )
    )
  );

CREATE POLICY plan_node_labels_insert_policy ON plan_node_labels
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM plan_nodes 
      WHERE id = plan_node_labels.plan_node_id AND
      EXISTS (
        SELECT 1 FROM plans 
        WHERE id = plan_nodes.plan_id AND (
          owner_id = auth.uid() OR 
          EXISTS (
            SELECT 1 FROM plan_collaborators 
            WHERE plan_id = plans.id AND user_id = auth.uid() AND role IN ('admin', 'editor')
          )
        )
      )
    )
  );

CREATE POLICY plan_node_labels_delete_policy ON plan_node_labels
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM plan_nodes 
      WHERE id = plan_node_labels.plan_node_id AND
      EXISTS (
        SELECT 1 FROM plans 
        WHERE id = plan_nodes.plan_id AND (
          owner_id = auth.uid() OR 
          EXISTS (
            SELECT 1 FROM plan_collaborators 
            WHERE plan_id = plans.id AND user_id = auth.uid() AND role IN ('admin', 'editor')
          )
        )
      )
    )
  );

-- Plan node artifacts policies
CREATE POLICY plan_node_artifacts_select_policy ON plan_node_artifacts
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM plan_nodes 
      WHERE id = plan_node_artifacts.plan_node_id AND
      EXISTS (
        SELECT 1 FROM plans 
        WHERE id = plan_nodes.plan_id AND (
          owner_id = auth.uid() OR 
          EXISTS (
            SELECT 1 FROM plan_collaborators 
            WHERE plan_id = plans.id AND user_id = auth.uid()
          )
        )
      )
    )
  );

CREATE POLICY plan_node_artifacts_insert_policy ON plan_node_artifacts
  FOR INSERT WITH CHECK (
    created_by = auth.uid() AND
    EXISTS (
      SELECT 1 FROM plan_nodes 
      WHERE id = plan_node_artifacts.plan_node_id AND
      EXISTS (
        SELECT 1 FROM plans 
        WHERE id = plan_nodes.plan_id AND (
          owner_id = auth.uid() OR 
          EXISTS (
            SELECT 1 FROM plan_collaborators 
            WHERE plan_id = plans.id AND user_id = auth.uid() AND role IN ('admin', 'editor')
          )
        )
      )
    )
  );

CREATE POLICY plan_node_artifacts_update_policy ON plan_node_artifacts
  FOR UPDATE USING (
    created_by = auth.uid() OR
    EXISTS (
      SELECT 1 FROM plan_nodes 
      WHERE id = plan_node_artifacts.plan_node_id AND
      EXISTS (
        SELECT 1 FROM plans 
        WHERE id = plan_nodes.plan_id AND owner_id = auth.uid()
      )
    )
  );

CREATE POLICY plan_node_artifacts_delete_policy ON plan_node_artifacts
  FOR DELETE USING (
    created_by = auth.uid() OR
    EXISTS (
      SELECT 1 FROM plan_nodes 
      WHERE id = plan_node_artifacts.plan_node_id AND
      EXISTS (
        SELECT 1 FROM plans 
        WHERE id = plan_nodes.plan_id AND owner_id = auth.uid()
      )
    )
  );

-- Plan node logs policies
CREATE POLICY plan_node_logs_select_policy ON plan_node_logs
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM plan_nodes 
      WHERE id = plan_node_logs.plan_node_id AND
      EXISTS (
        SELECT 1 FROM plans 
        WHERE id = plan_nodes.plan_id AND (
          owner_id = auth.uid() OR 
          EXISTS (
            SELECT 1 FROM plan_collaborators 
            WHERE plan_id = plans.id AND user_id = auth.uid()
          )
        )
      )
    )
  );

CREATE POLICY plan_node_logs_insert_policy ON plan_node_logs
  FOR INSERT WITH CHECK (
    user_id = auth.uid() AND
    EXISTS (
      SELECT 1 FROM plan_nodes 
      WHERE id = plan_node_logs.plan_node_id AND
      EXISTS (
        SELECT 1 FROM plans 
        WHERE id = plan_nodes.plan_id AND (
          owner_id = auth.uid() OR 
          EXISTS (
            SELECT 1 FROM plan_collaborators 
            WHERE plan_id = plans.id AND user_id = auth.uid()
          )
        )
      )
    )
  );

-- Alternative logs view policy for cross-plan queries
CREATE POLICY logs_view_policy ON plan_node_logs
  FOR SELECT USING (
    user_id = auth.uid() OR 
    plan_node_id IN (
      SELECT id FROM plan_nodes 
      WHERE plan_id IN (
        SELECT id FROM plans WHERE owner_id = auth.uid()
        UNION
        SELECT plan_id FROM plan_collaborators WHERE user_id = auth.uid()
      )
    )
  );

-- API tokens policies
CREATE POLICY api_tokens_select_policy ON api_tokens
  FOR SELECT USING (user_id = auth.uid());

CREATE POLICY api_tokens_insert_policy ON api_tokens
  FOR INSERT WITH CHECK (user_id = auth.uid());

CREATE POLICY api_tokens_update_policy ON api_tokens
  FOR UPDATE USING (user_id = auth.uid());

CREATE POLICY api_tokens_delete_policy ON api_tokens
  FOR DELETE USING (user_id = auth.uid());

-- ============================================================================
-- COMMENTS
-- ============================================================================

COMMENT ON TABLE users IS 'User profiles synchronized with Supabase Auth';
COMMENT ON TABLE plans IS 'Main planning documents that contain hierarchical nodes';
COMMENT ON TABLE plan_nodes IS 'Hierarchical task/phase structure within plans';
COMMENT ON TABLE plan_collaborators IS 'Users who have access to specific plans';
COMMENT ON TABLE plan_comments IS 'Comments on plan nodes by users or AI agents';
COMMENT ON TABLE plan_node_labels IS 'Tags/labels for categorizing plan nodes';
COMMENT ON TABLE plan_node_artifacts IS 'File attachments and external resources for nodes';
COMMENT ON TABLE plan_node_logs IS 'Activity logs and decision records for nodes';
COMMENT ON TABLE api_tokens IS 'API authentication tokens for external access';

COMMENT ON FUNCTION search_plan IS 'Full-text search across all plan content';
COMMENT ON FUNCTION update_updated_at_column IS 'Automatically updates updated_at timestamp';

-- ============================================================================
-- END OF SCHEMA
-- ============================================================================
-- ============================================================================
-- Additional migrations
-- ============================================================================
-- Create node_assignments table for tracking user assignments to nodes
CREATE TABLE IF NOT EXISTS node_assignments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    node_id UUID NOT NULL REFERENCES plan_nodes(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    assigned_by UUID NOT NULL REFERENCES auth.users(id),
    assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    -- Ensure a user can only be assigned once to a node
    UNIQUE(node_id, user_id)
);

-- Create indexes for performance
CREATE INDEX idx_node_assignments_node_id ON node_assignments(node_id);
CREATE INDEX idx_node_assignments_user_id ON node_assignments(user_id);
CREATE INDEX idx_node_assignments_assigned_at ON node_assignments(assigned_at);

-- Create a view to get assignments with user details
CREATE OR REPLACE VIEW node_assignments_with_users AS
SELECT 
    na.id,
    na.node_id,
    na.user_id,
    na.assigned_by,
    na.assigned_at,
    u.email as user_email,
    u.raw_user_meta_data->>'name' as user_name,
    ab.email as assigned_by_email,
    ab.raw_user_meta_data->>'name' as assigned_by_name
FROM node_assignments na
JOIN auth.users u ON na.user_id = u.id
JOIN auth.users ab ON na.assigned_by = ab.id;

-- Function to check if a user can be assigned to a node
-- (User must be a collaborator on the plan)
CREATE OR REPLACE FUNCTION can_assign_user_to_node(
    p_node_id UUID,
    p_user_id UUID
) RETURNS BOOLEAN AS $$
DECLARE
    v_plan_id UUID;
    v_is_collaborator BOOLEAN;
BEGIN
    -- Get the plan_id from the node
    SELECT plan_id INTO v_plan_id
    FROM plan_nodes
    WHERE id = p_node_id;
    
    IF v_plan_id IS NULL THEN
        RETURN FALSE;
    END IF;
    
    -- Check if user is owner or collaborator
    SELECT EXISTS (
        SELECT 1 FROM plans WHERE id = v_plan_id AND owner_id = p_user_id
        UNION
        SELECT 1 FROM plan_collaborators WHERE plan_id = v_plan_id AND user_id = p_user_id
    ) INTO v_is_collaborator;
    
    RETURN v_is_collaborator;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- RLS policies for node_assignments
ALTER TABLE node_assignments ENABLE ROW LEVEL SECURITY;

-- Users can view assignments for nodes in plans they have access to
CREATE POLICY "Users can view node assignments" ON node_assignments
    FOR SELECT USING (
        node_id IN (
            SELECT pn.id 
            FROM plan_nodes pn
            JOIN plans p ON pn.plan_id = p.id
            WHERE p.owner_id = auth.uid()
            OR p.id IN (
                SELECT plan_id FROM plan_collaborators WHERE user_id = auth.uid()
            )
        )
    );

-- Users can create assignments for nodes in plans they own or have admin/editor role
CREATE POLICY "Users can create node assignments" ON node_assignments
    FOR INSERT WITH CHECK (
        node_id IN (
            SELECT pn.id 
            FROM plan_nodes pn
            JOIN plans p ON pn.plan_id = p.id
            WHERE p.owner_id = auth.uid()
            OR p.id IN (
                SELECT plan_id FROM plan_collaborators 
                WHERE user_id = auth.uid() 
                AND role IN ('admin', 'editor')
            )
        )
        AND can_assign_user_to_node(node_id, user_id)
    );

-- Users can delete assignments for nodes in plans they own or have admin/editor role
CREATE POLICY "Users can delete node assignments" ON node_assignments
    FOR DELETE USING (
        node_id IN (
            SELECT pn.id 
            FROM plan_nodes pn
            JOIN plans p ON pn.plan_id = p.id
            WHERE p.owner_id = auth.uid()
            OR p.id IN (
                SELECT plan_id FROM plan_collaborators 
                WHERE user_id = auth.uid() 
                AND role IN ('admin', 'editor')
            )
        )
    );
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
-- Drop deprecated api_keys table
-- This table has been replaced by api_tokens table
-- The api_tokens table provides enhanced functionality with permissions and token management

-- Drop the deprecated table if it exists
DROP TABLE IF EXISTS api_keys CASCADE;

-- Add comment to document the deprecation
COMMENT ON TABLE api_tokens IS 'API authentication tokens for external access (replaced deprecated api_keys table)';
