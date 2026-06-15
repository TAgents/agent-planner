-- OAuth authorization-server state for the hosted MCP (claude.ai / Claude Design connectors).
-- No token table by design: the OAuth access_token is the user's AP JWT (stateless).

CREATE TABLE IF NOT EXISTS "oauth_clients" (
  "client_id" text PRIMARY KEY NOT NULL,
  "client_secret" text,
  "client_name" text,
  "redirect_uris" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "grant_types" jsonb DEFAULT '[]'::jsonb,
  "response_types" jsonb DEFAULT '[]'::jsonb,
  "scope" text,
  "token_endpoint_auth_method" text DEFAULT 'client_secret_basic',
  "metadata" jsonb DEFAULT '{}'::jsonb,
  "client_id_issued_at" timestamp with time zone DEFAULT now(),
  "created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "oauth_auth_codes" (
  "code" text PRIMARY KEY NOT NULL,
  "client_id" text NOT NULL,
  "code_challenge" text,
  "code_challenge_method" text DEFAULT 'S256',
  "redirect_uri" text NOT NULL,
  "scopes" jsonb DEFAULT '[]'::jsonb,
  "user_id" uuid,
  "ap_access_token" text NOT NULL,
  "ap_refresh_token" text,
  "expires_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "oauth_auth_codes_expires_idx" ON "oauth_auth_codes" ("expires_at");
