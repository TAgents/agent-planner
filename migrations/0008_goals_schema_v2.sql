-- Phase 8: Update goals table to match v2 schema and add goal_links + goal_evaluations tables

-- Step 1: Add missing columns to goals
ALTER TABLE goals ADD COLUMN IF NOT EXISTS type TEXT;
--> statement-breakpoint
ALTER TABLE goals ADD COLUMN IF NOT EXISTS priority INTEGER DEFAULT 0;
--> statement-breakpoint
ALTER TABLE goals ADD COLUMN IF NOT EXISTS parent_goal_id UUID REFERENCES goals(id);
--> statement-breakpoint
ALTER TABLE goals ADD COLUMN IF NOT EXISTS success_criteria JSONB;
--> statement-breakpoint

-- Step 2: Drop created_by (owner_id already exists and serves the same purpose)
ALTER TABLE goals DROP COLUMN IF EXISTS created_by;
--> statement-breakpoint

-- Step 3: Set defaults for type on existing rows, then make NOT NULL
UPDATE goals SET type = 'outcome' WHERE type IS NULL;
--> statement-breakpoint
ALTER TABLE goals ALTER COLUMN type SET NOT NULL;
--> statement-breakpoint

-- Step 4: Migrate success_metrics → success_criteria if data exists
UPDATE goals SET success_criteria = success_metrics WHERE success_metrics IS NOT NULL AND success_criteria IS NULL;
--> statement-breakpoint

-- Step 5: Drop old columns
ALTER TABLE goals DROP COLUMN IF EXISTS success_metrics;
--> statement-breakpoint
ALTER TABLE goals DROP COLUMN IF EXISTS time_horizon;
--> statement-breakpoint

-- Step 6: Create goal_links table (replaces plan_goals with generic linking)
CREATE TABLE IF NOT EXISTS goal_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  goal_id UUID NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
  linked_type TEXT NOT NULL,
  linked_id UUID NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(goal_id, linked_type, linked_id)
);
--> statement-breakpoint

-- Step 7: Migrate plan_goals → goal_links
INSERT INTO goal_links (goal_id, linked_type, linked_id, created_at)
SELECT goal_id, 'plan', plan_id, linked_at
FROM plan_goals
ON CONFLICT DO NOTHING;
--> statement-breakpoint

-- Step 8: Drop plan_goals (replaced by goal_links)
DROP TABLE IF EXISTS plan_goals;
--> statement-breakpoint

-- Step 9: Create goal_evaluations table
CREATE TABLE IF NOT EXISTS goal_evaluations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  goal_id UUID NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
  evaluated_at TIMESTAMPTZ DEFAULT NOW(),
  evaluated_by TEXT NOT NULL,
  score INTEGER,
  reasoning TEXT,
  suggested_actions JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
