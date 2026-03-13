-- Drop the old flat knowledge_entries table.
-- Knowledge is now stored exclusively in the Graphiti temporal knowledge graph (FalkorDB).
-- The pgvector embedding column and related indexes are no longer needed.
--
-- IMPORTANT: Before running this migration, migrate existing entries to Graphiti:
--   DATABASE_URL=... API_URL=... API_TOKEN=... node scripts/migrate-knowledge-to-graphiti.js
--
-- Use --dry-run first to preview what will be migrated.

DROP TABLE IF EXISTS "knowledge_entries" CASCADE;
