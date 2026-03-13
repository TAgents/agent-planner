-- Phase 7: Goals as first-class dependency targets
-- Adds target_goal_id to node_dependencies so tasks can link to goals via 'achieves' edges.
-- target_node_id becomes nullable; exactly one of target_node_id or target_goal_id must be set.

-- Step 1: Make target_node_id nullable
ALTER TABLE node_dependencies ALTER COLUMN target_node_id DROP NOT NULL;
--> statement-breakpoint

-- Step 2: Add target_goal_id column with FK to goals
ALTER TABLE node_dependencies ADD COLUMN target_goal_id UUID REFERENCES goals(id) ON DELETE CASCADE;
--> statement-breakpoint

-- Step 3: Add XOR check constraint — exactly one target must be set
ALTER TABLE node_dependencies ADD CONSTRAINT node_deps_target_xor
  CHECK (
    (target_node_id IS NOT NULL AND target_goal_id IS NULL)
    OR (target_node_id IS NULL AND target_goal_id IS NOT NULL)
  );
--> statement-breakpoint

-- Step 4: Update self-ref constraint to account for nullable target_node_id
ALTER TABLE node_dependencies DROP CONSTRAINT IF EXISTS node_deps_no_self_ref;
--> statement-breakpoint
ALTER TABLE node_dependencies ADD CONSTRAINT node_deps_no_self_ref
  CHECK (target_node_id IS NULL OR source_node_id != target_node_id);
--> statement-breakpoint

-- Step 5: Add unique constraint for node→goal edges
ALTER TABLE node_dependencies ADD CONSTRAINT node_deps_unique_goal_edge
  UNIQUE (source_node_id, target_goal_id, dependency_type);
--> statement-breakpoint

-- Step 6: Add index for goal target lookups
CREATE INDEX idx_node_deps_target_goal ON node_dependencies (target_goal_id) WHERE target_goal_id IS NOT NULL;
