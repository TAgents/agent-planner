-- Phase 0 (UI redesign v1): tool_calls telemetry table
-- One row per inbound MCP tool / REST API call. Powers the Settings →
-- Integrations dashboard (recent calls per token, connection liveness)
-- and the Activity surface in the v1 UI redesign.

CREATE TABLE IF NOT EXISTS tool_calls (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token_id UUID REFERENCES api_tokens(id) ON DELETE SET NULL,
  organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  tool_name TEXT NOT NULL,
  client_label TEXT,
  user_agent TEXT,
  ip TEXT,
  duration_ms INTEGER,
  response_status INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
--> statement-breakpoint

-- Most-common query: "last N calls for token X" → covered by (token_id, created_at DESC)
CREATE INDEX IF NOT EXISTS idx_tool_calls_token_created
  ON tool_calls (token_id, created_at DESC);
--> statement-breakpoint

-- Org-wide activity surfaces (Mission Control, Integrations top-of-page summaries)
CREATE INDEX IF NOT EXISTS idx_tool_calls_org_created
  ON tool_calls (organization_id, created_at DESC);
