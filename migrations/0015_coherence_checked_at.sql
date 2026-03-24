-- Coherence staleness tracking — compared to updated_at to detect what needs re-checking

ALTER TABLE plans ADD COLUMN IF NOT EXISTS coherence_checked_at TIMESTAMPTZ;
--> statement-breakpoint
ALTER TABLE goals ADD COLUMN IF NOT EXISTS coherence_checked_at TIMESTAMPTZ;
