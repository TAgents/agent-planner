-- Drop goals.goal_type — commitment is derived from promoted_at.
--
-- The BDI desire/intention distinction had two sources of truth
-- (goal_type + promoted_at) that could disagree. promoted_at IS NOT NULL
-- is now the single source: promoted = committed ("intention"),
-- unpromoted = aspirational ("desire"). The API keeps emitting a derived
-- goal_type field for backward compatibility (see goals.dal.mjs).

-- Committed goals that were promoted before promoted_at existed (or via
-- direct goal_type writes) get a timestamp so no commitment is lost.
UPDATE goals
SET promoted_at = COALESCE(promoted_at, updated_at, NOW())
WHERE goal_type = 'intention' AND promoted_at IS NULL;

--> statement-breakpoint

DROP INDEX IF EXISTS idx_goals_goal_type;

--> statement-breakpoint

ALTER TABLE goals DROP COLUMN IF EXISTS goal_type;
