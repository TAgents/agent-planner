-- Drop deprecated api_keys table
-- This table has been replaced by api_tokens table
-- The api_tokens table provides enhanced functionality with permissions and token management

-- Drop the deprecated table if it exists
DROP TABLE IF EXISTS api_keys CASCADE;

-- Add comment to document the deprecation
COMMENT ON TABLE api_tokens IS 'API authentication tokens for external access (replaced deprecated api_keys table)';
