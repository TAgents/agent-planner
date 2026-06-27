/**
 * Canonical plan rollup — the SINGLE server-side computation of a plan's derived
 * numbers (progress %, work-node status counts, blocked %, effective phase/root
 * roll-up status, and an on-demand critical-path summary). Every surface that
 * shows these (Plans index, Plan detail/tree, plan-progress endpoint, share
 * cards) reads from here so the same plan can't read 68% on one screen and 100%
 * on another.
 *
 * The computation was previously inlined five different ways in plan.service.js
 * (calculatePlanProgress / computePlanStats / getPlanSummary / getPlanProgress /
 * listPublicPlans) — three of them over ALL nodes (root + phases included), one
 * over non-root, and the UI computed a sixth client-side over leaf work nodes.
 * That denominator disagreement is the 68-vs-100 bug. See docs/DERIVATIONS_AUDIT.md.
 *
 * CANONICAL DEFINITION (locked): progress is over WORK nodes only —
 * node_type IN ('task','milestone'). Root and phases are structure, never
 * counted. This matches goalsDal.getDashboardData, the workspaces rollup, and
 * the UI's computeStats.
 */
const dal = require('../db/dal.cjs');

const WORK_TYPES = new Set(['task', 'milestone']);

/**
 * Pure core. Given a plan's nodes (camelCase Drizzle rows, or snake_case — both
 * supported), compute the canonical rollup. No DB access, fully testable.
 *
 * @param {Array<object>} nodes - every node in the plan (incl. root + phases)
 * @returns {{progress_pct:number,total_work:number,completed_work:number,
 *   status_counts:object,blocked_pct:number,container_status:object}}
 */
function rollupFromNodes(nodes) {
  const list = Array.isArray(nodes) ? nodes : [];
  const typeOf = (n) => n.nodeType ?? n.node_type;
  const parentOf = (n) => n.parentId ?? n.parent_id ?? null;

  const status_counts = {
    not_started: 0,
    in_progress: 0,
    completed: 0,
    blocked: 0,
    plan_ready: 0,
  };
  let total_work = 0;
  for (const n of list) {
    if (!WORK_TYPES.has(typeOf(n))) continue; // root + phases are structure
    total_work += 1;
    if (Object.prototype.hasOwnProperty.call(status_counts, n.status)) {
      status_counts[n.status] += 1;
    } else {
      status_counts.not_started += 1; // unknown status → treat as not started
    }
  }
  const completed_work = status_counts.completed;
  const progress_pct = total_work > 0 ? Math.round((completed_work / total_work) * 100) : 0;
  const blocked_pct = total_work > 0 ? Math.round((status_counts.blocked / total_work) * 100) : 0;

  return {
    progress_pct,
    total_work,
    completed_work,
    status_counts,
    blocked_pct,
    container_status: effectiveContainerStatus(list, typeOf, parentOf),
  };
}

/**
 * Effective roll-up status for container nodes (phase + root). A container is
 * "completed" once it has ≥1 work descendant and ALL of them are completed —
 * otherwise the server leaves phases at not_started forever even when their work
 * is done, and non-UI consumers (MCP, exports) see a stale tree. Mirrors the
 * UI's effectivePhaseStatus, now authoritative on the server.
 *
 * @returns {Object<string,'completed'>} nodeId -> 'completed' for done containers
 */
function effectiveContainerStatus(nodes, typeOf, parentOf) {
  const byParent = new Map();
  for (const n of nodes) {
    const key = parentOf(n) || null;
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key).push(n);
  }
  const override = {};
  const summarize = (nodeId) => {
    let hasWork = false;
    let allDone = true;
    for (const c of byParent.get(nodeId) || []) {
      const t = typeOf(c);
      if (t === 'phase' || t === 'root') {
        const s = summarize(c.id);
        if (s.hasWork) {
          hasWork = true;
          if (!s.allDone) allDone = false;
        }
      } else if (WORK_TYPES.has(t)) {
        hasWork = true;
        if (c.status !== 'completed') allDone = false;
      }
    }
    return { hasWork, allDone };
  };
  for (const n of nodes) {
    const t = typeOf(n);
    if (t === 'phase' || t === 'root') {
      const s = summarize(n.id);
      if (s.hasWork && s.allDone) override[n.id] = 'completed';
    }
  }
  return override;
}

/**
 * Canonical rollup for a single plan. Set withCriticalPath to include the
 * (more expensive) longest-blocking-chain summary; omit it for cheap reads.
 *
 * @param {string} planId
 * @param {{withCriticalPath?:boolean}} [opts]
 */
async function computePlanRollup(planId, { withCriticalPath = false } = {}) {
  const nodes = await dal.nodesDal.listByPlan(planId);
  const rollup = rollupFromNodes(nodes);
  if (withCriticalPath) {
    rollup.critical_path = await criticalPathSummary(planId);
  }
  return rollup;
}

/** Compact critical-path summary, or null if there's no blocking chain. */
async function criticalPathSummary(planId) {
  try {
    const cp = await dal.dependenciesDal.getCriticalPath(planId);
    if (!cp || !Array.isArray(cp.nodes) || cp.nodes.length === 0) return null;
    return {
      length: cp.nodes.length,
      total_weight: cp.total_weight ?? 0,
      nodes: cp.nodes.map((n) => ({ id: n.id, title: n.title, status: n.status })),
    };
  } catch {
    return null; // degrade gracefully — a missing critical path never breaks a read
  }
}

/**
 * Batch rollups for many plans (the Plans index). Uses a single grouped
 * aggregate over work nodes — same filter as rollupFromNodes, so list and detail
 * report identical progress. Container status + critical path are detail-only
 * and intentionally omitted here.
 *
 * @param {string[]} planIds
 * @returns {Promise<Map<string, object>>} planId -> lightweight rollup
 */
async function computePlanRollups(planIds) {
  const ids = Array.isArray(planIds) ? planIds.filter(Boolean) : [];
  const out = new Map();
  if (ids.length === 0) return out;

  const rows = await dal.nodesDal.workNodeStatusCountsByPlanIds(ids);
  const byPlan = new Map();
  for (const r of rows) {
    byPlan.set(r.plan_id, r);
  }
  for (const planId of ids) {
    const r = byPlan.get(planId) || {};
    const status_counts = {
      not_started: Number(r.not_started || 0),
      in_progress: Number(r.in_progress || 0),
      completed: Number(r.completed || 0),
      blocked: Number(r.blocked || 0),
      plan_ready: Number(r.plan_ready || 0),
    };
    const total_work = Number(r.total_work || 0);
    const completed_work = status_counts.completed;
    out.set(planId, {
      progress_pct: total_work > 0 ? Math.round((completed_work / total_work) * 100) : 0,
      total_work,
      completed_work,
      status_counts,
      blocked_pct: total_work > 0 ? Math.round((status_counts.blocked / total_work) * 100) : 0,
    });
  }
  return out;
}

module.exports = {
  rollupFromNodes,
  effectiveContainerStatus,
  computePlanRollup,
  computePlanRollups,
  criticalPathSummary,
  WORK_TYPES,
};
