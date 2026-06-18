-- Opaque, revocable OAuth refresh tokens. Access tokens become short-lived (1h)
-- AP JWTs; the refresh token is the durable, revocable credential (sha256-hashed,
-- bound to client_id). Also relax the legacy ap_access_token column on auth codes
-- (no longer written — tokens are minted from user_id at exchange).

ALTER TABLE "oauth_auth_codes" ALTER COLUMN "ap_access_token" DROP NOT NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "oauth_refresh_tokens" (
  "token_hash" text PRIMARY KEY NOT NULL,
  "client_id" text NOT NULL,
  "user_id" uuid NOT NULL,
  "scopes" jsonb DEFAULT '[]'::jsonb,
  "expires_at" timestamp with time zone NOT NULL,
  "revoked_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "oauth_refresh_tokens_user_client_idx" ON "oauth_refresh_tokens" ("user_id", "client_id");
