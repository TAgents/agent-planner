-- Phase 9: Create node_claims table for agent task locking
-- Prevents two agents from working on the same task simultaneously.

CREATE TABLE IF NOT EXISTS node_claims (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  node_id UUID NOT NULL REFERENCES plan_nodes(id) ON DELETE CASCADE,
  agent_id TEXT NOT NULL,
  plan_id UUID NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  claimed_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  released_at TIMESTAMPTZ,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL
);
--> statement-breakpoint

-- Indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_node_claims_node_id ON node_claims (node_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_node_claims_agent_id ON node_claims (agent_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_node_claims_expires_at ON node_claims (expires_at);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_node_claims_plan_id ON node_claims (plan_id);
--> statement-breakpoint

-- Partial unique index: only one active (unreleased) claim per node
CREATE UNIQUE INDEX IF NOT EXISTS node_claims_active_unique ON node_claims (node_id) WHERE released_at IS NULL;
--> statement-breakpoint

-- Missing index from migration 0007
CREATE INDEX IF NOT EXISTS idx_node_deps_target_goal_type ON node_dependencies (target_goal_id, dependency_type);
--> statement-breakpoint

-- Missing unique constraint on plan_collaborators (uses unique index as fallback for idempotency)
CREATE UNIQUE INDEX IF NOT EXISTS plan_collaborators_plan_user_unique ON plan_collaborators (plan_id, user_id);
