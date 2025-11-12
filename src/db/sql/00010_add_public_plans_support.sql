-- ============================================================================
-- Public Plans Support Migration
-- ============================================================================
-- This migration adds support for public plans that can be viewed by anyone
-- without authentication. It includes:
-- 1. New columns in plans table (is_public, github_repo_owner, github_repo_name, view_count)
-- 2. Indexes for efficient public plan queries
-- 3. Updated RLS policies to allow public read access while protecting edits
-- ============================================================================

-- ============================================================================
-- PART 1: Add New Columns to Plans Table
-- ============================================================================

-- Add is_public column to make plans publicly accessible
ALTER TABLE public.plans
ADD COLUMN IF NOT EXISTS is_public BOOLEAN NOT NULL DEFAULT FALSE;

-- Add GitHub repository information for context linking
ALTER TABLE public.plans
ADD COLUMN IF NOT EXISTS github_repo_owner TEXT;

ALTER TABLE public.plans
ADD COLUMN IF NOT EXISTS github_repo_name TEXT;

-- Add view_count to track plan popularity
ALTER TABLE public.plans
ADD COLUMN IF NOT EXISTS view_count INTEGER NOT NULL DEFAULT 0;

-- Add last_viewed_at to track when plan was last accessed
ALTER TABLE public.plans
ADD COLUMN IF NOT EXISTS last_viewed_at TIMESTAMP WITH TIME ZONE;

-- ============================================================================
-- PART 2: Add Indexes for Public Plans Queries
-- ============================================================================

-- Index for querying public plans (most common query)
CREATE INDEX IF NOT EXISTS idx_plans_is_public
  ON public.plans(is_public)
  WHERE is_public = TRUE;

-- Composite index for public plans ordered by popularity
CREATE INDEX IF NOT EXISTS idx_plans_public_view_count
  ON public.plans(is_public, view_count DESC)
  WHERE is_public = TRUE;

-- Composite index for public plans ordered by recency
CREATE INDEX IF NOT EXISTS idx_plans_public_created_at
  ON public.plans(is_public, created_at DESC)
  WHERE is_public = TRUE;

-- Index for GitHub repository lookups
CREATE INDEX IF NOT EXISTS idx_plans_github_repo
  ON public.plans(github_repo_owner, github_repo_name)
  WHERE github_repo_owner IS NOT NULL AND github_repo_name IS NOT NULL;

-- ============================================================================
-- PART 3: Update RLS Policies for Public Read Access
-- ============================================================================

-- Drop existing plans_select_policy to recreate with public access
DROP POLICY IF EXISTS plans_select_policy ON public.plans;

-- New SELECT policy: allow public read access to public plans, full access to owned/collaborated plans
CREATE POLICY plans_select_policy ON public.plans
  FOR SELECT
  USING (
    is_public = TRUE OR
    owner_id = (SELECT auth.uid()) OR
    EXISTS (
      SELECT 1 FROM public.plan_collaborators
      WHERE plan_id = plans.id AND user_id = (SELECT auth.uid())
    )
  );

-- Update plan_nodes SELECT policy to allow public access for public plans
DROP POLICY IF EXISTS plan_nodes_select_policy ON public.plan_nodes;

CREATE POLICY plan_nodes_select_policy ON public.plan_nodes
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.plans
      WHERE id = plan_nodes.plan_id AND (
        is_public = TRUE OR
        owner_id = (SELECT auth.uid()) OR
        EXISTS (
          SELECT 1 FROM public.plan_collaborators
          WHERE plan_id = plans.id AND user_id = (SELECT auth.uid())
        )
      )
    )
  );

-- Update plan_node_labels SELECT policy for public plans
DROP POLICY IF EXISTS plan_node_labels_select_policy ON public.plan_node_labels;

CREATE POLICY plan_node_labels_select_policy ON public.plan_node_labels
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.plan_nodes pn
      JOIN public.plans p ON pn.plan_id = p.id
      WHERE pn.id = plan_node_labels.plan_node_id AND (
        p.is_public = TRUE OR
        p.owner_id = (SELECT auth.uid()) OR
        EXISTS (
          SELECT 1 FROM public.plan_collaborators
          WHERE plan_id = p.id AND user_id = (SELECT auth.uid())
        )
      )
    )
  );

-- Update plan_node_artifacts SELECT policy for public plans
DROP POLICY IF EXISTS plan_node_artifacts_select_policy ON public.plan_node_artifacts;

CREATE POLICY plan_node_artifacts_select_policy ON public.plan_node_artifacts
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.plan_nodes pn
      JOIN public.plans p ON pn.plan_id = p.id
      WHERE pn.id = plan_node_artifacts.plan_node_id AND (
        p.is_public = TRUE OR
        p.owner_id = (SELECT auth.uid()) OR
        EXISTS (
          SELECT 1 FROM public.plan_collaborators
          WHERE plan_id = p.id AND user_id = (SELECT auth.uid())
        )
      )
    )
  );

-- Update plan_node_logs SELECT policy for public plans
DROP POLICY IF EXISTS plan_node_logs_select_policy ON public.plan_node_logs;

CREATE POLICY plan_node_logs_select_policy ON public.plan_node_logs
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.plan_nodes pn
      JOIN public.plans p ON pn.plan_id = p.id
      WHERE pn.id = plan_node_logs.plan_node_id AND (
        p.is_public = TRUE OR
        p.owner_id = (SELECT auth.uid()) OR
        EXISTS (
          SELECT 1 FROM public.plan_collaborators
          WHERE plan_id = p.id AND user_id = (SELECT auth.uid())
        )
      )
    )
  );

-- ============================================================================
-- PART 4: Add Function to Increment View Count
-- ============================================================================

-- Function to safely increment view count (can be called by anonymous users)
CREATE OR REPLACE FUNCTION public.increment_plan_view_count(plan_uuid UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  -- Only increment for public plans
  UPDATE public.plans
  SET
    view_count = view_count + 1,
    last_viewed_at = CURRENT_TIMESTAMP
  WHERE id = plan_uuid AND is_public = TRUE;
END;
$$;

COMMENT ON FUNCTION public.increment_plan_view_count(UUID) IS
'Increments view count for public plans - can be called by anonymous users';

-- Grant execute permission to anonymous users
GRANT EXECUTE ON FUNCTION public.increment_plan_view_count(UUID) TO anon;
GRANT EXECUTE ON FUNCTION public.increment_plan_view_count(UUID) TO authenticated;

-- ============================================================================
-- PART 5: Add Comments and Documentation
-- ============================================================================

COMMENT ON COLUMN public.plans.is_public IS
'Whether the plan is publicly accessible without authentication';

COMMENT ON COLUMN public.plans.github_repo_owner IS
'GitHub repository owner for context linking (e.g., "facebook")';

COMMENT ON COLUMN public.plans.github_repo_name IS
'GitHub repository name for context linking (e.g., "react")';

COMMENT ON COLUMN public.plans.view_count IS
'Number of times the public plan has been viewed';

COMMENT ON COLUMN public.plans.last_viewed_at IS
'Timestamp of the last time the plan was viewed';

-- ============================================================================
-- Migration Complete
-- ============================================================================
