-- ============================================================================
-- Migration 00023: Remove Artifacts & Simplify Schema (Phase 0)
-- ============================================================================
-- This migration removes artifact support and simplifies the node schema
-- as part of the Phase 0 simplification initiative.
-- ============================================================================

-- ============================================================================
-- BACKUP WARNING
-- ============================================================================
-- Before running this migration in production, ensure you have:
-- 1. A full database backup
-- 2. Exported any artifact URLs that need to be preserved to task descriptions
-- ============================================================================

-- ============================================================================
-- STEP 1: Drop plan_node_artifacts table and related objects
-- ============================================================================

-- Drop RLS policies first
DROP POLICY IF EXISTS plan_node_artifacts_select_policy ON plan_node_artifacts;
DROP POLICY IF EXISTS plan_node_artifacts_insert_policy ON plan_node_artifacts;
DROP POLICY IF EXISTS plan_node_artifacts_update_policy ON plan_node_artifacts;
DROP POLICY IF EXISTS plan_node_artifacts_delete_policy ON plan_node_artifacts;

-- Drop indexes
DROP INDEX IF EXISTS plan_node_artifacts_plan_node_id_idx;
DROP INDEX IF EXISTS idx_plan_node_artifacts_name;
DROP INDEX IF EXISTS idx_plan_node_artifacts_content_type;

-- Drop the table
DROP TABLE IF EXISTS plan_node_artifacts CASCADE;

-- ============================================================================
-- STEP 2: Update search_plan function to remove artifact references
-- ============================================================================

CREATE OR REPLACE FUNCTION search_plan(
    input_plan_id UUID,
    search_query TEXT
) RETURNS TABLE (
    id UUID,
    type TEXT,
    title TEXT,
    content TEXT,
    created_at TIMESTAMPTZ,
    user_id UUID
) AS $$
BEGIN
    -- Return matching nodes
    RETURN QUERY
    SELECT 
        n.id,
        'node'::TEXT as type,
        n.title,
        n.description as content,
        n.created_at,
        p.owner_id as user_id
    FROM 
        plan_nodes n
    JOIN 
        plans p ON n.plan_id = p.id
    WHERE 
        n.plan_id = input_plan_id AND
        (
            n.title ILIKE '%' || search_query || '%' OR
            n.description ILIKE '%' || search_query || '%' OR
            n.context ILIKE '%' || search_query || '%' OR
            n.agent_instructions ILIKE '%' || search_query || '%'
        );
    
    -- Return matching comments
    RETURN QUERY
    SELECT 
        c.id,
        'comment'::TEXT as type,
        'Comment on ' || n.title as title,
        c.content,
        c.created_at,
        c.user_id
    FROM 
        plan_comments c
    JOIN 
        plan_nodes n ON c.plan_node_id = n.id
    WHERE 
        n.plan_id = input_plan_id AND
        c.content ILIKE '%' || search_query || '%';
    
    -- Return matching logs
    RETURN QUERY
    SELECT 
        l.id,
        'log'::TEXT as type,
        'Log for ' || n.title as title,
        l.content,
        l.created_at,
        l.user_id
    FROM 
        plan_node_logs l
    JOIN 
        plan_nodes n ON l.plan_node_id = n.id
    WHERE 
        n.plan_id = input_plan_id AND
        l.content ILIKE '%' || search_query || '%';
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- STEP 3: Simplify plan_nodes table - remove acceptance_criteria
-- ============================================================================
-- Note: We keep due_date for now as it may be useful for scheduling
-- acceptance_criteria can be merged into description

-- First, migrate any acceptance_criteria content to description
UPDATE plan_nodes 
SET description = CASE 
    WHEN description IS NULL OR description = '' THEN acceptance_criteria
    WHEN acceptance_criteria IS NOT NULL AND acceptance_criteria != '' 
        THEN description || E'\n\n**Acceptance Criteria:**\n' || acceptance_criteria
    ELSE description
END
WHERE acceptance_criteria IS NOT NULL AND acceptance_criteria != '';

-- Drop the acceptance_criteria column
ALTER TABLE plan_nodes DROP COLUMN IF EXISTS acceptance_criteria;

-- ============================================================================
-- STEP 4: Update comments
-- ============================================================================

COMMENT ON TABLE plan_nodes IS 'Hierarchical task/phase structure within plans (simplified - artifacts removed)';
COMMENT ON FUNCTION search_plan IS 'Full-text search across plan content (nodes, comments, logs)';

-- ============================================================================
-- STEP 5: Record migration
-- ============================================================================
INSERT INTO schema_migrations (version, applied_at)
VALUES ('00023', NOW())
ON CONFLICT (version) DO NOTHING;

-- ============================================================================
-- END OF MIGRATION
-- ============================================================================
