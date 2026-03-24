/**
 * Plan Quality Evaluator (BDI Phase 4)
 *
 * Heuristic quality scoring for plans. No LLM calls — agents provide
 * richer evaluation via their own reasoning. This provides the baseline.
 *
 * 4 sub-scores (0.0-1.0), equally weighted:
 *   1. Coverage — tasks map to the goal
 *   2. Specificity — tasks have clear descriptions/acceptance criteria
 *   3. Ordering — dependencies are explicit
 *   4. Completeness — knowledge gaps are filled (Graphiti)
 */
const dal = require('../db/dal.cjs');
const graphitiBridge = require('./graphitiBridge');

/**
 * Evaluate plan quality with heuristic scoring.
 *
 * @param {string} planId
 * @param {string|null} goalId - If provided, checks goal coverage
 * @param {object} [opts] - Optional context
 * @param {string} [opts.orgId] - Organization ID for Graphiti namespace
 * @param {string} [opts.userId] - User ID for Graphiti namespace fallback
 * @returns {Promise<{score, coverage, specificity, ordering, completeness, rationale}>}
 */
async function evaluatePlanQuality(planId, goalId, opts = {}) {
  const nodes = await dal.nodesDal.listByPlan(planId);
  const tasks = nodes.filter(n => n.nodeType === 'task' || n.nodeType === 'milestone');

  if (tasks.length === 0) {
    return {
      score: 0,
      coverage: 0,
      specificity: 0,
      ordering: 0,
      completeness: 0,
      rationale: 'Plan has no tasks',
    };
  }

  // 1. Coverage — how many tasks contribute to the goal?
  let coverage = 0.5; // Default when no goal specified
  let achieverCount = 0;
  if (goalId) {
    try {
      const { nodes: goalPath } = await dal.dependenciesDal.getGoalPath(goalId);
      achieverCount = goalPath.length;
      coverage = Math.min(achieverCount / tasks.length, 1.0);
    } catch {
      coverage = 0;
    }
  }

  // 2. Specificity — tasks have meaningful descriptions
  const specificTasks = tasks.filter(t => {
    const desc = (t.description || '') + (t.agentInstructions || '');
    return desc.length > 50;
  });
  const specificity = specificTasks.length / tasks.length;

  // 3. Ordering — tasks have explicit dependencies
  let ordering = 0;
  try {
    const deps = await dal.dependenciesDal.listByPlan(planId);
    const nodesWithDeps = new Set();
    for (const d of deps) {
      const dep = d.dependency || d;
      nodesWithDeps.add(dep.sourceNodeId);
      if (dep.targetNodeId) nodesWithDeps.add(dep.targetNodeId);
    }
    const deppedTasks = tasks.filter(t => nodesWithDeps.has(t.id));
    ordering = tasks.length > 1 ? deppedTasks.length / (tasks.length - 1) : 1.0;
    ordering = Math.min(ordering, 1.0);
  } catch {
    ordering = 0;
  }

  // 4. Completeness — knowledge coverage via Graphiti
  let completeness = 0.5; // Neutral default when Graphiti unavailable
  if (graphitiBridge.isAvailable()) {
    try {
      // Build correct group_id — use org if available, else user namespace
      const groupId = opts.orgId
        ? graphitiBridge.orgGroupId(opts.orgId)
        : opts.userId
          ? `user_${opts.userId}`
          : graphitiBridge.orgGroupId(null);
      let coveredCount = 0;
      const sampled = tasks.slice(0, 10); // Cap for performance
      for (const task of sampled) {
        const query = [task.title, task.description].filter(Boolean).join(' ');
        const facts = await graphitiBridge.searchMemory({ query, group_id: groupId, max_results: 1 });
        const hasFacts = Array.isArray(facts) ? facts.length > 0 : !!(facts?.facts?.length);
        if (hasFacts) coveredCount++;
      }
      completeness = sampled.length > 0 ? coveredCount / sampled.length : 0.5;
    } catch {
      completeness = 0.5;
    }
  }

  // Weighted average
  const score = (coverage * 0.25 + specificity * 0.25 + ordering * 0.25 + completeness * 0.25);
  const rounded = Math.round(score * 100) / 100;

  // Build rationale
  const parts = [];
  if (coverage < 0.5) parts.push(`Low goal coverage (${Math.round(coverage * 100)}%)`);
  if (specificity < 0.5) parts.push(`${tasks.length - specificTasks.length} tasks lack detailed descriptions`);
  if (ordering < 0.3) parts.push('Few explicit dependencies between tasks');
  if (completeness < 0.3) parts.push('Knowledge gaps remain for many tasks');
  if (parts.length === 0) parts.push('Plan quality is good across all dimensions');

  const rationale = parts.join('. ') + '.';

  // Persist to plan
  try {
    await dal.plansDal.update(planId, {
      qualityScore: rounded,
      qualityAssessedAt: new Date(),
      qualityRationale: rationale,
    });
  } catch {
    // Non-critical — evaluation result is still returned
  }

  return {
    score: rounded,
    coverage: Math.round(coverage * 100) / 100,
    specificity: Math.round(specificity * 100) / 100,
    ordering: Math.round(ordering * 100) / 100,
    completeness: Math.round(completeness * 100) / 100,
    rationale,
  };
}

module.exports = { evaluatePlanQuality };
