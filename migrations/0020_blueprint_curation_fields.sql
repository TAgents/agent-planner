-- Curation fields for the public Blueprint gallery.
-- All nullable + additive. Backfilled by scripts/curate-blueprints.mjs.
--
-- tier            — 'featured' | 'community' | 'experimental' | 'example'
-- audience        — array of audience tags (founders, eng-teams, ctos, ai-builders, …)
-- use_case        — array of use-case tags (launch, migration, agent-build, transformation, …)
-- duration_label  — human-readable estimate, e.g. '10 weeks', '1 quarter'
-- outcome         — single-line outcome shown on cards
-- why_fork        — "Use this when…" sentence shown on cards / detail page

ALTER TABLE blueprints
  ADD COLUMN IF NOT EXISTS tier TEXT,
  ADD COLUMN IF NOT EXISTS audience TEXT[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS use_case TEXT[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS duration_label TEXT,
  ADD COLUMN IF NOT EXISTS outcome TEXT,
  ADD COLUMN IF NOT EXISTS why_fork TEXT;

CREATE INDEX IF NOT EXISTS blueprints_tier_idx ON blueprints(tier);
