-- Migration: Add plan_chat_messages table for plan-level chat with agents

CREATE TABLE IF NOT EXISTS plan_chat_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id UUID NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'agent', 'system')),
  content TEXT NOT NULL,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_plan_chat_plan ON plan_chat_messages(plan_id);
CREATE INDEX IF NOT EXISTS idx_plan_chat_created ON plan_chat_messages(plan_id, created_at);
