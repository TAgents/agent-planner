-- Add an index to the api_tokens table for faster token lookups
CREATE INDEX IF NOT EXISTS idx_api_tokens_token_hash ON api_tokens (token_hash);

-- Add comment to the index
COMMENT ON INDEX idx_api_tokens_token_hash IS 'Index for token_hash for faster API token lookups';
