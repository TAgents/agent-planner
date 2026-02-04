-- Fix time_horizon column type from DATE to TEXT
-- Allows flexible labels like "quarterly", "Q2 2026", "end of year"

ALTER TABLE goals 
  ALTER COLUMN time_horizon TYPE TEXT;

COMMENT ON COLUMN goals.time_horizon IS 'Flexible time horizon label (e.g., quarterly, Q2 2026, end of year)';
