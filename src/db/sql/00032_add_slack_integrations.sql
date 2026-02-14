-- Migration: Add Slack integrations table
-- Stores Slack workspace connections for agent communication

CREATE TABLE IF NOT EXISTS slack_integrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  team_id TEXT NOT NULL,
  team_name TEXT NOT NULL,
  bot_token TEXT NOT NULL,  -- encrypted at application level
  channel_id TEXT,
  channel_name TEXT,
  installed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  is_active BOOLEAN NOT NULL DEFAULT true,
  UNIQUE(user_id, team_id)
);

-- Index for lookups
CREATE INDEX IF NOT EXISTS idx_slack_integrations_user_id ON slack_integrations(user_id);
CREATE INDEX IF NOT EXISTS idx_slack_integrations_team_id ON slack_integrations(team_id);

-- RLS
ALTER TABLE slack_integrations ENABLE ROW LEVEL SECURITY;

-- Users can only see/manage their own integrations
CREATE POLICY "Users can view own slack integrations"
  ON slack_integrations FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own slack integrations"
  ON slack_integrations FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own slack integrations"
  ON slack_integrations FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own slack integrations"
  ON slack_integrations FOR DELETE
  USING (auth.uid() = user_id);

-- Service role bypass for backend
CREATE POLICY "Service role full access to slack integrations"
  ON slack_integrations FOR ALL
  USING (auth.role() = 'service_role');
