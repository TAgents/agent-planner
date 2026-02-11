-- Migration: Add agent heartbeat tracking for status indicators

CREATE TABLE IF NOT EXISTS agent_heartbeats (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  last_seen_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  status TEXT NOT NULL DEFAULT 'online' CHECK (status IN ('online', 'active', 'idle', 'offline')),
  current_plan_id UUID REFERENCES plans(id) ON DELETE SET NULL,
  current_task_id UUID REFERENCES plan_nodes(id) ON DELETE SET NULL,
  metadata JSONB DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_agent_heartbeats_status ON agent_heartbeats(status);
CREATE INDEX IF NOT EXISTS idx_agent_heartbeats_plan ON agent_heartbeats(current_plan_id) WHERE current_plan_id IS NOT NULL;
