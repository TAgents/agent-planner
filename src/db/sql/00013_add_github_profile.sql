-- Migration: Add GitHub profile columns to users table
-- This allows users to sign in with GitHub OAuth and store their GitHub profile data

-- Add GitHub profile columns to users table
ALTER TABLE users
ADD COLUMN IF NOT EXISTS github_id VARCHAR(255),
ADD COLUMN IF NOT EXISTS github_username VARCHAR(255),
ADD COLUMN IF NOT EXISTS github_avatar_url TEXT,
ADD COLUMN IF NOT EXISTS github_profile_url TEXT;

-- Add indexes for GitHub ID lookups (improves query performance)
CREATE INDEX IF NOT EXISTS idx_users_github_id ON users(github_id);
CREATE INDEX IF NOT EXISTS idx_users_github_username ON users(github_username);

-- Add unique constraint to prevent duplicate GitHub accounts
-- This ensures one GitHub account can only be linked to one user
ALTER TABLE users
DROP CONSTRAINT IF EXISTS unique_github_id;

ALTER TABLE users
ADD CONSTRAINT unique_github_id UNIQUE (github_id);

-- Add comments to document the columns
COMMENT ON COLUMN users.github_id IS 'GitHub user ID (from OAuth provider_id)';
COMMENT ON COLUMN users.github_username IS 'GitHub username (from OAuth user_name)';
COMMENT ON COLUMN users.github_avatar_url IS 'GitHub avatar URL';
COMMENT ON COLUMN users.github_profile_url IS 'Full GitHub profile URL (https://github.com/username)';
