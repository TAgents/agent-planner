/**
 * Goal state services — quality assessment, knowledge-gap detection, and
 * progress calculation, plus the composed `goal_state` read used by
 * GET /v1/goals/:id/state.
 *
 * Extracted from the inline handlers in routes/v2/goals.routes.js so the
 * v1 facade can reuse them without HTTP round-trips. The composition
 * mirrors the MCP `goal_state` tool (agent-planner-mcp tools/bdi/beliefs.js),
 * which previously fanned out to four REST endpoints client-side.
 */

const dal = require('../../../db/dal.cjs');
const graphitiBridge = require('../../../services/graphitiBridge');
const goalRollupService = require('../../../services/goalRollup.service');
const logger = require('../../../utils/logger');
const { normalizeCriteria, isMeasurableCriterion, criteriaAttainment } = require('../../../utils/goalCriteria');
const { checkPlanAccess } = require('../../../middleware/planAccess.middleware');

// Bound the number of incomplete tasks we probe Graphiti for per call. This
// caps the slice size (and hence the Promise.all fan-out), not in-flight
// concurrency — the sidecar tolerates this many parallel searches.
const MAX_TASKS_TO_QUERY = 10;
const asOf = () => new Date().toISOString();

/**
 * Assess goal quality across 5 dimensions (clarity, measurability,
 * actionability, knowledge grounding, commitment). Persists the result to
 * goal_evaluations for trending (best-effort).
 */
async function assessGoalQuality(goal, user) {
  const dimensions = {};
  const suggestions = [];

  // 1. Clarity — has title + description
  const hasDesc = goal.description && goal.description.length > 10;
  dimensions.clarity = {
    score: hasDesc ? 1.0 : 0.5,
    detail: hasDesc ? 'Has title and description' : 'Missing or very short description',
  };
  if (!hasDesc) suggestions.push('Add a detailed description explaining what this goal achieves and why it matters');

  // 2. Measurability — reward criteria that actually carry a metric+target,
  // not the raw bullet count: 6 vague statements must not outscore 2 sharp
  // metrics. Normalize first (the legacy { criteria: [...] } wrapped shape would
  // otherwise count as a single criterion via Object.keys()). Half the score is
  // coverage (enough criteria), half is the share that is measurable.
  const criteriaList = normalizeCriteria(goal.successCriteria);
  const criteriaCount = criteriaList.length;
  const measurableCount = criteriaList.filter(isMeasurableCriterion).length;
  if (criteriaCount === 0) {
    dimensions.measurability = { score: 0, detail: 'No success criteria — goal is not measurable' };
    suggestions.push('Define success criteria with specific metrics and targets (e.g., "API latency < 100ms p99")');
  } else {
    const coverage = Math.min(criteriaCount / 2, 1.0);
    const measurableShare = measurableCount / criteriaCount;
    dimensions.measurability = {
      score: Math.round((0.5 * coverage + 0.5 * measurableShare) * 100) / 100,
      detail: `${measurableCount}/${criteriaCount} criteria carry a metric + target`,
    };
    if (measurableShare < 1) {
      suggestions.push("Make criteria measurable — add metric + target + direction (e.g. {metric: 'p99 latency', target: 100, unit: 'ms', direction: 'decrease'})");
    }
  }

  // 3. Actionability — has linked plans. Count DISTINCT, NON-ARCHIVED linked
  // plans, the same definition as briefing/goal_state, so the numbers agree.
  const planIds = [...new Set((goal.links || []).filter(l => l.linkedType === 'plan').map(l => l.linkedId))];
  const planRows = planIds.length ? await dal.plansDal.findByIds(planIds) : [];
  const activePlanCount = planRows.filter(p => p.status !== 'archived').length;
  dimensions.actionability = {
    score: activePlanCount > 0 ? Math.min(activePlanCount / 2, 1.0) : 0,
    detail: activePlanCount > 0 ? `${activePlanCount} plan${activePlanCount > 1 ? 's' : ''} linked` : 'No plans linked — goal has no execution path',
  };
  if (activePlanCount === 0) suggestions.push('Link at least one plan that works toward this goal');

  // 4. Knowledge grounding — knowledge exists for success criteria
  let knowledgeScore = 0.5; // Neutral default
  let knowledgeDetail = 'Knowledge graph not available';
  if (graphitiBridge.isAvailable()) {
    try {
      const groupId = graphitiBridge.getGroupId(user);
      const query = [goal.title, goal.description || ''].join(' ');
      const result = await graphitiBridge.searchMemory({ query, group_id: groupId, max_results: 5 });
      const facts = Array.isArray(result) ? result : (result?.facts || []);
      knowledgeScore = facts.length >= 3 ? 1.0 : facts.length > 0 ? 0.6 : 0;
      knowledgeDetail = facts.length > 0 ? `${facts.length} related facts in knowledge graph` : 'No related knowledge found';
      if (facts.length === 0) suggestions.push('Add knowledge episodes related to this goal domain using add_learning');
    } catch {
      knowledgeScore = 0.5;
      knowledgeDetail = 'Could not query knowledge graph';
    }
  }
  dimensions.knowledge_grounding = { score: knowledgeScore, detail: knowledgeDetail };

  // 5. Commitment — is the goal committed, with a deadline-like signal?
  // (goal_type column dropped in migration 0022; commitment = promoted_at.)
  const isCommitted = Boolean(goal.committed);
  const hasDeadline = goal.title.match(/by\s+(Q[1-4]|20\d{2}|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)/i);
  const commitScore = isCommitted ? (hasDeadline ? 1.0 : 0.7) : (hasDeadline ? 0.5 : 0.2);
  dimensions.commitment = {
    score: commitScore,
    detail: isCommitted
      ? (hasDeadline ? 'Committed with time reference' : 'Committed but no deadline')
      : 'Not committed yet — promote when ready',
  };
  if (!isCommitted) suggestions.push('Promote the goal when success criteria and plans are in place');
  if (!hasDeadline && isCommitted) suggestions.push('Add a time-bound target to the goal title or description');

  // Overall score
  const scores = Object.values(dimensions).map(d => d.score);
  const overall = scores.reduce((a, b) => a + b, 0) / scores.length;
  const overallRounded = Math.round(overall * 100) / 100;
  const assessedAt = asOf();

  // Persist to goal_evaluations for trending. Best-effort — failure here
  // must not break the read endpoint.
  try {
    await dal.goalsDal.addEvaluation(goal.id, {
      evaluatedBy: 'goal_quality_endpoint',
      score: Math.round(overall * 100),  // 0-100 integer for column type
      reasoning: `Overall ${overallRounded}: clarity ${dimensions.clarity.score}, measurability ${dimensions.measurability.score}, actionability ${dimensions.actionability.score}, knowledge ${dimensions.knowledge_grounding.score}, commitment ${dimensions.commitment.score}`,
      suggestedActions: suggestions,
      dimensions,
    });
  } catch (persistErr) {
    await logger.error('Goal quality persist failed:', persistErr);
  }

  return {
    goal_id: goal.id,
    score: overallRounded,
    dimensions,
    suggestions,
    as_of: assessedAt,
  };
}

/**
 * Detect knowledge gaps on the goal's achievement path: incomplete tasks
 * with no related facts in the knowledge graph. Degrades gracefully when
 * Graphiti is unavailable.
 */
async function detectKnowledgeGaps(goal, user, pathPromise = null) {
  if (!graphitiBridge.isAvailable()) {
    return {
      available: false,
      committed: Boolean(goal.committed),
      message: 'Knowledge graph not available',
      tasks: [],
      gaps: [],
      coverage: { total: 0, covered: 0, percentage: 0 },
    };
  }

  // Get all tasks on the goal path (shared promise when called from
  // getGoalState so the path is only fetched once per request)
  const { nodes } = await (pathPromise || dal.dependenciesDal.getGoalPath(goal.id));
  if (nodes.length === 0) {
    return {
      available: true,
      committed: Boolean(goal.committed),
      tasks: [],
      gaps: [],
      coverage: { total: 0, covered: 0, percentage: 100 },
    };
  }

  // Probe Graphiti for the first N incomplete tasks (bounded fan-out).
  const groupId = graphitiBridge.getGroupId(user);
  const incompleteTasks = nodes.filter(n => n.status !== 'completed').slice(0, MAX_TASKS_TO_QUERY);

  const queryTaskKnowledge = async (task) => {
    const query = [task.title, task.description].filter(Boolean).join(' ');
    try {
      const result = await graphitiBridge.searchMemory({ query, group_id: groupId, max_results: 3 });
      const facts = Array.isArray(result) ? result : (result?.facts || []);
      const factList = facts.map(f => f.fact || f.content || String(f));
      return {
        node_id: task.node_id, title: task.title, status: task.status, depth: task.depth,
        fact_count: factList.length, has_knowledge: factList.length > 0,
        top_facts: factList.slice(0, 2),
      };
    } catch {
      return {
        node_id: task.node_id, title: task.title, status: task.status, depth: task.depth,
        fact_count: 0, has_knowledge: false, top_facts: [],
      };
    }
  };

  const rawResults = await Promise.all(incompleteTasks.map(queryTaskKnowledge));

  // Committed goals treat knowledge gaps as blocking; aspirational ones as informational.
  const gapSeverity = goal.committed ? 'blocking' : 'informational';
  const results = rawResults.map(r => ({ ...r, gap_severity: r.has_knowledge ? null : gapSeverity }));
  const gaps = results.filter(r => !r.has_knowledge);
  const covered = results.filter(r => r.has_knowledge).length;

  // Check goal-level knowledge (success criteria) — batch with tasks. Normalize
  // so the legacy { criteria: [...] } wrapped shape is iterated, not skipped.
  let goalKnowledge;
  const criteriaForKnowledge = normalizeCriteria(goal.successCriteria);
  if (criteriaForKnowledge.length > 0) {
    goalKnowledge = await Promise.all(
      criteriaForKnowledge.slice(0, 5).map(async (criterion) => {
        const query = typeof criterion === 'string' ? criterion : (criterion.metric || criterion.name || JSON.stringify(criterion));
        try {
          const result = await graphitiBridge.searchMemory({ query, group_id: groupId, max_results: 2 });
          const facts = Array.isArray(result) ? result : (result?.facts || []);
          return { criterion: query, has_knowledge: facts.length > 0, fact_count: facts.length };
        } catch {
          return { criterion: query, has_knowledge: false, fact_count: 0 };
        }
      })
    );
  }

  return {
    available: true,
    committed: Boolean(goal.committed),
    tasks: results,
    gaps,
    coverage: {
      total: results.length,
      covered,
      percentage: results.length > 0 ? Math.round((covered / results.length) * 100) : 100,
    },
    success_criteria_coverage: goalKnowledge?.length > 0 ? goalKnowledge : undefined,
  };
}

/**
 * Calculate goal progress from the dependency graph (achieves edges).
 */
async function getGoalProgress(goalId, pathPromise = null, linkedPlanIds = null) {
  const { nodes, stats } = await (pathPromise || dal.dependenciesDal.getGoalPath(goalId));
  const directAchievers = nodes.filter(n => n.depth === 1);
  const directCompleted = directAchievers.filter(n => n.status === 'completed').length;
  const directProgress = directAchievers.length > 0
    ? Math.round((directCompleted / directAchievers.length) * 100)
    : 0;

  // A goal can link a PLAN without wiring achiever edges to its individual
  // tasks. The achiever path is then empty and stats.completion_percentage is
  // 0 — misleading when the linked plan is well underway (goal_state showed 0%
  // while the dashboard/briefing showed 88% for the same goal). Fall back to
  // the linked plans' task completion so the two agree.
  if ((!nodes || nodes.length === 0) && Array.isArray(linkedPlanIds) && linkedPlanIds.length) {
    const planStats = await dal.nodesDal.taskStatsForPlans(linkedPlanIds);
    const pct = planStats.total > 0
      ? Math.round((planStats.completed / planStats.total) * 100)
      : 0;
    return {
      goal_id: goalId,
      progress: pct,
      direct_progress: pct,
      stats: {
        total: planStats.total,
        completed: planStats.completed,
        completion_percentage: pct,
        source: 'linked_plans',
      },
    };
  }

  return {
    goal_id: goalId,
    progress: stats.completion_percentage,
    direct_progress: directProgress,
    stats,
  };
}

/**
 * Composed single-goal read: details, quality, progress, bottlenecks,
 * knowledge gaps, linked plans/tasks. Partial failures are surfaced in
 * meta.failures rather than failing the whole read.
 *
 * Caller is responsible for the access check (goal must already be loaded
 * and authorized for `user`).
 */
async function getGoalState(goal, user) {
  const links = Array.isArray(goal.links) ? goal.links : [];
  const failures = [];

  // Live (non-archived, still-existing) linked plans, deduped by plan id.
  const dedupedPlanLinks = [...new Map(
    links.filter(l => l.linkedType === 'plan').map(l => [l.linkedId, { id: l.linkedId, link_id: l.id }]),
  ).values()];
  const planRows = await dal.plansDal.findByIds(dedupedPlanLinks.map(p => p.id));
  const liveStatus = new Map(planRows.map(p => [p.id, p.status]));
  const livePlans = dedupedPlanLinks.filter(p => {
    const st = liveStatus.get(p.id);
    return st !== undefined && st !== 'archived';
  });

  // Resolve the achiever path up front so plan-access filtering applies BEFORE
  // progress/knowledge are derived from it.
  let path = { nodes: [] };
  try {
    path = await dal.dependenciesDal.getGoalPath(goal.id);
  } catch (e) {
    failures.push({ source: 'path', message: e?.message });
  }
  const allPathNodes = Array.isArray(path.nodes) ? path.nodes : [];

  // ── Access boundary ──
  // Org membership authorizes the GOAL, but each linked plan carries its own
  // visibility. Don't leak a private plan's tasks/progress/bottlenecks to a
  // viewer who can't open the plan. Filter linked plans AND achiever-path nodes
  // by the viewer's plan access; report how many linked plans are hidden.
  const candidatePlanIds = [...new Set([
    ...livePlans.map(p => p.id),
    ...allPathNodes.map(n => n.plan_id).filter(Boolean),
  ])];
  const accessChecks = await Promise.all(
    candidatePlanIds.map(async (id) => [id, await checkPlanAccess(id, user.id)]),
  );
  const accessible = new Set(accessChecks.filter(([, ok]) => ok).map(([id]) => id));

  const linkedPlans = livePlans.filter(p => accessible.has(p.id));
  const hiddenLinkedPlanCount = livePlans.length - linkedPlans.length;
  const visiblePlanIds = linkedPlans.map(p => p.id);

  // Path nodes the viewer may actually see (a node without a plan_id is kept).
  const pathNodes = allPathNodes.filter(n => !n.plan_id || accessible.has(n.plan_id));
  const completedNodes = pathNodes.filter(n => n.status === 'completed').length;
  const filteredPath = {
    nodes: pathNodes,
    stats: {
      total: pathNodes.length,
      completed: completedNodes,
      blocked: pathNodes.filter(n => n.status === 'blocked').length,
      in_progress: pathNodes.filter(n => n.status === 'in_progress').length,
      not_started: pathNodes.filter(n => !['completed', 'blocked', 'in_progress'].includes(n.status)).length,
      completion_percentage: pathNodes.length ? Math.round((completedNodes / pathNodes.length) * 100) : 0,
    },
  };
  const filteredPathPromise = Promise.resolve(filteredPath);

  const settled = await Promise.allSettled([
    assessGoalQuality(goal, user),
    getGoalProgress(goal.id, filteredPathPromise, visiblePlanIds),
    detectKnowledgeGaps(goal, user, filteredPathPromise),
  ]);

  const unwrap = (s, label, def) => {
    if (s.status === 'fulfilled') return s.value;
    failures.push({ source: label, message: s.reason?.message });
    return def;
  };

  const quality = unwrap(settled[0], 'quality', {});
  const progress = unwrap(settled[1], 'progress', {});
  const gaps = unwrap(settled[2], 'knowledge_gaps', { gaps: [] });

  // Canonical rollup — the SAME computation Mission and the dashboard use, so
  // the detail header's health AND execution numbers match the list. Bounded to
  // this one goal. null when the goal isn't an active rollup row.
  let canonicalRollup = null;
  try {
    const rollup = await goalRollupService.computeGoalRollup({
      userId: user.id,
      organizationIds: (user.organizations || []).map(o => o.id),
      goalId: goal.id,
    });
    if (rollup) {
      canonicalRollup = {
        health: rollup.health,
        execution_pct: rollup.execution_pct,
        total_nodes: rollup.total_nodes,
        completed_nodes: rollup.completed_nodes,
        in_progress_nodes: rollup.in_progress_nodes,
        blocked_nodes: rollup.blocked_nodes,
        percent_blocked: rollup.percent_blocked,
        linked_plan_count: rollup.linked_plan_count,
        attainment_pct: rollup.attainment_pct,
        pending_decision_count: rollup.pending_decision_count,
      };
    }
  } catch (err) {
    failures.push({ source: 'rollup', message: err?.message });
  }
  const healthFromRollup = canonicalRollup?.health || null;

  // Attainment (success criteria actually met) is DISTINCT from execution
  // (tasks completed) — a goal can be 100% task-done yet 0% attained. Surface
  // both; never conflate. attainment_pct is null when no criterion is measurable.
  const attainment = criteriaAttainment(goal.successCriteria);
  progress.execution_pct = progress.progress;
  progress.attainment_pct = attainment.attainment_pct;
  progress.attainment = { measurable_count: attainment.measurable_count, met_count: attainment.met_count };

  const bottlenecks = pathNodes
    .filter(t => t.status !== 'completed')
    .sort((a, b) => (b.direct_downstream_count || 0) - (a.direct_downstream_count || 0))
    .slice(0, 5)
    .map(t => ({
      node_id: t.node_id || t.id,
      title: t.title,
      status: t.status,
      direct_downstream_count: t.direct_downstream_count || 0,
    }));

  // Explicit task links (linkedType==='task') are rarely used; the tasks that
  // actually contribute to the goal are its (access-filtered) achiever path.
  const linkedTasks = pathNodes.length
    ? pathNodes.map(t => ({ id: t.node_id || t.id, title: t.title, status: t.status }))
    : links.filter(l => l.linkedType === 'task').map(l => ({ id: l.linkedId, link_id: l.id }));

  return {
    as_of: asOf(),
    goal: {
      id: goal.id,
      title: goal.title,
      description: goal.description,
      type: goal.type,
      committed: Boolean(goal.committed),
      status: goal.status,
      priority: goal.priority,
      owner_id: goal.ownerId,
      success_criteria: goal.successCriteria,
      promoted_at: goal.promotedAt,
    },
    linked_plans: linkedPlans,
    hidden_linked_plan_count: hiddenLinkedPlanCount,
    linked_tasks: linkedTasks,
    quality: {
      score: quality.score,
      dimensions: quality.dimensions,
      suggestions: quality.suggestions,
      last_assessed_at: quality.as_of,
    },
    progress,
    bottlenecks,
    // Canonical health + execution numbers from the shared rollup (same source
    // as Mission/dashboard) so the detail header can't disagree with the list.
    // null for goals not in the active-goal rollup set (e.g. achieved/paused) —
    // the UI shows lifecycle status / achiever-path progress there instead.
    health: healthFromRollup,
    rollup: canonicalRollup,
    knowledge_gaps: Array.isArray(gaps.gaps) ? gaps.gaps : [],
    meta: { partial: failures.length > 0, failures },
  };
}

module.exports = {
  assessGoalQuality,
  detectKnowledgeGaps,
  getGoalProgress,
  getGoalState,
};
