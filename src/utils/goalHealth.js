/**
 * Canonical goal-health classifier — the SINGLE source of truth for
 * on_track / at_risk / stale, shared by the briefing (agentLoop.service) and
 * the goals dashboard (v2/goals.routes). These two endpoints previously
 * duplicated the logic and disagreed: the dashboard gated staleness on
 * "has linked plans", so a goal with no plans and no activity fell through to
 * on_track while the briefing (correctly) called it stale. Same goal, two
 * verdicts. Keeping one function removes that class of drift.
 *
 * Rules:
 *  - stale    — no execution path (no plans / no task+milestone nodes) OR no
 *               log activity on any linked plan within `staleMs` (default 3d).
 *               A goal nobody has planned or touched needs attention.
 *  - at_risk  — has a path and is fresh, but shows trouble: bottlenecks,
 *               >30% blocked, or pending decisions that have gone stale.
 *  - on_track — has a path, fresh activity, no trouble signals.
 */
const DEFAULT_STALE_MS = 3 * 24 * 60 * 60 * 1000;

function classifyGoalHealth({
  hasLinkedPlans,
  totalNodes,
  lastActivityTs,
  bottleneckCount = 0,
  percentBlocked = 0,
  stalePendingCount = 0,
  staleMs = DEFAULT_STALE_MS,
  now = Date.now(),
}) {
  const hasPath = Boolean(hasLinkedPlans) && Number(totalNodes) > 0;
  const isStale = !hasPath || !lastActivityTs || (now - lastActivityTs > staleMs);
  if (isStale) return 'stale';
  if (bottleneckCount > 0 || percentBlocked > 30 || stalePendingCount > 0) return 'at_risk';
  return 'on_track';
}

module.exports = { classifyGoalHealth, DEFAULT_STALE_MS };
