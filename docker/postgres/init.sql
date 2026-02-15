-- AgentPlanner PostgreSQL initialization
-- This runs on first container start (empty data volume)

-- Enable extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "vector";       -- pgvector for semantic search
CREATE EXTENSION IF NOT EXISTS "pg_trgm";      -- trigram for fuzzy text search
