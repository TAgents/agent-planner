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
const logger = require('../../../utils/logger');

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

  // 2. Measurability — has success criteria
  const criteria = goal.successCriteria;
  const hasCriteria = criteria && (
    (Array.isArray(criteria) && criteria.length > 0) ||
    (typeof criteria === 'object' && Object.keys(criteria).length > 0)
  );
  const criteriaCount = Array.isArray(criteria) ? criteria.length : (typeof criteria === 'object' && criteria ? Object.keys(criteria).length : 0);
  dimensions.measurability = {
    score: hasCriteria ? Math.min(criteriaCount / 2, 1.0) : 0,
    detail: hasCriteria ? `${criteriaCount} success criteria defined` : 'No success criteria — goal is not measurable',
  };
  if (!hasCriteria) suggestions.push('Define success criteria with specific metrics and targets (e.g., "API latency < 100ms p99")');

  // 3. Actionability — has linked plans
  const planLinks = (goal.links || []).filter(l => l.linkedType === 'plan');
  dimensions.actionability = {
    score: planLinks.length > 0 ? Math.min(planLinks.length / 2, 1.0) : 0,
    detail: planLinks.length > 0 ? `${planLinks.length} plan${planLinks.length > 1 ? 's' : ''} linked` : 'No plans linked — goal has no execution path',
  };
  if (planLinks.length === 0) suggestions.push('Link at least one plan that works toward this goal');

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

  // Check goal-level knowledge (success criteria) — batch with tasks
  let goalKnowledge;
  if (goal.successCriteria && Array.isArray(goal.successCriteria)) {
    goalKnowledge = await Promise.all(
      goal.successCriteria.slice(0, 5).map(async (criterion) => {
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
async function getGoalProgress(goalId, pathPromise = null) {
  const { nodes, stats } = await (pathPromise || dal.dependenciesDal.getGoalPath(goalId));
  const directAchievers = nodes.filter(n => n.depth === 1);
  const directCompleted = directAchievers.filter(n => n.status === 'completed').length;
  const directProgress = directAchievers.length > 0
    ? Math.round((directCompleted / directAchievers.length) * 100)
    : 0;

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
  // One goal-path query shared across progress, knowledge gaps, and
  // bottlenecks (each fetches its own when called standalone).
  const pathPromise = dal.dependenciesDal.getGoalPath(goal.id);
  const settled = await Promise.allSettled([
    assessGoalQuality(goal, user),
    getGoalProgress(goal.id, pathPromise),
    detectKnowledgeGaps(goal, user, pathPromise),
    pathPromise,
  ]);

  const failures = [];
  const unwrap = (s, label, def) => {
    if (s.status === 'fulfilled') return s.value;
    failures.push({ source: label, message: s.reason?.message });
    return def;
  };

  const quality = unwrap(settled[0], 'quality', {});
  const progress = unwrap(settled[1], 'progress', {});
  const gaps = unwrap(settled[2], 'knowledge_gaps', { gaps: [] });
  const path = unwrap(settled[3], 'path', { nodes: [] });

  const bottlenecks = (Array.isArray(path.nodes) ? path.nodes : [])
    .filter(t => t.status !== 'completed')
    .sort((a, b) => (b.direct_downstream_count || 0) - (a.direct_downstream_count || 0))
    .slice(0, 5)
    .map(t => ({
      node_id: t.node_id || t.id,
      title: t.title,
      status: t.status,
      direct_downstream_count: t.direct_downstream_count || 0,
    }));

  const links = Array.isArray(goal.links) ? goal.links : [];
  // Canonical "linked plans" = distinct NON-ARCHIVED (and still-existing) plans
  // linked to the goal — same definition as the dashboard/briefing count. Dedupe
  // by plan id, then drop archived/deleted stubs.
  const dedupedPlanLinks = [...new Map(
    links.filter(l => l.linkedType === 'plan').map(l => [l.linkedId, { id: l.linkedId, link_id: l.id }]),
  ).values()];
  const planRows = await dal.plansDal.findByIds(dedupedPlanLinks.map(p => p.id));
  const liveStatus = new Map(planRows.map(p => [p.id, p.status]));
  const linkedPlans = dedupedPlanLinks.filter(p => {
    const st = liveStatus.get(p.id);
    return st !== undefined && st !== 'archived';
  });
  // Explicit task links (linkedType==='task') are rarely used; the tasks that
  // actually contribute to the goal are its achiever path. Surface those so
  // linked_tasks isn't misleadingly empty. Fall back to explicit links.
  const pathNodes = Array.isArray(path.nodes) ? path.nodes : [];
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
    linked_tasks: linkedTasks,
    quality: {
      score: quality.score,
      dimensions: quality.dimensions,
      suggestions: quality.suggestions,
      last_assessed_at: quality.as_of,
    },
    progress,
    bottlenecks,
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
