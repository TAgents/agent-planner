-- Workspaces and Blueprints — additive primitives
-- See docs/WORKSPACE_BLUEPRINT_SKETCH.md
--
-- Workspace = live folder under Organization (owns goals + plans)
-- Blueprint = dehydrated, reusable shape (forks into Workspace or Plan)
--
-- Strictly additive: no rename, no drop. workspace_id FKs are nullable
-- until the Default-workspace backfill runs and UI/MCP catch up.

CREATE TABLE IF NOT EXISTS workspaces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  owner_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  title TEXT NOT NULL,
  slug TEXT NOT NULL,
  description TEXT,
  icon TEXT,
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  archived_at TIMESTAMPTZ,
  forked_from_blueprint_id UUID,
  forked_at TIMESTAMPTZ,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT workspaces_org_slug_unique UNIQUE (organization_id, slug)
);

CREATE INDEX IF NOT EXISTS workspaces_org_idx ON workspaces(organization_id);
CREATE INDEX IF NOT EXISTS workspaces_owner_idx ON workspaces(owner_id);

--> statement-breakpoint

CREATE TABLE IF NOT EXISTS blueprints (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  organization_id UUID REFERENCES organizations(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  description TEXT,
  scope TEXT NOT NULL CHECK (scope IN ('plan', 'workspace')),
  visibility VARCHAR(20) NOT NULL DEFAULT 'private'
    CHECK (visibility IN ('private', 'public', 'unlisted')),
  version INTEGER NOT NULL DEFAULT 1,
  payload JSONB NOT NULL,
  source_workspace_id UUID,
  source_plan_id UUID,
  fork_count INTEGER NOT NULL DEFAULT 0,
  tags TEXT[] DEFAULT '{}',
  published_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS blueprints_owner_idx ON blueprints(owner_id);
CREATE INDEX IF NOT EXISTS blueprints_visibility_idx ON blueprints(visibility);
CREATE INDEX IF NOT EXISTS blueprints_scope_idx ON blueprints(scope);

--> statement-breakpoint

-- Wire up the Workspace ↔ Blueprint provenance FK now that both tables exist
ALTER TABLE workspaces
  ADD CONSTRAINT workspaces_forked_from_blueprint_fk
  FOREIGN KEY (forked_from_blueprint_id) REFERENCES blueprints(id) ON DELETE SET NULL;

--> statement-breakpoint

-- Add nullable workspace_id FK to goals and plans
ALTER TABLE goals
  ADD COLUMN IF NOT EXISTS workspace_id UUID
    REFERENCES workspaces(id) ON DELETE SET NULL;

ALTER TABLE plans
  ADD COLUMN IF NOT EXISTS workspace_id UUID
    REFERENCES workspaces(id) ON DELETE SET NULL;

ALTER TABLE plans
  ADD COLUMN IF NOT EXISTS forked_from_blueprint_id UUID
    REFERENCES blueprints(id) ON DELETE SET NULL;

ALTER TABLE plans
  ADD COLUMN IF NOT EXISTS forked_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS goals_workspace_idx ON goals(workspace_id);
CREATE INDEX IF NOT EXISTS plans_workspace_idx ON plans(workspace_id);
CREATE INDEX IF NOT EXISTS plans_forked_from_blueprint_idx ON plans(forked_from_blueprint_id);
