-- Adds Google OAuth identity fields to the users table.
-- Mirrors the existing github_* columns. Both nullable so a user
-- can have any combination of password / GitHub / Google.
--
-- google_id is the stable Google subject identifier (`sub` claim),
-- preferred over email for account linkage since users can change
-- their primary Google email.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS google_id varchar(255),
  ADD COLUMN IF NOT EXISTS google_avatar_url text;

CREATE UNIQUE INDEX IF NOT EXISTS users_google_id_idx
  ON users (google_id)
  WHERE google_id IS NOT NULL;
