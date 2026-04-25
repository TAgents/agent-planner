-- Phase 16: Add dimensions column to goal_evaluations for per-dimension quality scores
--
-- Context: GET /goals/:id/quality computes a 5-dimension assessment (clarity,
-- measurability, actionability, knowledge_grounding, commitment) on every call
-- but never persists the per-dimension breakdown — only the rolled-up score
-- can be stored today. Without dimensions, trending per-dimension over time is
-- impossible. This adds a JSONB column to capture the full breakdown shape:
--   { clarity: { score: 1.0, detail: "..." }, ... }
--
-- Backfill: existing rows have NULL dimensions. The endpoint at
-- goals.routes.js:1224 will populate the column going forward when wired to
-- call goalsDal.addEvaluation on each request.

ALTER TABLE goal_evaluations ADD COLUMN IF NOT EXISTS dimensions JSONB;
