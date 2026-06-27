/**
 * Canonical goal rollup — the SINGLE server-side computation of a goal's
 * cross-view numbers (health, execution %, blocked %, linked-plan count,
 * attainment, pending decisions, bottlenecks). Every surface that shows these
 * (Mission dashboard, Goal detail / goal_state, briefing) reads from here so
 * the same goal can't read AT RISK on one screen and ON TRACK on another.
 *
 * The computation was previously inlined in the GET /goals/dashboard handler;
 * goal_state and the briefing each re-derived health a different way (and the
 * frontend a third). Extracting it removes that whole class of drift.
 *
 * Source of truth for the inputs is goalsDal.getDashboardData() (one SQL,
 * active goals, canonical linked_plan_count = distinct non-archived plans) plus
 * per-plan bottleneck detection. Health is decided by utils/goalHealth.js.
 */
const reasoning = require('./reasoning');
const { classifyGoalHealth } = require('../utils/goalHealth');
const { criteriaAttainment } = require('../utils/goalCriteria');
const dal = require('../db/dal.cjs');

/**
 * Build the canonical rollup for one dashboard row (the shape returned by
 * goalsDal.getDashboardData). Runs bounded bottleneck detection (≤5 plans).
 */
async function rollupFromRow(row) {
  const totalNodes = row.total_nodes;
  const completedNodes = row.completed_nodes;
  const inProgressNodes = row.in_progress_nodes || 0;
  const blockedNodes = row.blocked_nodes;
  const planReadyNodes = row.plan_ready_nodes;
  const agentRequestNodes = row.agent_request_nodes;
  const stalePlanReady = row.stale_plan_ready_nodes;
  const staleAgentRequest = row.stale_agent_request_nodes;
  const linkedPlanCount = row.linked_plan_count;
  const lastLogAt = row.last_log_at;

  const percentCompleted = totalNodes > 0 ? Math.round((completedNodes / totalNodes) * 100) : 0;
  const percentBlocked = totalNodes > 0 ? Math.round((blockedNodes / totalNodes) * 100) : 0;
  const pendingDecisionCount = planReadyNodes + agentRequestNodes;
  const stalePendingDecisions = stalePlanReady + staleAgentRequest;

  // Bottlenecks across linked plans (cap at 5 plans), highest fan-out first.
  let bottleneckSummary = [];
  const planIds = Array.isArray(row.plan_ids) ? row.plan_ids.filter(Boolean) : [];
  if (planIds.length > 0) {
    const allBottlenecks = [];
    for (const planId of planIds.slice(0, 5)) {
      try {
        const bottlenecks = await reasoning.detectBottlenecks(planId, { limit: 3, incomplete_only: true });
        allBottlenecks.push(...bottlenecks);
      } catch { /* skip plan on error */ }
    }
    bottleneckSummary = allBottlenecks
      .sort((a, b) => b.direct_downstream_count - a.direct_downstream_count)
      .slice(0, 3);
  }

  const lastActivityTs = lastLogAt ? new Date(lastLogAt).getTime() : null;
  const attainment = criteriaAttainment(row.success_criteria);
  const health = classifyGoalHealth({
    hasLinkedPlans: linkedPlanCount > 0,
    totalNodes,
    lastActivityTs,
    bottleneckCount: bottleneckSummary.length,
    percentBlocked,
    stalePendingCount: stalePendingDecisions,
    attainmentPct: attainment.attainment_pct,
    executionPct: percentCompleted,
  });

  return {
    id: row.id,
    title: row.title,
    description: row.description,
    type: row.type,
    committed: Boolean(row.committed),
    status: row.status,
    workspace_id: row.workspace_id || null,
    owner_name: row.owner_name || null,
    // ── Canonical cross-view numbers ──
    health,
    execution_pct: percentCompleted,
    percent_blocked: percentBlocked,
    total_nodes: totalNodes,
    completed_nodes: completedNodes,
    in_progress_nodes: inProgressNodes,
    blocked_nodes: blockedNodes,
    linked_plan_count: linkedPlanCount,
    attainment_pct: attainment.attainment_pct,
    attainment: { measurable_count: attainment.measurable_count, met_count: attainment.met_count },
    pending_decision_count: pendingDecisionCount,
    bottleneck_summary: bottleneckSummary,
    last_activity: lastLogAt || null,
    knowledge_gap_count: 0, // requires Graphiti — 0 when unavailable
  };
}

/**
 * Compute canonical rollups for the caller's goals.
 *
 * @param {object} params
 * @param {string} params.userId
 * @param {string[]} [params.organizationIds]
 * @param {string[]|null} [params.goalIds] - restrict to these goal ids (e.g. a
 *   single goal for goal_state). null = all of the user's ACTIVE goals.
 * @returns {Promise<Array>} canonical rollups
 */
async function computeGoalRollups({ userId, organizationIds = [], goalIds = null }) {
  const rows = await dal.goalsDal.getDashboardData({ organizationIds, userId });
  const wanted = goalIds ? rows.filter((r) => goalIds.includes(r.id)) : rows;
  return Promise.all(wanted.map(rollupFromRow));
}

/** Convenience: canonical rollup for a single goal, or null if not found/active. */
async function computeGoalRollup({ userId, organizationIds = [], goalId }) {
  const [rollup] = await computeGoalRollups({ userId, organizationIds, goalIds: [goalId] });
  return rollup || null;
}

module.exports = { computeGoalRollups, computeGoalRollup, rollupFromRow };
