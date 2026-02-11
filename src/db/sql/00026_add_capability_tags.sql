-- Migration: Add capability_tags to users table
-- Allows agents/users to declare their capabilities (e.g., "coding", "research", "writing")

ALTER TABLE users ADD COLUMN IF NOT EXISTS capability_tags TEXT[] DEFAULT '{}';

-- Index for efficient tag-based queries
CREATE INDEX IF NOT EXISTS idx_users_capability_tags ON users USING GIN (capability_tags);
