-- Pending plan invitations for email-based sharing
-- Users who don't have an account yet receive an invite that converts on signup

CREATE TABLE IF NOT EXISTS pending_invites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id UUID NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'viewer' CHECK (role IN ('viewer', 'editor', 'admin')),
  invited_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token UUID DEFAULT gen_random_uuid(), -- For secure invite links
  created_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '7 days'),
  
  -- Prevent duplicate invites for same email/plan
  UNIQUE(plan_id, email)
);

-- Index for looking up invites by email (on signup)
CREATE INDEX IF NOT EXISTS idx_pending_invites_email ON pending_invites(email);

-- Index for looking up invites by token (for invite links)
CREATE INDEX IF NOT EXISTS idx_pending_invites_token ON pending_invites(token);

-- Index for cleanup of expired invites
CREATE INDEX IF NOT EXISTS idx_pending_invites_expires ON pending_invites(expires_at);

-- RLS Policies
ALTER TABLE pending_invites ENABLE ROW LEVEL SECURITY;

-- Plan owners and admins can see invites for their plans
CREATE POLICY pending_invites_select ON pending_invites
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM plans p
      WHERE p.id = pending_invites.plan_id
      AND (
        p.owner_id = auth.uid()
        OR EXISTS (
          SELECT 1 FROM plan_collaborators pc
          WHERE pc.plan_id = p.id
          AND pc.user_id = auth.uid()
          AND pc.role = 'admin'
        )
      )
    )
  );

-- Plan owners and admins can insert invites
CREATE POLICY pending_invites_insert ON pending_invites
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM plans p
      WHERE p.id = pending_invites.plan_id
      AND (
        p.owner_id = auth.uid()
        OR EXISTS (
          SELECT 1 FROM plan_collaborators pc
          WHERE pc.plan_id = p.id
          AND pc.user_id = auth.uid()
          AND pc.role = 'admin'
        )
      )
    )
  );

-- Plan owners and admins can delete invites
CREATE POLICY pending_invites_delete ON pending_invites
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM plans p
      WHERE p.id = pending_invites.plan_id
      AND (
        p.owner_id = auth.uid()
        OR EXISTS (
          SELECT 1 FROM plan_collaborators pc
          WHERE pc.plan_id = p.id
          AND pc.user_id = auth.uid()
          AND pc.role = 'admin'
        )
      )
    )
  );

-- Comment
COMMENT ON TABLE pending_invites IS 'Stores pending plan invitations for users who do not yet have an account';
