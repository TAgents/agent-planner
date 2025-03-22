-- Enable extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Users table
-- Note: Actual user authentication is handled by Supabase Auth
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  name TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Plans table
CREATE TABLE IF NOT EXISTS plans (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  title TEXT NOT NULL,
  description TEXT,
  owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  status TEXT NOT NULL CHECK (status IN ('draft', 'active', 'completed', 'archived')),
  metadata JSONB DEFAULT '{}'::jsonb
);

-- Plan nodes table
CREATE TABLE IF NOT EXISTS plan_nodes (
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
CREATE INDEX plan_nodes_plan_id_idx ON plan_nodes (plan_id);
CREATE INDEX plan_nodes_parent_id_idx ON plan_nodes (parent_id);

-- Plan collaborators table
CREATE TABLE IF NOT EXISTS plan_collaborators (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  plan_id UUID NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('viewer', 'editor', 'admin')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (plan_id, user_id)
);
CREATE INDEX plan_collaborators_plan_id_idx ON plan_collaborators (plan_id);
CREATE INDEX plan_collaborators_user_id_idx ON plan_collaborators (user_id);

-- Plan comments table
CREATE TABLE IF NOT EXISTS plan_comments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  plan_node_id UUID NOT NULL REFERENCES plan_nodes(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  comment_type TEXT NOT NULL CHECK (comment_type IN ('human', 'agent', 'system')) DEFAULT 'human'
);
CREATE INDEX plan_comments_plan_node_id_idx ON plan_comments (plan_node_id);

-- API keys table
CREATE TABLE IF NOT EXISTS api_keys (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  key_hash TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMP WITH TIME ZONE,
  scopes TEXT[] DEFAULT ARRAY['read']::TEXT[]
);
CREATE INDEX api_keys_user_id_idx ON api_keys (user_id);

-- Plan node labels table
CREATE TABLE IF NOT EXISTS plan_node_labels (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  plan_node_id UUID NOT NULL REFERENCES plan_nodes(id) ON DELETE CASCADE,
  label TEXT NOT NULL
);
CREATE INDEX plan_node_labels_plan_node_id_idx ON plan_node_labels (plan_node_id);

-- Plan node artifacts table
CREATE TABLE IF NOT EXISTS plan_node_artifacts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  plan_node_id UUID NOT NULL REFERENCES plan_nodes(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  content_type TEXT NOT NULL,
  url TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  created_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  metadata JSONB DEFAULT '{}'::jsonb
);
CREATE INDEX plan_node_artifacts_plan_node_id_idx ON plan_node_artifacts (plan_node_id);

-- Plan node logs table
CREATE TABLE IF NOT EXISTS plan_node_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  plan_node_id UUID NOT NULL REFERENCES plan_nodes(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  log_type TEXT NOT NULL CHECK (log_type IN ('progress', 'reasoning', 'challenge', 'decision')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX plan_node_logs_plan_node_id_idx ON plan_node_logs (plan_node_id);

-- Set up Row Level Security (RLS) policies

-- Enable RLS on all tables
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE plan_nodes ENABLE ROW LEVEL SECURITY;
ALTER TABLE plan_collaborators ENABLE ROW LEVEL SECURITY;
ALTER TABLE plan_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE plan_node_labels ENABLE ROW LEVEL SECURITY;
ALTER TABLE plan_node_artifacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE plan_node_logs ENABLE ROW LEVEL SECURITY;

-- Users can only see their own data
CREATE POLICY users_policy ON users
  FOR ALL USING (auth.uid() = id);

-- Plans can be seen by their owner or collaborators
CREATE POLICY plans_select_policy ON plans
  FOR SELECT USING (
    owner_id = auth.uid() OR 
    EXISTS (
      SELECT 1 FROM plan_collaborators 
      WHERE plan_id = plans.id AND user_id = auth.uid()
    )
  );

-- Plans can only be modified by their owner or admin/editor collaborators
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

-- Plan nodes policies follow the same pattern as plans
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

-- Similar policies for other tables...
-- (similar RLS policies would be created for all other tables)

-- Create a trigger to update the 'updated_at' field
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

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
