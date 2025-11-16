-- Migration: Add plan_stars table for starring/favoriting public plans
-- This allows users to bookmark and show appreciation for public plans

-- Create plan_stars table
CREATE TABLE IF NOT EXISTS plan_stars (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan_id UUID NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  CONSTRAINT unique_user_plan_star UNIQUE(user_id, plan_id)
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_plan_stars_plan_id ON plan_stars(plan_id);
CREATE INDEX IF NOT EXISTS idx_plan_stars_user_id ON plan_stars(user_id);
CREATE INDEX IF NOT EXISTS idx_plan_stars_created_at ON plan_stars(created_at);

-- Enable Row Level Security
ALTER TABLE plan_stars ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist (for idempotency)
DROP POLICY IF EXISTS "Users can star any public plan" ON plan_stars;
DROP POLICY IF EXISTS "Users can unstar their own stars" ON plan_stars;
DROP POLICY IF EXISTS "Anyone can view stars" ON plan_stars;

-- RLS Policies

-- Policy: Users can star any public plan
CREATE POLICY "Users can star any public plan"
  ON plan_stars FOR INSERT
  WITH CHECK (
    plan_id IN (SELECT id FROM plans WHERE visibility = 'public')
    AND user_id = auth.uid()
  );

-- Policy: Users can unstar their own stars
CREATE POLICY "Users can unstar their own stars"
  ON plan_stars FOR DELETE
  USING (user_id = auth.uid());

-- Policy: Anyone can view stars (needed for showing star counts on public pages)
CREATE POLICY "Anyone can view stars"
  ON plan_stars FOR SELECT
  USING (true);
