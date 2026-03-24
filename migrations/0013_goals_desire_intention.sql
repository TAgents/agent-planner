-- BDI Phase 3: Goals v2 Desire/Intention distinction

-- Add goal_type column (desire | intention, default: desire)
ALTER TABLE goals ADD COLUMN IF NOT EXISTS goal_type TEXT NOT NULL DEFAULT 'desire';
--> statement-breakpoint

-- Add promoted_at timestamp (when a desire became an intention)
ALTER TABLE goals ADD COLUMN IF NOT EXISTS promoted_at TIMESTAMPTZ;
--> statement-breakpoint

-- Index for filtering by goal_type
CREATE INDEX IF NOT EXISTS idx_goals_goal_type ON goals (goal_type);
