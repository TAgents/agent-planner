-- Add webhook notification columns to users table
-- Migration: 00016_add_webhook_notifications.sql

-- Add webhook configuration columns to users table
ALTER TABLE users ADD COLUMN IF NOT EXISTS webhook_url TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS webhook_events TEXT[] DEFAULT ARRAY['task.blocked', 'task.assigned']::TEXT[];
ALTER TABLE users ADD COLUMN IF NOT EXISTS webhook_enabled BOOLEAN DEFAULT false;

-- Add index for efficient webhook lookups
CREATE INDEX IF NOT EXISTS idx_users_webhook_enabled ON users(webhook_enabled) WHERE webhook_enabled = true;

-- Create webhook_deliveries table for logging (optional but useful for debugging)
CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', -- pending, success, failed
  status_code INTEGER,
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  delivered_at TIMESTAMPTZ
);

-- Index for querying delivery history
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_user_created ON webhook_deliveries(user_id, created_at DESC);

-- RLS policies for webhook_deliveries
ALTER TABLE webhook_deliveries ENABLE ROW LEVEL SECURITY;

-- Users can only see their own webhook deliveries
CREATE POLICY webhook_deliveries_select_policy ON webhook_deliveries
  FOR SELECT USING (user_id = auth.uid());

-- Only system can insert deliveries (via service role)
CREATE POLICY webhook_deliveries_insert_policy ON webhook_deliveries
  FOR INSERT WITH CHECK (true);
