-- Migration: Add Agent Request Fields to Plan Nodes
-- Purpose: Enable users to request agent assistance on tasks

-- Add agent request type enum
CREATE TYPE agent_request_type AS ENUM ('start', 'review', 'help', 'continue');

-- Add agent request fields to plan_nodes
ALTER TABLE plan_nodes ADD COLUMN IF NOT EXISTS agent_requested agent_request_type;
ALTER TABLE plan_nodes ADD COLUMN IF NOT EXISTS agent_requested_at TIMESTAMPTZ;
ALTER TABLE plan_nodes ADD COLUMN IF NOT EXISTS agent_requested_by UUID REFERENCES auth.users(id);
ALTER TABLE plan_nodes ADD COLUMN IF NOT EXISTS agent_request_message TEXT;

-- Index for efficient querying of requested tasks
CREATE INDEX IF NOT EXISTS idx_plan_nodes_agent_requested 
  ON plan_nodes(agent_requested) 
  WHERE agent_requested IS NOT NULL;

-- Index for finding requests by user
CREATE INDEX IF NOT EXISTS idx_plan_nodes_agent_requested_by 
  ON plan_nodes(agent_requested_by) 
  WHERE agent_requested_by IS NOT NULL;

-- Comments
COMMENT ON COLUMN plan_nodes.agent_requested IS 'Type of agent assistance requested: start (begin work), review (check work), help (provide guidance), continue (resume work)';
COMMENT ON COLUMN plan_nodes.agent_requested_at IS 'When the agent assistance was requested';
COMMENT ON COLUMN plan_nodes.agent_requested_by IS 'User who requested agent assistance';
COMMENT ON COLUMN plan_nodes.agent_request_message IS 'Optional message/context for the agent request';
