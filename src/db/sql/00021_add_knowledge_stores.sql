-- Knowledge Stores System
-- Stores contextual knowledge (decisions, constraints, learnings) for orgs, goals, and plans.
-- Supports semantic search via pgvector embeddings.

-- Enable pgvector extension if not already enabled
CREATE EXTENSION IF NOT EXISTS vector;

-- Knowledge Stores table (containers for knowledge entries)
CREATE TABLE IF NOT EXISTS knowledge_stores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scope TEXT NOT NULL CHECK (scope IN ('organization', 'goal', 'plan')),
  scope_id UUID NOT NULL, -- References org, goal, or plan depending on scope
  storage_mode TEXT NOT NULL DEFAULT 'database' CHECK (storage_mode IN ('database', 'external')),
  name TEXT, -- Optional custom name
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(scope, scope_id) -- One store per scope entity
);

-- Knowledge Entries table
CREATE TABLE IF NOT EXISTS knowledge_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES knowledge_stores(id) ON DELETE CASCADE,
  entry_type TEXT NOT NULL CHECK (entry_type IN ('decision', 'context', 'constraint', 'learning', 'reference', 'note')),
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  source_url TEXT,
  tags TEXT[] DEFAULT '{}',
  metadata JSONB DEFAULT '{}', -- Flexible additional data
  embedding vector(1536), -- OpenAI ada-002 compatible
  created_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Link knowledge_store_id in goals (add foreign key to existing column)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE constraint_name = 'goals_knowledge_store_id_fkey'
  ) THEN
    ALTER TABLE goals 
    ADD CONSTRAINT goals_knowledge_store_id_fkey 
    FOREIGN KEY (knowledge_store_id) REFERENCES knowledge_stores(id) ON DELETE SET NULL;
  END IF;
END $$;

-- Add knowledge_store_id to organizations
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS knowledge_store_id UUID REFERENCES knowledge_stores(id) ON DELETE SET NULL;

-- Add knowledge_store_id to plans
ALTER TABLE plans ADD COLUMN IF NOT EXISTS knowledge_store_id UUID REFERENCES knowledge_stores(id) ON DELETE SET NULL;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_knowledge_stores_scope ON knowledge_stores(scope, scope_id);
CREATE INDEX IF NOT EXISTS idx_knowledge_entries_store ON knowledge_entries(store_id);
CREATE INDEX IF NOT EXISTS idx_knowledge_entries_type ON knowledge_entries(entry_type);
CREATE INDEX IF NOT EXISTS idx_knowledge_entries_tags ON knowledge_entries USING gin(tags);
CREATE INDEX IF NOT EXISTS idx_knowledge_entries_created_by ON knowledge_entries(created_by);

-- Full-text search on entries
CREATE INDEX IF NOT EXISTS idx_knowledge_entries_search ON knowledge_entries 
  USING gin(to_tsvector('english', coalesce(title, '') || ' ' || coalesce(content, '')));

-- Vector similarity search index (IVFFlat for approximate nearest neighbor)
CREATE INDEX IF NOT EXISTS idx_knowledge_entries_embedding ON knowledge_entries 
  USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- RLS Policies for knowledge_stores
ALTER TABLE knowledge_stores ENABLE ROW LEVEL SECURITY;

-- Helper function to check knowledge store access
CREATE OR REPLACE FUNCTION can_access_knowledge_store(store knowledge_stores)
RETURNS BOOLEAN AS $$
BEGIN
  CASE store.scope
    WHEN 'organization' THEN
      RETURN EXISTS (
        SELECT 1 FROM organization_members om
        WHERE om.organization_id = store.scope_id
        AND om.user_id = auth.uid()
      );
    WHEN 'goal' THEN
      RETURN EXISTS (
        SELECT 1 FROM goals g
        JOIN organization_members om ON om.organization_id = g.organization_id
        WHERE g.id = store.scope_id
        AND om.user_id = auth.uid()
      );
    WHEN 'plan' THEN
      RETURN EXISTS (
        SELECT 1 FROM plans p
        WHERE p.id = store.scope_id
        AND (
          p.owner_id = auth.uid()
          OR EXISTS (
            SELECT 1 FROM plan_collaborators pc
            WHERE pc.plan_id = p.id AND pc.user_id = auth.uid()
          )
          OR p.visibility = 'public'
        )
      );
    ELSE
      RETURN FALSE;
  END CASE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Users can see stores they have access to
CREATE POLICY knowledge_stores_select ON knowledge_stores
  FOR SELECT USING (can_access_knowledge_store(knowledge_stores));

-- Users can create stores for their orgs/goals/plans
CREATE POLICY knowledge_stores_insert ON knowledge_stores
  FOR INSERT WITH CHECK (can_access_knowledge_store(knowledge_stores));

-- Users can update stores they have access to
CREATE POLICY knowledge_stores_update ON knowledge_stores
  FOR UPDATE USING (can_access_knowledge_store(knowledge_stores));

-- Users can delete stores they own
CREATE POLICY knowledge_stores_delete ON knowledge_stores
  FOR DELETE USING (can_access_knowledge_store(knowledge_stores));

-- RLS Policies for knowledge_entries
ALTER TABLE knowledge_entries ENABLE ROW LEVEL SECURITY;

-- Users can see entries in stores they have access to
CREATE POLICY knowledge_entries_select ON knowledge_entries
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM knowledge_stores ks
      WHERE ks.id = knowledge_entries.store_id
      AND can_access_knowledge_store(ks)
    )
  );

-- Users can create entries in stores they have access to
CREATE POLICY knowledge_entries_insert ON knowledge_entries
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM knowledge_stores ks
      WHERE ks.id = knowledge_entries.store_id
      AND can_access_knowledge_store(ks)
    )
  );

-- Users can update their own entries or if they're admin/owner
CREATE POLICY knowledge_entries_update ON knowledge_entries
  FOR UPDATE USING (
    created_by = auth.uid()
    OR EXISTS (
      SELECT 1 FROM knowledge_stores ks
      WHERE ks.id = knowledge_entries.store_id
      AND ks.scope = 'organization'
      AND EXISTS (
        SELECT 1 FROM organization_members om
        WHERE om.organization_id = ks.scope_id
        AND om.user_id = auth.uid()
        AND om.role IN ('owner', 'admin')
      )
    )
  );

-- Users can delete their own entries or if they're admin/owner
CREATE POLICY knowledge_entries_delete ON knowledge_entries
  FOR DELETE USING (
    created_by = auth.uid()
    OR EXISTS (
      SELECT 1 FROM knowledge_stores ks
      WHERE ks.id = knowledge_entries.store_id
      AND ks.scope = 'organization'
      AND EXISTS (
        SELECT 1 FROM organization_members om
        WHERE om.organization_id = ks.scope_id
        AND om.user_id = auth.uid()
        AND om.role IN ('owner', 'admin')
      )
    )
  );

-- Semantic search function
CREATE OR REPLACE FUNCTION search_knowledge(
  query_embedding vector(1536),
  store_ids UUID[],
  match_threshold FLOAT DEFAULT 0.7,
  match_count INT DEFAULT 10
)
RETURNS TABLE (
  id UUID,
  store_id UUID,
  entry_type TEXT,
  title TEXT,
  content TEXT,
  source_url TEXT,
  tags TEXT[],
  similarity FLOAT
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    ke.id,
    ke.store_id,
    ke.entry_type,
    ke.title,
    ke.content,
    ke.source_url,
    ke.tags,
    1 - (ke.embedding <=> query_embedding) AS similarity
  FROM knowledge_entries ke
  WHERE ke.store_id = ANY(store_ids)
    AND ke.embedding IS NOT NULL
    AND 1 - (ke.embedding <=> query_embedding) > match_threshold
  ORDER BY ke.embedding <=> query_embedding
  LIMIT match_count;
END;
$$ LANGUAGE plpgsql;

-- Comments
COMMENT ON TABLE knowledge_stores IS 'Containers for knowledge entries, scoped to org/goal/plan';
COMMENT ON TABLE knowledge_entries IS 'Individual knowledge items (decisions, context, learnings)';
COMMENT ON COLUMN knowledge_stores.scope IS 'What this store is attached to: organization, goal, or plan';
COMMENT ON COLUMN knowledge_stores.scope_id IS 'UUID of the org/goal/plan this store belongs to';
COMMENT ON COLUMN knowledge_entries.entry_type IS 'Category: decision, context, constraint, learning, reference, note';
COMMENT ON COLUMN knowledge_entries.embedding IS 'Vector embedding for semantic search (1536 dims for OpenAI ada-002)';
COMMENT ON FUNCTION search_knowledge IS 'Semantic similarity search across knowledge entries';
