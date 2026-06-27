/**
 * Goal-link side effects shared across entry points.
 *
 * Linking a plan to a goal should cascade 'achieves' edges from the plan's task
 * nodes to the goal — those edges are the source of truth for goal progress and
 * the achiever path. This logic previously lived ONLY in the REST route
 * (POST /goals/:id/links), so the createIntention facade (which calls
 * goalsDal.addLink directly) wired zero achievers and its plans fell back to
 * coarse linked-plan stats with an empty achiever path. Extracted here so both
 * paths behave identically.
 */
const dal = require('../../../db/dal.cjs');

/**
 * Create 'achieves' edges from a plan's task nodes to a goal. Idempotent —
 * task nodes that already achieve the goal are skipped. Best-effort by contract:
 * callers treat a throw as non-fatal (the link itself already succeeded).
 *
 * @param {{ goalId: string, planId: string, linkId?: string, userId: string }} args
 * @returns {Promise<number>} number of achiever edges created
 */
async function cascadePlanAchievers({ goalId, planId, linkId = null, userId }) {
  const nodes = await dal.nodesDal.listByPlan(planId);
  const taskNodes = (nodes || []).filter(n => (n.nodeType || n.node_type) === 'task');
  const existing = await dal.dependenciesDal.listByGoal(goalId);
  const existingNodeIds = new Set((existing || []).map(r => r.node?.id).filter(Boolean));

  let created = 0;
  for (const n of taskNodes) {
    if (existingNodeIds.has(n.id)) continue;
    await dal.dependenciesDal.create({
      sourceNodeId: n.id,
      targetGoalId: goalId,
      dependencyType: 'achieves',
      weight: 1,
      metadata: { auto_created_from_link: linkId || true },
      createdBy: userId,
    });
    created++;
  }
  return created;
}

module.exports = { cascadePlanAchievers };
