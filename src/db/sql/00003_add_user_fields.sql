-- Add organization column to users table
ALTER TABLE users ADD COLUMN IF NOT EXISTS organization TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url TEXT;

-- Update existing users with metadata from auth.users
UPDATE users u
SET 
  name = COALESCE(u.name, au.raw_user_meta_data->>'name'),
  organization = COALESCE(u.organization, au.raw_user_meta_data->>'organization'),
  avatar_url = COALESCE(u.avatar_url, au.raw_user_meta_data->>'avatar_url')
FROM auth.users au
WHERE u.id = au.id;
