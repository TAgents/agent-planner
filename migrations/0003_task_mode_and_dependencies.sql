-- Phase 0: Add task_mode to plan_nodes (RPI workflow support)
-- Phase 1: Create node_dependencies table (dependency graph)

-- ─── task_mode column ───────────────────────────────────────────
ALTER TABLE plan_nodes
  ADD COLUMN IF NOT EXISTS task_mode TEXT DEFAULT 'free';

-- ─── node_dependencies table ────────────────────────────────────
CREATE TABLE IF NOT EXISTS node_dependencies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_node_id UUID NOT NULL REFERENCES plan_nodes(id) ON DELETE CASCADE,
  target_node_id UUID NOT NULL REFERENCES plan_nodes(id) ON DELETE CASCADE,
  dependency_type TEXT NOT NULL DEFAULT 'blocks',
  weight INTEGER NOT NULL DEFAULT 1,
  metadata JSONB DEFAULT '{}',
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  -- No self-references
  CONSTRAINT node_deps_no_self_ref CHECK (source_node_id != target_node_id),

  -- Prevent duplicate edges of same type
  CONSTRAINT node_deps_unique_edge UNIQUE (source_node_id, target_node_id, dependency_type)
);

-- Indexes for graph traversal (both directions)
CREATE INDEX IF NOT EXISTS idx_node_deps_source ON node_dependencies(source_node_id);
CREATE INDEX IF NOT EXISTS idx_node_deps_target ON node_dependencies(target_node_id);
CREATE INDEX IF NOT EXISTS idx_node_deps_source_type ON node_dependencies(source_node_id, dependency_type);
CREATE INDEX IF NOT EXISTS idx_node_deps_target_type ON node_dependencies(target_node_id, dependency_type);
