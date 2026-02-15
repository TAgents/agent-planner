-- Phase 4: Knowledge System — pgvector + knowledge_entries table
-- Depends on: pgvector extension

-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Create knowledge_entries table (if not exists)
CREATE TABLE IF NOT EXISTS knowledge_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  scope TEXT NOT NULL DEFAULT 'global',
  scope_id UUID,
  entry_type TEXT NOT NULL DEFAULT 'note',
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  tags TEXT[] DEFAULT '{}',
  source TEXT,
  embedding vector(1536),
  metadata JSONB DEFAULT '{}',
  created_by TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_knowledge_owner ON knowledge_entries(owner_id);
CREATE INDEX IF NOT EXISTS idx_knowledge_scope ON knowledge_entries(scope, scope_id);
CREATE INDEX IF NOT EXISTS idx_knowledge_type ON knowledge_entries(entry_type);
CREATE INDEX IF NOT EXISTS idx_knowledge_source ON knowledge_entries(source);
CREATE INDEX IF NOT EXISTS idx_knowledge_metadata ON knowledge_entries USING gin(metadata);

-- IVFFlat index for vector similarity search (cosine distance)
-- Note: IVFFlat requires at least some rows to build; safe to create on empty table
CREATE INDEX IF NOT EXISTS idx_knowledge_embedding ON knowledge_entries
  USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
