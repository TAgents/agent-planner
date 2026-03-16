-- Add organization_id to goals for org-scoped goal sharing
ALTER TABLE goals ADD COLUMN organization_id UUID REFERENCES organizations(id) ON DELETE SET NULL;
--> statement-breakpoint
CREATE INDEX idx_goals_organization_id ON goals(organization_id);
--> statement-breakpoint

-- Backfill: assign each goal to its owner's first organization
UPDATE goals g
SET organization_id = (
  SELECT om.organization_id
  FROM organization_members om
  WHERE om.user_id = g.owner_id
  ORDER BY om.joined_at ASC
  LIMIT 1
)
WHERE g.organization_id IS NULL;
