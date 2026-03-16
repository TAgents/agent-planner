ALTER TABLE api_tokens ADD COLUMN organization_id UUID REFERENCES organizations(id) ON DELETE SET NULL;
--> statement-breakpoint
UPDATE api_tokens t
SET organization_id = (
  SELECT om.organization_id FROM organization_members om
  WHERE om.user_id = t.user_id
  ORDER BY om.joined_at ASC LIMIT 1
)
WHERE t.organization_id IS NULL;
