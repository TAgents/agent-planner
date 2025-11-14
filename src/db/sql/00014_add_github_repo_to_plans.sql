-- Migration: Add GitHub repository linking to plans table
-- This allows plans to be linked to GitHub repositories for better collaboration and visibility

-- Add GitHub repository columns to plans table
ALTER TABLE plans
ADD COLUMN IF NOT EXISTS github_repo_owner VARCHAR(255),  -- e.g., "facebook" or "octocat"
ADD COLUMN IF NOT EXISTS github_repo_name VARCHAR(255),   -- e.g., "react"
ADD COLUMN IF NOT EXISTS github_repo_url TEXT,            -- Full URL: https://github.com/owner/repo
ADD COLUMN IF NOT EXISTS github_repo_full_name VARCHAR(512); -- Combined: "owner/repo"

-- Add index for repository lookups (improves query performance)
CREATE INDEX IF NOT EXISTS idx_plans_github_repo ON plans(github_repo_owner, github_repo_name);

-- Add comments explaining the columns
COMMENT ON COLUMN plans.github_repo_owner IS 'GitHub repository owner (user or organization)';
COMMENT ON COLUMN plans.github_repo_name IS 'GitHub repository name';
COMMENT ON COLUMN plans.github_repo_url IS 'Full GitHub repository URL';
COMMENT ON COLUMN plans.github_repo_full_name IS 'Full repository name in owner/repo format';
