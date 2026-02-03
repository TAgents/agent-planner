-- Organizations System
-- Allows users to group plans, goals, and knowledge under organizations

-- Organizations table
CREATE TABLE IF NOT EXISTS organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  description TEXT,
  is_personal BOOLEAN DEFAULT false, -- Personal orgs are auto-created per user
  avatar_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Organization members
CREATE TABLE IF NOT EXISTS organization_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'admin', 'member')),
  joined_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(organization_id, user_id)
);

-- Add org_id to plans (nullable for backward compatibility)
ALTER TABLE plans ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id) ON DELETE SET NULL;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_organizations_slug ON organizations(slug);
CREATE INDEX IF NOT EXISTS idx_organizations_personal ON organizations(is_personal) WHERE is_personal = true;
CREATE INDEX IF NOT EXISTS idx_org_members_org ON organization_members(organization_id);
CREATE INDEX IF NOT EXISTS idx_org_members_user ON organization_members(user_id);
CREATE INDEX IF NOT EXISTS idx_plans_org ON plans(organization_id) WHERE organization_id IS NOT NULL;

-- RLS Policies for organizations
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;

-- Users can see orgs they're members of
CREATE POLICY organizations_select ON organizations
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM organization_members om
      WHERE om.organization_id = organizations.id
      AND om.user_id = auth.uid()
    )
  );

-- Only org owners can update
CREATE POLICY organizations_update ON organizations
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM organization_members om
      WHERE om.organization_id = organizations.id
      AND om.user_id = auth.uid()
      AND om.role = 'owner'
    )
  );

-- Only org owners can delete (non-personal orgs only)
CREATE POLICY organizations_delete ON organizations
  FOR DELETE USING (
    is_personal = false AND
    EXISTS (
      SELECT 1 FROM organization_members om
      WHERE om.organization_id = organizations.id
      AND om.user_id = auth.uid()
      AND om.role = 'owner'
    )
  );

-- RLS Policies for organization_members
ALTER TABLE organization_members ENABLE ROW LEVEL SECURITY;

-- Members can see other members of their orgs
CREATE POLICY org_members_select ON organization_members
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM organization_members om
      WHERE om.organization_id = organization_members.organization_id
      AND om.user_id = auth.uid()
    )
  );

-- Only admins/owners can add members
CREATE POLICY org_members_insert ON organization_members
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM organization_members om
      WHERE om.organization_id = organization_members.organization_id
      AND om.user_id = auth.uid()
      AND om.role IN ('owner', 'admin')
    )
  );

-- Only admins/owners can remove members (can't remove owner)
CREATE POLICY org_members_delete ON organization_members
  FOR DELETE USING (
    role != 'owner' AND
    EXISTS (
      SELECT 1 FROM organization_members om
      WHERE om.organization_id = organization_members.organization_id
      AND om.user_id = auth.uid()
      AND om.role IN ('owner', 'admin')
    )
  );

-- Comments
COMMENT ON TABLE organizations IS 'Organizations group users, plans, goals, and knowledge stores';
COMMENT ON TABLE organization_members IS 'Membership and roles within organizations';
COMMENT ON COLUMN organizations.is_personal IS 'Personal orgs are auto-created for each user and cannot be deleted';
COMMENT ON COLUMN plans.organization_id IS 'Optional organization that owns this plan';
