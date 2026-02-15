-- Goals v2: Add type, hierarchy, generic links, evaluations
-- Migrates from v1 goals schema to v2

-- Add new columns to goals table
ALTER TABLE goals ADD COLUMN IF NOT EXISTS type TEXT NOT NULL DEFAULT 'outcome';
ALTER TABLE goals ADD COLUMN IF NOT EXISTS success_criteria JSONB;
ALTER TABLE goals ADD COLUMN IF NOT EXISTS priority INTEGER DEFAULT 0;
ALTER TABLE goals ADD COLUMN IF NOT EXISTS parent_goal_id UUID REFERENCES goals(id);

-- Update status enum: rename 'at_risk' -> keep as-is, add 'paused'
-- (v1 had: active, achieved, at_risk, abandoned; v2 wants: active, achieved, paused, abandoned)

-- Rename owner column if needed (v1 might use organization_id pattern)
-- The Drizzle schema uses owner_id which maps to users.id

-- Create goal_links table (replaces plan_goals with generic linking)
CREATE TABLE IF NOT EXISTS goal_links (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    goal_id         UUID NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
    linked_type     TEXT NOT NULL CHECK (linked_type IN ('plan', 'task', 'agent', 'workflow')),
    linked_id       UUID NOT NULL,
    created_at      TIMESTAMPTZ DEFAULT now(),
    UNIQUE(goal_id, linked_type, linked_id)
);

-- Migrate existing plan_goals data to goal_links
INSERT INTO goal_links (goal_id, linked_type, linked_id, created_at)
SELECT goal_id, 'plan', plan_id, linked_at
FROM plan_goals
ON CONFLICT DO NOTHING;

-- Create goal_evaluations table
CREATE TABLE IF NOT EXISTS goal_evaluations (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    goal_id           UUID NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
    evaluated_at      TIMESTAMPTZ DEFAULT now(),
    evaluated_by      TEXT NOT NULL,
    score             INTEGER CHECK (score BETWEEN 0 AND 100),
    reasoning         TEXT,
    suggested_actions JSONB,
    created_at        TIMESTAMPTZ DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_goal_links_goal_id ON goal_links(goal_id);
CREATE INDEX IF NOT EXISTS idx_goal_links_linked ON goal_links(linked_type, linked_id);
CREATE INDEX IF NOT EXISTS idx_goal_evaluations_goal_id ON goal_evaluations(goal_id);
CREATE INDEX IF NOT EXISTS idx_goals_owner_status ON goals(owner_id, status);
CREATE INDEX IF NOT EXISTS idx_goals_parent ON goals(parent_goal_id);
