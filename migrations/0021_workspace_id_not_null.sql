-- Workspace tightening: plans.workspace_id and goals.workspace_id become NOT NULL.
--
-- Self-contained backfill (supersedes scripts/backfill-default-workspace.mjs):
--   1. Personal orgs for owners of org-less plans/goals who lack one
--   2. Owner memberships for those personal orgs
--   3. Default workspaces for every org that lacks one
--   4. Org-scoped NULL rows -> the org's default workspace
--   5. Org-less rows -> the owner's personal org + its default workspace
--   6. FK swaps ON DELETE SET NULL -> RESTRICT (SET NULL is incompatible
--      with NOT NULL), then SET NOT NULL
--
-- Every step is idempotent; the migration can be re-run after a partial failure.

-- 1. Personal orgs for owners of org-less plans/goals without a personal org.
--    Slug embeds the FULL user id (unlike personalScope.js's 8-char prefix)
--    so the membership join in step 2 cannot cross-attach two users who
--    share an 8-hex-char uuid prefix. ensurePersonalScope() never needs the
--    slug for these users again — it early-returns on existing membership.
INSERT INTO organizations (name, slug, is_personal, description)
SELECT
  COALESCE(NULLIF(TRIM(u.name), ''), NULLIF(SPLIT_PART(u.email, '@', 1), ''), 'personal'),
  'personal-' || u.id::text,
  TRUE,
  'Personal workspace.'
FROM users u
WHERE u.id IN (
  SELECT owner_id FROM plans WHERE workspace_id IS NULL AND organization_id IS NULL
  UNION
  SELECT owner_id FROM goals WHERE workspace_id IS NULL AND organization_id IS NULL
)
AND NOT EXISTS (
  SELECT 1
  FROM organization_members m
  JOIN organizations o ON o.id = m.organization_id
  WHERE m.user_id = u.id AND o.is_personal = TRUE
)
ON CONFLICT (slug) DO NOTHING;

--> statement-breakpoint

-- 2. Owner membership for personal orgs missing it. Exact match for step 1
--    inserts (full-uuid slug); the legacy 8-char-prefix match only attaches
--    when the org has NO members at all (a partial ensurePersonalScope run
--    that created the org but failed to add the member).
INSERT INTO organization_members (organization_id, user_id, role)
SELECT o.id, u.id, 'owner'
FROM organizations o
JOIN users u ON (
  o.slug = 'personal-' || u.id::text
  OR (
    o.slug = 'personal-' || SUBSTRING(u.id::text, 1, 8)
    AND NOT EXISTS (
      SELECT 1 FROM organization_members m0 WHERE m0.organization_id = o.id
    )
  )
)
WHERE o.is_personal = TRUE
  AND NOT EXISTS (
    SELECT 1 FROM organization_members m
    WHERE m.organization_id = o.id AND m.user_id = u.id
  );

--> statement-breakpoint

-- 3a. Default workspace for every org that lacks one. Owner preference:
--     org owner member -> any member -> earliest plan owner -> earliest goal owner.
WITH owner_pick AS (
  SELECT o.id AS org_id,
    COALESCE(
      (SELECT m.user_id FROM organization_members m
        WHERE m.organization_id = o.id AND m.role = 'owner'
        ORDER BY m.joined_at LIMIT 1),
      (SELECT m.user_id FROM organization_members m
        WHERE m.organization_id = o.id
        ORDER BY m.joined_at LIMIT 1),
      (SELECT p.owner_id FROM plans p
        WHERE p.organization_id = o.id
        ORDER BY p.created_at LIMIT 1),
      (SELECT g.owner_id FROM goals g
        WHERE g.organization_id = o.id
        ORDER BY g.created_at LIMIT 1)
    ) AS owner_id
  FROM organizations o
  WHERE NOT EXISTS (
    SELECT 1 FROM workspaces w
    WHERE w.organization_id = o.id AND w.is_default = TRUE
  )
)
INSERT INTO workspaces (organization_id, owner_id, title, slug, is_default, description)
SELECT org_id, owner_id, 'Default', 'default', TRUE,
  'Default workspace — auto-created during workspace migration.'
FROM owner_pick
WHERE owner_id IS NOT NULL
ON CONFLICT (organization_id, slug) DO NOTHING;

--> statement-breakpoint

-- 3b. Same, for orgs where the 'default' slug was already taken by a
--     non-default workspace (the ON CONFLICT above skipped them).
WITH owner_pick AS (
  SELECT o.id AS org_id,
    COALESCE(
      (SELECT m.user_id FROM organization_members m
        WHERE m.organization_id = o.id AND m.role = 'owner'
        ORDER BY m.joined_at LIMIT 1),
      (SELECT m.user_id FROM organization_members m
        WHERE m.organization_id = o.id
        ORDER BY m.joined_at LIMIT 1),
      (SELECT p.owner_id FROM plans p
        WHERE p.organization_id = o.id
        ORDER BY p.created_at LIMIT 1),
      (SELECT g.owner_id FROM goals g
        WHERE g.organization_id = o.id
        ORDER BY g.created_at LIMIT 1)
    ) AS owner_id
  FROM organizations o
  WHERE NOT EXISTS (
    SELECT 1 FROM workspaces w
    WHERE w.organization_id = o.id AND w.is_default = TRUE
  )
)
INSERT INTO workspaces (organization_id, owner_id, title, slug, is_default, description)
SELECT org_id, owner_id, 'Default', 'default-' || SUBSTRING(org_id::text, 1, 8), TRUE,
  'Default workspace — auto-created during workspace migration.'
FROM owner_pick
WHERE owner_id IS NOT NULL
ON CONFLICT (organization_id, slug) DO NOTHING;

--> statement-breakpoint

-- 4. Org-scoped rows with NULL workspace -> the org's default workspace.
UPDATE plans p
SET workspace_id = w.id, updated_at = NOW()
FROM workspaces w
WHERE p.workspace_id IS NULL
  AND p.organization_id IS NOT NULL
  AND w.organization_id = p.organization_id
  AND w.is_default = TRUE;

--> statement-breakpoint

UPDATE goals g
SET workspace_id = w.id, updated_at = NOW()
FROM workspaces w
WHERE g.workspace_id IS NULL
  AND g.organization_id IS NOT NULL
  AND w.organization_id = g.organization_id
  AND w.is_default = TRUE;

--> statement-breakpoint

-- 5. Org-less ("personal") rows -> the owner's personal org + its default
--    workspace. Deliberately the personal org, never a shared org the owner
--    happens to belong to — org plans are visible to org members.
UPDATE plans p
SET organization_id = o.id, workspace_id = w.id, updated_at = NOW()
FROM organization_members m
JOIN organizations o ON o.id = m.organization_id AND o.is_personal = TRUE
JOIN workspaces w ON w.organization_id = o.id AND w.is_default = TRUE
WHERE p.workspace_id IS NULL
  AND p.organization_id IS NULL
  AND m.user_id = p.owner_id;

--> statement-breakpoint

UPDATE goals g
SET organization_id = o.id, workspace_id = w.id, updated_at = NOW()
FROM organization_members m
JOIN organizations o ON o.id = m.organization_id AND o.is_personal = TRUE
JOIN workspaces w ON w.organization_id = o.id AND w.is_default = TRUE
WHERE g.workspace_id IS NULL
  AND g.organization_id IS NULL
  AND m.user_id = g.owner_id;

--> statement-breakpoint

-- 6. Swap FKs: ON DELETE SET NULL is incompatible with NOT NULL. RESTRICT
--    means a workspace with plans/goals can't be deleted (enforced with a
--    409 in the API). Then tighten to NOT NULL — fails loudly if any row
--    escaped the backfill above.
ALTER TABLE plans DROP CONSTRAINT IF EXISTS plans_workspace_id_fkey;

--> statement-breakpoint

ALTER TABLE plans
  ADD CONSTRAINT plans_workspace_id_fkey
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE RESTRICT;

--> statement-breakpoint

ALTER TABLE plans ALTER COLUMN workspace_id SET NOT NULL;

--> statement-breakpoint

ALTER TABLE goals DROP CONSTRAINT IF EXISTS goals_workspace_id_fkey;

--> statement-breakpoint

ALTER TABLE goals
  ADD CONSTRAINT goals_workspace_id_fkey
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE RESTRICT;

--> statement-breakpoint

ALTER TABLE goals ALTER COLUMN workspace_id SET NOT NULL;
