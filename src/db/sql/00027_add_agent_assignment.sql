-- Migration: Add assigned_agent_id to plan_nodes for explicit agent assignment
-- This is separate from node_assignments (which tracks human collaborators)

ALTER TABLE plan_nodes ADD COLUMN IF NOT EXISTS assigned_agent_id UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE plan_nodes ADD COLUMN IF NOT EXISTS assigned_agent_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE plan_nodes ADD COLUMN IF NOT EXISTS assigned_agent_by UUID REFERENCES users(id) ON DELETE SET NULL;

-- Index for finding tasks assigned to a specific agent
CREATE INDEX IF NOT EXISTS idx_plan_nodes_assigned_agent ON plan_nodes(assigned_agent_id) WHERE assigned_agent_id IS NOT NULL;
