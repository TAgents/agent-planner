-- ============================================================================
-- Security Fixes Migration
-- ============================================================================
-- This migration addresses critical security vulnerabilities identified by
-- Supabase security advisors and database linter
--
-- Issues Fixed:
-- 1. CRITICAL: auth.users exposure via node_assignments_with_users view
-- 2. CRITICAL: schema_migrations table lacks RLS
-- 3. HIGH: Functions with mutable search_path (6 functions)
-- 4. MEDIUM: RLS policies re-evaluate auth.uid() on every row
-- 5. MEDIUM: Duplicate/overlapping RLS policies
-- 6. INFO: Missing indexes on foreign keys
-- ============================================================================

-- ============================================================================
-- PART 1: Fix auth.users Exposure (CRITICAL)
-- ============================================================================

-- Drop the insecure view that exposes auth.users
DROP VIEW IF EXISTS public.node_assignments_with_users CASCADE;

-- Recreate view using public.users instead of auth.users
-- Use security_invoker to enforce querying user's permissions
CREATE VIEW public.node_assignments_with_users
WITH (security_invoker=true) AS
SELECT
  na.id,
  na.node_id,
  na.user_id,
  na.assigned_by,
  na.assigned_at,
  u.email AS user_email,
  u.name AS user_name,
  ab.email AS assigned_by_email,
  ab.name AS assigned_by_name
FROM node_assignments na
  JOIN public.users u ON na.user_id = u.id
  JOIN public.users ab ON na.assigned_by = ab.id;

COMMENT ON VIEW public.node_assignments_with_users IS
'Node assignments with user details - uses public.users (RLS enforced) instead of auth.users';

-- ============================================================================
-- PART 2: Enable RLS on schema_migrations (CRITICAL)
-- ============================================================================

ALTER TABLE IF EXISTS public.schema_migrations ENABLE ROW LEVEL SECURITY;

-- Only service role can access migration tracking
DROP POLICY IF EXISTS "Service role only" ON public.schema_migrations;
CREATE POLICY "Service role only" ON public.schema_migrations
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

COMMENT ON TABLE public.schema_migrations IS
'Migration tracking table - only accessible to service role';

-- ============================================================================
-- PART 3: Fix Functions with Mutable Search Path (HIGH)
-- ============================================================================

-- Function 1: update_updated_at_column
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$;

-- Function 2: sync_users_table
CREATE OR REPLACE FUNCTION public.sync_users_table()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.users (id, email, name, created_at, updated_at)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1)),
    NEW.created_at,
    NEW.updated_at
  )
  ON CONFLICT (id) DO UPDATE
  SET
    email = EXCLUDED.email,
    name = COALESCE(NEW.raw_user_meta_data->>'name', EXCLUDED.name),
    updated_at = EXCLUDED.updated_at;

  RETURN NEW;
END;
$$;

-- Function 3: can_assign_user_to_node
CREATE OR REPLACE FUNCTION public.can_assign_user_to_node(
    p_node_id UUID,
    p_user_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_plan_id UUID;
    v_is_collaborator BOOLEAN;
BEGIN
    -- Get the plan_id from the node
    SELECT plan_id INTO v_plan_id
    FROM public.plan_nodes
    WHERE id = p_node_id;

    IF v_plan_id IS NULL THEN
        RETURN FALSE;
    END IF;

    -- Check if the user being assigned is a collaborator on the plan
    SELECT EXISTS (
        SELECT 1
        FROM public.plan_collaborators
        WHERE plan_id = v_plan_id
        AND user_id = p_user_id
    ) INTO v_is_collaborator;

    RETURN v_is_collaborator;
END;
$$;

-- Function 4: log_status_change
CREATE OR REPLACE FUNCTION public.log_status_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF OLD.status IS DISTINCT FROM NEW.status THEN
        INSERT INTO public.audit_logs (user_id, action, resource_type, resource_id, details)
        VALUES (
            auth.uid(),
            'status_change',
            'node',
            NEW.id,
            jsonb_build_object(
                'from_status', OLD.status,
                'to_status', NEW.status,
                'node_title', NEW.title
            )
        );
    END IF;
    RETURN NEW;
END;
$$;

-- Function 5: cleanup_old_presence
CREATE OR REPLACE FUNCTION public.cleanup_old_presence()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    DELETE FROM public.user_presence
    WHERE last_seen < NOW() - INTERVAL '1 hour';
END;
$$;

-- Function 6: search_plan (most complex)
CREATE OR REPLACE FUNCTION public.search_plan(
    input_plan_id UUID,
    search_query TEXT
)
RETURNS TABLE (
    id UUID,
    type TEXT,
    title TEXT,
    content TEXT,
    created_at TIMESTAMPTZ,
    user_id UUID
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    -- Return matching nodes
    RETURN QUERY
    SELECT
        n.id,
        'node'::TEXT AS type,
        n.title,
        COALESCE(n.description, '') AS content,
        n.created_at,
        NULL::UUID AS user_id
    FROM public.plan_nodes n
    WHERE n.plan_id = input_plan_id
        AND (
            to_tsvector('english', n.title || ' ' || COALESCE(n.description, ''))
            @@ plainto_tsquery('english', search_query)
            OR n.title ILIKE '%' || search_query || '%'
            OR n.description ILIKE '%' || search_query || '%'
        )

    UNION ALL

    -- Return matching logs
    SELECT
        l.id,
        'log'::TEXT AS type,
        'Log: ' || l.log_type AS title,
        l.content,
        l.created_at,
        l.user_id
    FROM public.plan_node_logs l
    JOIN public.plan_nodes n ON l.plan_node_id = n.id
    WHERE n.plan_id = input_plan_id
        AND (
            to_tsvector('english', l.content) @@ plainto_tsquery('english', search_query)
            OR l.content ILIKE '%' || search_query || '%'
        )

    UNION ALL

    -- Return matching artifacts
    SELECT
        a.id,
        'artifact'::TEXT AS type,
        a.name AS title,
        COALESCE(a.url, '') AS content,
        a.created_at,
        a.created_by AS user_id
    FROM public.plan_node_artifacts a
    JOIN public.plan_nodes n ON a.plan_node_id = n.id
    WHERE n.plan_id = input_plan_id
        AND (
            to_tsvector('english', a.name) @@ plainto_tsquery('english', search_query)
            OR a.name ILIKE '%' || search_query || '%'
        )

    ORDER BY created_at DESC;
END;
$$;

-- ============================================================================
-- PART 4: Optimize RLS Policies - Replace auth.uid() with (SELECT auth.uid())
-- ============================================================================

-- Users table policies
DROP POLICY IF EXISTS users_policy ON public.users;
CREATE POLICY users_policy ON public.users
  FOR ALL
  USING ((SELECT auth.uid()) = id);

-- Plans table policies
DROP POLICY IF EXISTS plans_select_policy ON public.plans;
CREATE POLICY plans_select_policy ON public.plans
  FOR SELECT
  USING (
    owner_id = (SELECT auth.uid()) OR
    EXISTS (
      SELECT 1 FROM public.plan_collaborators
      WHERE plan_id = plans.id AND user_id = (SELECT auth.uid())
    )
  );

DROP POLICY IF EXISTS plans_insert_policy ON public.plans;
CREATE POLICY plans_insert_policy ON public.plans
  FOR INSERT
  WITH CHECK (owner_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS plans_update_policy ON public.plans;
CREATE POLICY plans_update_policy ON public.plans
  FOR UPDATE
  USING (
    owner_id = (SELECT auth.uid()) OR
    EXISTS (
      SELECT 1 FROM public.plan_collaborators
      WHERE plan_id = plans.id
        AND user_id = (SELECT auth.uid())
        AND role IN ('admin', 'editor')
    )
  );

DROP POLICY IF EXISTS plans_delete_policy ON public.plans;
CREATE POLICY plans_delete_policy ON public.plans
  FOR DELETE
  USING (owner_id = (SELECT auth.uid()));

-- Plan nodes policies
DROP POLICY IF EXISTS plan_nodes_select_policy ON public.plan_nodes;
CREATE POLICY plan_nodes_select_policy ON public.plan_nodes
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.plans
      WHERE id = plan_nodes.plan_id AND (
        owner_id = (SELECT auth.uid()) OR
        EXISTS (
          SELECT 1 FROM public.plan_collaborators
          WHERE plan_id = plans.id AND user_id = (SELECT auth.uid())
        )
      )
    )
  );

DROP POLICY IF EXISTS plan_nodes_insert_policy ON public.plan_nodes;
CREATE POLICY plan_nodes_insert_policy ON public.plan_nodes
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.plans
      WHERE id = plan_nodes.plan_id AND (
        owner_id = (SELECT auth.uid()) OR
        EXISTS (
          SELECT 1 FROM public.plan_collaborators
          WHERE plan_id = plans.id
            AND user_id = (SELECT auth.uid())
            AND role IN ('admin', 'editor')
        )
      )
    )
  );

DROP POLICY IF EXISTS plan_nodes_update_policy ON public.plan_nodes;
CREATE POLICY plan_nodes_update_policy ON public.plan_nodes
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.plans
      WHERE id = plan_nodes.plan_id AND (
        owner_id = (SELECT auth.uid()) OR
        EXISTS (
          SELECT 1 FROM public.plan_collaborators
          WHERE plan_id = plans.id
            AND user_id = (SELECT auth.uid())
            AND role IN ('admin', 'editor')
        )
      )
    )
  );

DROP POLICY IF EXISTS plan_nodes_delete_policy ON public.plan_nodes;
CREATE POLICY plan_nodes_delete_policy ON public.plan_nodes
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.plans
      WHERE id = plan_nodes.plan_id AND (
        owner_id = (SELECT auth.uid()) OR
        EXISTS (
          SELECT 1 FROM public.plan_collaborators
          WHERE plan_id = plans.id
            AND user_id = (SELECT auth.uid())
            AND role IN ('admin', 'editor')
        )
      )
    )
  );

-- Plan collaborators policies
DROP POLICY IF EXISTS plan_collaborators_select_policy ON public.plan_collaborators;
CREATE POLICY plan_collaborators_select_policy ON public.plan_collaborators
  FOR SELECT
  USING (
    user_id = (SELECT auth.uid()) OR
    EXISTS (
      SELECT 1 FROM public.plans
      WHERE id = plan_collaborators.plan_id AND owner_id = (SELECT auth.uid())
    )
  );

DROP POLICY IF EXISTS plan_collaborators_insert_policy ON public.plan_collaborators;
CREATE POLICY plan_collaborators_insert_policy ON public.plan_collaborators
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.plans
      WHERE id = plan_collaborators.plan_id AND owner_id = (SELECT auth.uid())
    )
  );

DROP POLICY IF EXISTS plan_collaborators_update_policy ON public.plan_collaborators;
CREATE POLICY plan_collaborators_update_policy ON public.plan_collaborators
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.plans
      WHERE id = plan_collaborators.plan_id AND owner_id = (SELECT auth.uid())
    )
  );

DROP POLICY IF EXISTS plan_collaborators_delete_policy ON public.plan_collaborators;
CREATE POLICY plan_collaborators_delete_policy ON public.plan_collaborators
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.plans
      WHERE id = plan_collaborators.plan_id AND owner_id = (SELECT auth.uid())
    )
  );

-- Plan node labels policies
DROP POLICY IF EXISTS plan_node_labels_select_policy ON public.plan_node_labels;
CREATE POLICY plan_node_labels_select_policy ON public.plan_node_labels
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.plan_nodes pn
      JOIN public.plans p ON pn.plan_id = p.id
      WHERE pn.id = plan_node_labels.plan_node_id AND (
        p.owner_id = (SELECT auth.uid()) OR
        EXISTS (
          SELECT 1 FROM public.plan_collaborators
          WHERE plan_id = p.id AND user_id = (SELECT auth.uid())
        )
      )
    )
  );

DROP POLICY IF EXISTS plan_node_labels_insert_policy ON public.plan_node_labels;
CREATE POLICY plan_node_labels_insert_policy ON public.plan_node_labels
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.plan_nodes pn
      JOIN public.plans p ON pn.plan_id = p.id
      WHERE pn.id = plan_node_labels.plan_node_id AND (
        p.owner_id = (SELECT auth.uid()) OR
        EXISTS (
          SELECT 1 FROM public.plan_collaborators
          WHERE plan_id = p.id
            AND user_id = (SELECT auth.uid())
            AND role IN ('admin', 'editor')
        )
      )
    )
  );

DROP POLICY IF EXISTS plan_node_labels_delete_policy ON public.plan_node_labels;
CREATE POLICY plan_node_labels_delete_policy ON public.plan_node_labels
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.plan_nodes pn
      JOIN public.plans p ON pn.plan_id = p.id
      WHERE pn.id = plan_node_labels.plan_node_id AND (
        p.owner_id = (SELECT auth.uid()) OR
        EXISTS (
          SELECT 1 FROM public.plan_collaborators
          WHERE plan_id = p.id
            AND user_id = (SELECT auth.uid())
            AND role IN ('admin', 'editor')
        )
      )
    )
  );

-- Plan node artifacts policies
DROP POLICY IF EXISTS plan_node_artifacts_select_policy ON public.plan_node_artifacts;
CREATE POLICY plan_node_artifacts_select_policy ON public.plan_node_artifacts
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.plan_nodes pn
      JOIN public.plans p ON pn.plan_id = p.id
      WHERE pn.id = plan_node_artifacts.plan_node_id AND (
        p.owner_id = (SELECT auth.uid()) OR
        EXISTS (
          SELECT 1 FROM public.plan_collaborators
          WHERE plan_id = p.id AND user_id = (SELECT auth.uid())
        )
      )
    )
  );

DROP POLICY IF EXISTS plan_node_artifacts_insert_policy ON public.plan_node_artifacts;
CREATE POLICY plan_node_artifacts_insert_policy ON public.plan_node_artifacts
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.plan_nodes pn
      JOIN public.plans p ON pn.plan_id = p.id
      WHERE pn.id = plan_node_artifacts.plan_node_id AND (
        p.owner_id = (SELECT auth.uid()) OR
        EXISTS (
          SELECT 1 FROM public.plan_collaborators
          WHERE plan_id = p.id
            AND user_id = (SELECT auth.uid())
            AND role IN ('admin', 'editor')
        )
      )
    )
  );

DROP POLICY IF EXISTS plan_node_artifacts_update_policy ON public.plan_node_artifacts;
CREATE POLICY plan_node_artifacts_update_policy ON public.plan_node_artifacts
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.plan_nodes pn
      JOIN public.plans p ON pn.plan_id = p.id
      WHERE pn.id = plan_node_artifacts.plan_node_id AND (
        p.owner_id = (SELECT auth.uid()) OR
        EXISTS (
          SELECT 1 FROM public.plan_collaborators
          WHERE plan_id = p.id
            AND user_id = (SELECT auth.uid())
            AND role IN ('admin', 'editor')
        )
      )
    )
  );

DROP POLICY IF EXISTS plan_node_artifacts_delete_policy ON public.plan_node_artifacts;
CREATE POLICY plan_node_artifacts_delete_policy ON public.plan_node_artifacts
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.plan_nodes pn
      JOIN public.plans p ON pn.plan_id = p.id
      WHERE pn.id = plan_node_artifacts.plan_node_id AND (
        p.owner_id = (SELECT auth.uid()) OR
        EXISTS (
          SELECT 1 FROM public.plan_collaborators
          WHERE plan_id = p.id
            AND user_id = (SELECT auth.uid())
            AND role IN ('admin', 'editor')
        )
      )
    )
  );

-- ============================================================================
-- PART 5: Merge Duplicate RLS Policies
-- ============================================================================

-- Plan node logs - merge logs_view_policy and plan_node_logs_select_policy
DROP POLICY IF EXISTS logs_view_policy ON public.plan_node_logs;
DROP POLICY IF EXISTS plan_node_logs_select_policy ON public.plan_node_logs;

CREATE POLICY plan_node_logs_select_policy ON public.plan_node_logs
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.plan_nodes pn
      JOIN public.plans p ON pn.plan_id = p.id
      WHERE pn.id = plan_node_logs.plan_node_id AND (
        p.owner_id = (SELECT auth.uid()) OR
        EXISTS (
          SELECT 1 FROM public.plan_collaborators
          WHERE plan_id = p.id AND user_id = (SELECT auth.uid())
        )
      )
    )
  );

DROP POLICY IF EXISTS plan_node_logs_insert_policy ON public.plan_node_logs;
CREATE POLICY plan_node_logs_insert_policy ON public.plan_node_logs
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.plan_nodes pn
      JOIN public.plans p ON pn.plan_id = p.id
      WHERE pn.id = plan_node_logs.plan_node_id AND (
        p.owner_id = (SELECT auth.uid()) OR
        EXISTS (
          SELECT 1 FROM public.plan_collaborators
          WHERE plan_id = p.id
            AND user_id = (SELECT auth.uid())
            AND role IN ('admin', 'editor')
        )
      )
    )
  );

-- User presence - merge two SELECT policies into one comprehensive policy
DROP POLICY IF EXISTS "Users can view presence" ON public.user_presence;
DROP POLICY IF EXISTS "Users can update own presence" ON public.user_presence;

CREATE POLICY "Users can manage presence" ON public.user_presence
  FOR ALL
  USING (
    user_id = (SELECT auth.uid()) OR
    plan_id IN (
      SELECT plan_id FROM public.plan_collaborators
      WHERE user_id = (SELECT auth.uid())
    )
  )
  WITH CHECK (user_id = (SELECT auth.uid()));

-- API tokens policies
DROP POLICY IF EXISTS api_tokens_select_policy ON public.api_tokens;
CREATE POLICY api_tokens_select_policy ON public.api_tokens
  FOR SELECT
  USING (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS api_tokens_insert_policy ON public.api_tokens;
CREATE POLICY api_tokens_insert_policy ON public.api_tokens
  FOR INSERT
  WITH CHECK (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS api_tokens_update_policy ON public.api_tokens;
CREATE POLICY api_tokens_update_policy ON public.api_tokens
  FOR UPDATE
  USING (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS api_tokens_delete_policy ON public.api_tokens;
CREATE POLICY api_tokens_delete_policy ON public.api_tokens
  FOR DELETE
  USING (user_id = (SELECT auth.uid()));

-- Node assignments policies
DROP POLICY IF EXISTS "Users can view node assignments" ON public.node_assignments;
CREATE POLICY "Users can view node assignments" ON public.node_assignments
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.plan_nodes pn
      JOIN public.plans p ON pn.plan_id = p.id
      WHERE pn.id = node_assignments.node_id AND (
        p.owner_id = (SELECT auth.uid()) OR
        EXISTS (
          SELECT 1 FROM public.plan_collaborators
          WHERE plan_id = p.id AND user_id = (SELECT auth.uid())
        )
      )
    )
  );

DROP POLICY IF EXISTS "Users can create node assignments" ON public.node_assignments;
CREATE POLICY "Users can create node assignments" ON public.node_assignments
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.plan_nodes pn
      JOIN public.plans p ON pn.plan_id = p.id
      WHERE pn.id = node_assignments.node_id AND (
        p.owner_id = (SELECT auth.uid()) OR
        EXISTS (
          SELECT 1 FROM public.plan_collaborators
          WHERE plan_id = p.id
            AND user_id = (SELECT auth.uid())
            AND role IN ('admin', 'editor')
        )
      )
    )
  );

DROP POLICY IF EXISTS "Users can delete node assignments" ON public.node_assignments;
CREATE POLICY "Users can delete node assignments" ON public.node_assignments
  FOR DELETE
  USING (
    assigned_by = (SELECT auth.uid()) OR
    EXISTS (
      SELECT 1 FROM public.plan_nodes pn
      JOIN public.plans p ON pn.plan_id = p.id
      WHERE pn.id = node_assignments.node_id AND p.owner_id = (SELECT auth.uid())
    )
  );

-- Audit logs policies
DROP POLICY IF EXISTS "Users can view audit logs" ON public.audit_logs;
CREATE POLICY "Users can view audit logs" ON public.audit_logs
  FOR SELECT
  USING (
    user_id = (SELECT auth.uid()) OR
    EXISTS (
      SELECT 1 FROM public.plans
      WHERE id = audit_logs.resource_id
        AND resource_type = 'plan'
        AND owner_id = (SELECT auth.uid())
    )
  );

-- Contact submissions policies (special case - allow anon insert)
-- Only apply if table exists (production only)
DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'contact_submissions') THEN
    DROP POLICY IF EXISTS "Allow anonymous submissions" ON public.contact_submissions;
    CREATE POLICY "Allow anonymous submissions" ON public.contact_submissions
      FOR INSERT
      TO anon
      WITH CHECK (true);

    DROP POLICY IF EXISTS "Allow auth users to read submissions" ON public.contact_submissions;
    CREATE POLICY "Allow auth users to read submissions" ON public.contact_submissions
      FOR SELECT
      TO authenticated
      USING (true);

    RAISE NOTICE 'Applied RLS policies for contact_submissions table';
  ELSE
    RAISE NOTICE 'Skipping contact_submissions policies - table does not exist';
  END IF;
END $$;

-- ============================================================================
-- PART 6: Add Missing Indexes on Foreign Keys
-- ============================================================================

-- node_assignments.assigned_by foreign key
CREATE INDEX IF NOT EXISTS idx_node_assignments_assigned_by
  ON public.node_assignments(assigned_by);

-- plan_node_artifacts.created_by foreign key
CREATE INDEX IF NOT EXISTS idx_plan_node_artifacts_created_by
  ON public.plan_node_artifacts(created_by);

-- plan_node_logs.user_id foreign key
CREATE INDEX IF NOT EXISTS idx_plan_node_logs_user_id
  ON public.plan_node_logs(user_id);

-- plans.owner_id foreign key
CREATE INDEX IF NOT EXISTS idx_plans_owner_id
  ON public.plans(owner_id);

-- ============================================================================
-- Add documentation comments
-- ============================================================================

COMMENT ON FUNCTION public.update_updated_at_column() IS
'Trigger function to update updated_at timestamp - search_path secured';

COMMENT ON FUNCTION public.sync_users_table() IS
'Syncs auth.users to public.users table - search_path secured';

COMMENT ON FUNCTION public.can_assign_user_to_node(UUID, UUID) IS
'Checks if a user can be assigned to a node - search_path secured';

COMMENT ON FUNCTION public.log_status_change() IS
'Automatically logs status changes on plan nodes - search_path secured';

COMMENT ON FUNCTION public.cleanup_old_presence() IS
'Removes stale presence records older than 1 hour - search_path secured';

COMMENT ON FUNCTION public.search_plan(UUID, TEXT) IS
'Full-text search across plan nodes, logs, and artifacts - search_path secured';

-- ============================================================================
-- Migration complete
-- ============================================================================
