-- BDI Phase 4: Knowledge Loop Runs table

CREATE TABLE IF NOT EXISTS knowledge_loop_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id UUID NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  goal_id UUID REFERENCES goals(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'running',
  max_iterations INTEGER NOT NULL DEFAULT 10,
  iterations JSONB DEFAULT '[]',
  quality_before DOUBLE PRECISION,
  quality_after DOUBLE PRECISION,
  started_by UUID REFERENCES users(id) ON DELETE SET NULL,
  started_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  metadata JSONB DEFAULT '{}'
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_kl_runs_plan_id ON knowledge_loop_runs (plan_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_kl_runs_goal_id ON knowledge_loop_runs (goal_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_kl_runs_status ON knowledge_loop_runs (status);
