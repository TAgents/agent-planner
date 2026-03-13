-- Add system-level admin flag to users table.
-- Used for /admin/* endpoints (stats, user management, etc.)

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "is_admin" boolean NOT NULL DEFAULT false;

-- Index for quick admin lookups
CREATE INDEX IF NOT EXISTS "idx_users_is_admin" ON "users" ("is_admin") WHERE "is_admin" = true;
