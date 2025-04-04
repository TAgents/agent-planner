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

-- Add metadata field to logs
ALTER TABLE plan_node_logs 
ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb;

-- Add tags field to logs
ALTER TABLE plan_node_logs 
ADD COLUMN IF NOT EXISTS tags TEXT[] DEFAULT ARRAY[]::TEXT[];