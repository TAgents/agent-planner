-- Goals System
-- High-level objectives that drive plans. Linked to organizations.

-- Goals table
CREATE TABLE IF NOT EXISTS goals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  success_metrics JSONB DEFAULT '[]', -- Array of {metric, target, current, unit}
  time_horizon DATE, -- Target completion date
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'achieved', 'at_risk', 'abandoned')),
  github_repo_url TEXT,
  knowledge_store_id UUID, -- Will reference knowledge_stores when created
  created_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Plan-Goal junction table (many-to-many)
CREATE TABLE IF NOT EXISTS plan_goals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id UUID NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  goal_id UUID NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
  linked_at TIMESTAMPTZ DEFAULT NOW(),
  linked_by UUID REFERENCES users(id),
  
  UNIQUE(plan_id, goal_id)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_goals_org ON goals(organization_id);
CREATE INDEX IF NOT EXISTS idx_goals_status ON goals(status);
CREATE INDEX IF NOT EXISTS idx_goals_created_by ON goals(created_by);
CREATE INDEX IF NOT EXISTS idx_plan_goals_plan ON plan_goals(plan_id);
CREATE INDEX IF NOT EXISTS idx_plan_goals_goal ON plan_goals(goal_id);

-- Full-text search on goals
CREATE INDEX IF NOT EXISTS idx_goals_search ON goals USING gin(to_tsvector('english', coalesce(title, '') || ' ' || coalesce(description, '')));

-- RLS Policies for goals
ALTER TABLE goals ENABLE ROW LEVEL SECURITY;

-- Users can see goals in their organizations
CREATE POLICY goals_select ON goals
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM organization_members om
      WHERE om.organization_id = goals.organization_id
      AND om.user_id = auth.uid()
    )
  );

-- Org members can create goals
CREATE POLICY goals_insert ON goals
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM organization_members om
      WHERE om.organization_id = goals.organization_id
      AND om.user_id = auth.uid()
    )
  );

-- Org admins/owners can update goals
CREATE POLICY goals_update ON goals
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM organization_members om
      WHERE om.organization_id = goals.organization_id
      AND om.user_id = auth.uid()
      AND om.role IN ('owner', 'admin')
    )
    OR created_by = auth.uid()
  );

-- Org admins/owners can delete goals
CREATE POLICY goals_delete ON goals
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM organization_members om
      WHERE om.organization_id = goals.organization_id
      AND om.user_id = auth.uid()
      AND om.role IN ('owner', 'admin')
    )
  );

-- RLS Policies for plan_goals
ALTER TABLE plan_goals ENABLE ROW LEVEL SECURITY;

-- Users can see plan-goal links for their plans
CREATE POLICY plan_goals_select ON plan_goals
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM plans p
      WHERE p.id = plan_goals.plan_id
      AND (
        p.owner_id = auth.uid()
        OR EXISTS (
          SELECT 1 FROM plan_collaborators pc
          WHERE pc.plan_id = p.id AND pc.user_id = auth.uid()
        )
      )
    )
  );

-- Plan owners/collaborators can link goals
CREATE POLICY plan_goals_insert ON plan_goals
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM plans p
      WHERE p.id = plan_goals.plan_id
      AND (
        p.owner_id = auth.uid()
        OR EXISTS (
          SELECT 1 FROM plan_collaborators pc
          WHERE pc.plan_id = p.id AND pc.user_id = auth.uid()
        )
      )
    )
  );

-- Plan owners/collaborators can unlink goals
CREATE POLICY plan_goals_delete ON plan_goals
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM plans p
      WHERE p.id = plan_goals.plan_id
      AND (
        p.owner_id = auth.uid()
        OR EXISTS (
          SELECT 1 FROM plan_collaborators pc
          WHERE pc.plan_id = p.id AND pc.user_id = auth.uid()
        )
      )
    )
  );

-- Comments
COMMENT ON TABLE goals IS 'High-level objectives that drive plans within organizations';
COMMENT ON TABLE plan_goals IS 'Links between plans and the goals they contribute to';
COMMENT ON COLUMN goals.success_metrics IS 'JSON array of metrics: [{metric, target, current, unit}]';
COMMENT ON COLUMN goals.time_horizon IS 'Target date for achieving the goal';
