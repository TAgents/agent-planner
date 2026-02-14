-- Phase 4: Knowledge System — pgvector embeddings
-- Requires: CREATE EXTENSION vector (already in docker/postgres/init.sql)

-- Add embedding column (1536 dims for OpenAI text-embedding-3-small)
ALTER TABLE "knowledge_entries" ADD COLUMN IF NOT EXISTS "embedding" vector(1536);

-- IVFFlat index for cosine similarity search
-- lists = 100 is reasonable up to ~1M rows; tune later
CREATE INDEX IF NOT EXISTS "idx_knowledge_embedding"
  ON "knowledge_entries" USING ivfflat ("embedding" vector_cosine_ops) WITH (lists = 100);

-- GIN index on tags array for tag filtering
CREATE INDEX IF NOT EXISTS "idx_knowledge_tags"
  ON "knowledge_entries" USING gin ("tags");

-- Partial index: only rows with embeddings (speeds up semantic search)
CREATE INDEX IF NOT EXISTS "idx_knowledge_has_embedding"
  ON "knowledge_entries" ("created_at" DESC) WHERE "embedding" IS NOT NULL;
