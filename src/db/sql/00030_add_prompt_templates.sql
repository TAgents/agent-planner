-- Migration: Add prompt templates for OpenClaw integration

CREATE TABLE IF NOT EXISTS prompt_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id UUID REFERENCES plans(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  template TEXT NOT NULL,
  description TEXT,
  type TEXT NOT NULL DEFAULT 'plan' CHECK (type IN ('plan', 'task', 'review', 'summary', 'custom')),
  is_default BOOLEAN DEFAULT false,
  variables JSONB DEFAULT '[]'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_prompt_templates_plan ON prompt_templates(plan_id);
CREATE INDEX IF NOT EXISTS idx_prompt_templates_user ON prompt_templates(user_id);
CREATE INDEX IF NOT EXISTS idx_prompt_templates_type ON prompt_templates(type);
