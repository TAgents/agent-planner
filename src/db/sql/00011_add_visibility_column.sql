-- ============================================================================
-- Add Visibility Column to Plans Table
-- ============================================================================
-- This migration adds a 'visibility' column to the plans table with
-- explicit 'private' or 'public' values. This provides a more extensible
-- approach compared to the boolean is_public column, allowing for future
-- visibility levels (e.g., 'unlisted', 'organization', etc.)
-- ============================================================================

-- ============================================================================
-- PART 1: Add Visibility Column
-- ============================================================================

-- Add visibility column with CHECK constraint
ALTER TABLE public.plans
ADD COLUMN IF NOT EXISTS visibility VARCHAR(20) NOT NULL DEFAULT 'private'
CHECK (visibility IN ('private', 'public'));

-- ============================================================================
-- PART 2: Set Default Values for Existing Plans
-- ============================================================================

-- Update any existing plans that might have NULL visibility to 'private'
-- This ensures data integrity even though the column has a default
UPDATE public.plans
SET visibility = 'private'
WHERE visibility IS NULL;

-- For plans that already have is_public set to true, set visibility to 'public'
-- This ensures consistency between the two fields
UPDATE public.plans
SET visibility = 'public'
WHERE is_public = TRUE AND visibility = 'private';

-- ============================================================================
-- PART 3: Add Index for Visibility Queries
-- ============================================================================

-- Index for efficient visibility-based queries
CREATE INDEX IF NOT EXISTS idx_plans_visibility
  ON public.plans(visibility)
  WHERE visibility = 'public';

-- ============================================================================
-- PART 4: Add Documentation
-- ============================================================================

COMMENT ON COLUMN public.plans.visibility IS
'Plan visibility level: private (owner and collaborators only) or public (anyone can view)';

-- ============================================================================
-- Migration Complete
-- ============================================================================
