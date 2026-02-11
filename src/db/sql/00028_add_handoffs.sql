-- Migration: Add handoffs table for agent-to-agent task handoff protocol

CREATE TABLE IF NOT EXISTS handoffs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id UUID NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  node_id UUID NOT NULL REFERENCES plan_nodes(id) ON DELETE CASCADE,
  from_agent_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  to_agent_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected', 'completed')),
  context TEXT,
  reason TEXT,
  notes TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  resolved_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX IF NOT EXISTS idx_handoffs_node ON handoffs(node_id);
CREATE INDEX IF NOT EXISTS idx_handoffs_from ON handoffs(from_agent_id);
CREATE INDEX IF NOT EXISTS idx_handoffs_to ON handoffs(to_agent_id);
CREATE INDEX IF NOT EXISTS idx_handoffs_status ON handoffs(status) WHERE status = 'pending';
