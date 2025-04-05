-- Consolidated migration file that combines:
-- 1. api_tokens functionality (replacing api_keys)
-- 2. activity tracking enhancements
-- 3. search performance improvements

-- Create api_tokens table (replacing api_keys table)
CREATE TABLE IF NOT EXISTS api_tokens (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  permissions TEXT[] DEFAULT ARRAY['read']::TEXT[],
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  last_used TIMESTAMP WITH TIME ZONE,
  revoked BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE INDEX api_tokens_user_id_idx ON api_tokens (user_id);

-- Enable RLS on the table
ALTER TABLE api_tokens ENABLE ROW LEVEL SECURITY;

-- Set up RLS policies
-- Users can only see and manage their own tokens
CREATE POLICY api_tokens_select_policy ON api_tokens
  FOR SELECT USING (user_id = auth.uid());

CREATE POLICY api_tokens_insert_policy ON api_tokens
  FOR INSERT WITH CHECK (user_id = auth.uid());

CREATE POLICY api_tokens_update_policy ON api_tokens
  FOR UPDATE USING (user_id = auth.uid());

CREATE POLICY api_tokens_delete_policy ON api_tokens
  FOR DELETE USING (user_id = auth.uid());

-- Add metadata and tags to plan_node_logs (only once)
ALTER TABLE plan_node_logs
ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb,
ADD COLUMN IF NOT EXISTS tags TEXT[] DEFAULT '{}'::text[];

-- Add indexes to improve search performance
CREATE INDEX IF NOT EXISTS idx_plan_nodes_title_description ON plan_nodes USING gin (to_tsvector('english', title || ' ' || COALESCE(description, '')));
CREATE INDEX IF NOT EXISTS idx_plan_nodes_context ON plan_nodes USING gin (to_tsvector('english', COALESCE(context, '')));
CREATE INDEX IF NOT EXISTS idx_plan_comments_content ON plan_comments USING gin (to_tsvector('english', content));
CREATE INDEX IF NOT EXISTS idx_plan_node_logs_content ON plan_node_logs USING gin (to_tsvector('english', content));
CREATE INDEX IF NOT EXISTS idx_plan_node_artifacts_name ON plan_node_artifacts USING gin (to_tsvector('english', name));

-- Add index for tag searching
CREATE INDEX IF NOT EXISTS idx_plan_node_logs_tags ON plan_node_logs USING gin (tags);

-- Add indexes for faster filtering
CREATE INDEX IF NOT EXISTS idx_plan_nodes_status ON plan_nodes (status);
CREATE INDEX IF NOT EXISTS idx_plan_nodes_node_type ON plan_nodes (node_type);
CREATE INDEX IF NOT EXISTS idx_plan_nodes_created_at ON plan_nodes (created_at);
CREATE INDEX IF NOT EXISTS idx_plan_node_logs_log_type ON plan_node_logs (log_type);
CREATE INDEX IF NOT EXISTS idx_plan_node_artifacts_content_type ON plan_node_artifacts (content_type);

-- Update Row Level Security policies for logs to allow querying across plans
DROP POLICY IF EXISTS logs_view_policy ON plan_node_logs;
CREATE POLICY logs_view_policy ON plan_node_logs
    USING (
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

-- Create or replace a function to perform plan-wide searches
CREATE OR REPLACE FUNCTION search_plan(
    plan_id UUID,
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
        n.plan_id = plan_id AND
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
        n.plan_id = plan_id AND
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
        n.plan_id = plan_id AND
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
        n.plan_id = plan_id AND
        a.name ILIKE '%' || search_query || '%';
END;
$$ LANGUAGE plpgsql;

-- Add migration to deprecate the api_keys table
-- Note: We're not dropping it immediately to ensure backward compatibility
COMMENT ON TABLE api_keys IS 'DEPRECATED: Use api_tokens instead';
