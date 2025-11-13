-- ============================================================================
-- Update RLS Policies for Visibility Column
-- ============================================================================
-- This migration updates all RLS policies to use the new 'visibility' column
-- instead of the deprecated 'is_public' column. This provides consistency
-- with the visibility-based architecture introduced in migration 00011.
-- ============================================================================

-- ============================================================================
-- PART 1: Update Plans Table RLS Policies
-- ============================================================================

-- Drop and recreate SELECT policy for plans with visibility column
DROP POLICY IF EXISTS plans_select_policy ON public.plans;

CREATE POLICY plans_select_policy ON public.plans
  FOR SELECT
  USING (
    visibility = 'public' OR
    owner_id = auth.uid() OR
    EXISTS (
      SELECT 1 FROM public.plan_collaborators
      WHERE plan_id = plans.id AND user_id = auth.uid()
    )
  );

-- ============================================================================
-- PART 2: Update Plan Nodes RLS Policies
-- ============================================================================

-- Drop and recreate SELECT policy for plan_nodes with visibility column
DROP POLICY IF EXISTS plan_nodes_select_policy ON public.plan_nodes;

CREATE POLICY plan_nodes_select_policy ON public.plan_nodes
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.plans
      WHERE id = plan_nodes.plan_id AND (
        visibility = 'public' OR
        owner_id = auth.uid() OR
        EXISTS (
          SELECT 1 FROM public.plan_collaborators
          WHERE plan_id = plans.id AND user_id = auth.uid()
        )
      )
    )
  );

-- ============================================================================
-- PART 3: Update Plan Comments RLS Policies
-- ============================================================================

-- Drop and recreate SELECT policy for plan_comments with visibility column
DROP POLICY IF EXISTS plan_comments_select_policy ON public.plan_comments;

CREATE POLICY plan_comments_select_policy ON public.plan_comments
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.plan_nodes pn
      JOIN public.plans p ON pn.plan_id = p.id
      WHERE pn.id = plan_comments.plan_node_id AND (
        p.visibility = 'public' OR
        p.owner_id = auth.uid() OR
        EXISTS (
          SELECT 1 FROM public.plan_collaborators
          WHERE plan_id = p.id AND user_id = auth.uid()
        )
      )
    )
  );

-- ============================================================================
-- PART 4: Update Plan Node Logs RLS Policies
-- ============================================================================

-- Drop and recreate SELECT policy for plan_node_logs with visibility column
DROP POLICY IF EXISTS plan_node_logs_select_policy ON public.plan_node_logs;

CREATE POLICY plan_node_logs_select_policy ON public.plan_node_logs
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.plan_nodes pn
      JOIN public.plans p ON pn.plan_id = p.id
      WHERE pn.id = plan_node_logs.plan_node_id AND (
        p.visibility = 'public' OR
        p.owner_id = auth.uid() OR
        EXISTS (
          SELECT 1 FROM public.plan_collaborators
          WHERE plan_id = p.id AND user_id = auth.uid()
        )
      )
    )
  );

-- ============================================================================
-- PART 5: Update Plan Node Artifacts RLS Policies
-- ============================================================================

-- Drop and recreate SELECT policy for plan_node_artifacts with visibility column
DROP POLICY IF EXISTS plan_node_artifacts_select_policy ON public.plan_node_artifacts;

CREATE POLICY plan_node_artifacts_select_policy ON public.plan_node_artifacts
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.plan_nodes pn
      JOIN public.plans p ON pn.plan_id = p.id
      WHERE pn.id = plan_node_artifacts.plan_node_id AND (
        p.visibility = 'public' OR
        p.owner_id = auth.uid() OR
        EXISTS (
          SELECT 1 FROM public.plan_collaborators
          WHERE plan_id = p.id AND user_id = auth.uid()
        )
      )
    )
  );

-- ============================================================================
-- PART 6: Update Plan Node Labels RLS Policies
-- ============================================================================

-- Drop and recreate SELECT policy for plan_node_labels with visibility column
DROP POLICY IF EXISTS plan_node_labels_select_policy ON public.plan_node_labels;

CREATE POLICY plan_node_labels_select_policy ON public.plan_node_labels
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.plan_nodes pn
      JOIN public.plans p ON pn.plan_id = p.id
      WHERE pn.id = plan_node_labels.plan_node_id AND (
        p.visibility = 'public' OR
        p.owner_id = auth.uid() OR
        EXISTS (
          SELECT 1 FROM public.plan_collaborators
          WHERE plan_id = p.id AND user_id = auth.uid()
        )
      )
    )
  );

-- ============================================================================
-- PART 7: Update View Count Function
-- ============================================================================

-- Update the increment_plan_view_count function to use visibility column
CREATE OR REPLACE FUNCTION public.increment_plan_view_count(plan_uuid UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  -- Only increment for public plans (using visibility column)
  UPDATE public.plans
  SET
    view_count = view_count + 1,
    last_viewed_at = CURRENT_TIMESTAMP
  WHERE id = plan_uuid AND visibility = 'public';
END;
$$;

COMMENT ON FUNCTION public.increment_plan_view_count(UUID) IS
'Increments view count for public plans - can be called by anonymous users';

-- Ensure permissions are set
GRANT EXECUTE ON FUNCTION public.increment_plan_view_count(UUID) TO anon;
GRANT EXECUTE ON FUNCTION public.increment_plan_view_count(UUID) TO authenticated;

-- ============================================================================
-- PART 8: Add Documentation
-- ============================================================================

COMMENT ON POLICY plans_select_policy ON public.plans IS
'Allow SELECT for public plans, owned plans, and collaborated plans';

COMMENT ON POLICY plan_nodes_select_policy ON public.plan_nodes IS
'Allow SELECT for nodes in public plans, owned plans, and collaborated plans';

COMMENT ON POLICY plan_comments_select_policy ON public.plan_comments IS
'Allow SELECT for comments on nodes in public plans, owned plans, and collaborated plans';

COMMENT ON POLICY plan_node_logs_select_policy ON public.plan_node_logs IS
'Allow SELECT for logs on nodes in public plans, owned plans, and collaborated plans';

COMMENT ON POLICY plan_node_artifacts_select_policy ON public.plan_node_artifacts IS
'Allow SELECT for artifacts on nodes in public plans, owned plans, and collaborated plans';

COMMENT ON POLICY plan_node_labels_select_policy ON public.plan_node_labels IS
'Allow SELECT for labels on nodes in public plans, owned plans, and collaborated plans';

-- ============================================================================
-- Migration Complete
-- ============================================================================
