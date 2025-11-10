-- Migration tracking table
-- This table keeps track of which migrations have been applied
-- Must be created before any other migrations

CREATE TABLE IF NOT EXISTS schema_migrations (
  id SERIAL PRIMARY KEY,
  version VARCHAR(255) NOT NULL UNIQUE,
  applied_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Index for fast lookups
CREATE INDEX IF NOT EXISTS idx_schema_migrations_version ON schema_migrations (version);

-- Comment
COMMENT ON TABLE schema_migrations IS 'Tracks which database migrations have been applied';
