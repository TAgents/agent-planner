-- BDI Schema Foundation: episode links, belief snapshots, coherence status, quality scores

-- Task 1: Episode-Node Links table
CREATE TABLE IF NOT EXISTS episode_node_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  episode_id TEXT NOT NULL,
  node_id UUID NOT NULL REFERENCES plan_nodes(id) ON DELETE CASCADE,
  link_type TEXT NOT NULL DEFAULT 'informs',
  created_at TIMESTAMPTZ DEFAULT NOW()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS episode_node_links_unique ON episode_node_links (episode_id, node_id, link_type);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_episode_node_links_node_id ON episode_node_links (node_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_episode_node_links_episode_id ON episode_node_links (episode_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_episode_node_links_type ON episode_node_links (link_type);
--> statement-breakpoint

-- Task 2: Belief snapshot on claims
ALTER TABLE node_claims ADD COLUMN IF NOT EXISTS belief_snapshot JSONB DEFAULT '[]';
--> statement-breakpoint

-- Task 3: Coherence status on plan_nodes
ALTER TABLE plan_nodes ADD COLUMN IF NOT EXISTS coherence_status TEXT DEFAULT 'unchecked';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_plan_nodes_coherence_status ON plan_nodes (coherence_status);
--> statement-breakpoint

-- Task 4: Quality score fields on plans
ALTER TABLE plans ADD COLUMN IF NOT EXISTS quality_score DOUBLE PRECISION;
--> statement-breakpoint
ALTER TABLE plans ADD COLUMN IF NOT EXISTS quality_assessed_at TIMESTAMPTZ;
--> statement-breakpoint
ALTER TABLE plans ADD COLUMN IF NOT EXISTS quality_rationale TEXT;
--> statement-breakpoint

-- Task 4: Quality score fields on plan_nodes
ALTER TABLE plan_nodes ADD COLUMN IF NOT EXISTS quality_score DOUBLE PRECISION;
--> statement-breakpoint
ALTER TABLE plan_nodes ADD COLUMN IF NOT EXISTS quality_assessed_at TIMESTAMPTZ;
--> statement-breakpoint
ALTER TABLE plan_nodes ADD COLUMN IF NOT EXISTS quality_rationale TEXT;
