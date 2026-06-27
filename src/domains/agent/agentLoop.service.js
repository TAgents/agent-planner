const crypto = require('crypto');
const dal = require('../../db/dal.cjs');
const { assembleContext, suggestNextTasks, buildDocumentOrder } = require('../../services/contextEngine');
const reasoning = require('../../services/reasoning');
const graphitiBridge = require('../../services/graphitiBridge');
const { coherenceFields } = require('../../services/coherenceVocab');
const { evaluatePlanQuality } = require('../../services/planQualityEvaluator');
const { classifyGoalHealth } = require('../../utils/goalHealth');
const { criteriaAttainment } = require('../../utils/goalCriteria');
const { cascadePlanAchievers } = require('../goal/services/goalLinks.service');
const logger = require('../../utils/logger');

// A plan with this many actionable tasks and zero dependency edges is flagged
// as weakly structured — agents can produce a valid-looking tree with no
// executable ordering, which lets executors skip around. Soft signal only.
const MIN_TASKS_FOR_DEP_WARNING = 2;

class AgentLoopError extends Error {
  constructor(message, statusCode = 500, code = 'internal', details = undefined) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

const asOf = () => new Date().toISOString();

const snakeNode = (node) => node && ({
  id: node.id,
  plan_id: node.planId,
  parent_id: node.parentId,
  node_type: node.nodeType,
  title: node.title,
  description: node.description,
  status: node.status,
  order_index: node.orderIndex,
  task_mode: node.taskMode,
  agent_instructions: node.agentInstructions,
  ...coherenceFields(node.coherenceStatus),
  quality_score: node.qualityScore,
  updated_at: node.updatedAt,
  created_at: node.createdAt,
});

const snakeClaim = (claim) => claim && ({
  id: claim.id,
  node_id: claim.nodeId,
  plan_id: claim.planId,
  agent_id: claim.agentId,
  claimed_at: claim.claimedAt,
  expires_at: claim.expiresAt,
  released_at: claim.releasedAt,
  created_by: claim.createdBy,
  // Read-only; the column is not client-settable, so the rename is response-side only.
  context_snapshot: claim.beliefSnapshot,
});

async function accessiblePlanIds(userId, organizationId) {
  const { owned = [], shared = [], organization = [] } =
    await dal.plansDal.listForUser(userId, { organizationId });
  return [...new Map([...owned, ...shared, ...organization].map(p => [p.id, p])).values()];
}

async function goalDashboard(user) {
  const rows = await dal.goalsDal.getDashboardData({
    organizationIds: (user.organizations || []).map(o => o.id),
    userId: user.id,
  });

  const goals = await Promise.all((rows || []).map(async (row) => {
    const totalNodes = Number(row.total_nodes || 0);
    const completedNodes = Number(row.completed_nodes || 0);
    const blockedNodes = Number(row.blocked_nodes || 0);
    const stalePending = Number(row.stale_plan_ready_nodes || 0) + Number(row.stale_agent_request_nodes || 0);
    const planIds = Array.isArray(row.plan_ids) ? row.plan_ids.filter(Boolean) : [];

    let bottleneckSummary = [];
    for (const planId of planIds.slice(0, 5)) {
      try {
        const items = await reasoning.detectBottlenecks(planId, { limit: 3, incomplete_only: true });
        bottleneckSummary.push(...(Array.isArray(items) ? items : []));
      } catch {
        // Briefing is best-effort; one unavailable analysis should not hide all state.
      }
    }
    bottleneckSummary = bottleneckSummary
      .sort((a, b) => (b.direct_downstream_count || 0) - (a.direct_downstream_count || 0))
      .slice(0, 3);

    const lastActivity = row.last_log_at || null;
    const lastActivityTs = lastActivity ? new Date(lastActivity).getTime() : null;
    const percentBlocked = totalNodes ? Math.round((blockedNodes / totalNodes) * 100) : 0;
    const percentCompleted = totalNodes ? Math.round((completedNodes / totalNodes) * 100) : 0;
    const { attainment_pct } = criteriaAttainment(row.success_criteria);
    // Shared classifier so briefing + dashboard can never diverge (see utils/goalHealth).
    const health = classifyGoalHealth({
      hasLinkedPlans: planIds.length > 0,
      totalNodes,
      lastActivityTs,
      bottleneckCount: bottleneckSummary.length,
      percentBlocked,
      stalePendingCount: stalePending,
      attainmentPct: attainment_pct,
      executionPct: percentCompleted,
    });

    return {
      id: row.id,
      title: row.title,
      description: row.description,
      type: row.type,
      committed: Boolean(row.committed),
      status: row.status,
      health,
      priority: row.priority,
      owner_name: row.owner_name || null,
      bottleneck_summary: bottleneckSummary,
      last_activity: lastActivity,
      linked_plan_progress: {
        total_nodes: totalNodes,
        completed_nodes: completedNodes,
        blocked_nodes: blockedNodes,
        percent_completed: totalNodes ? Math.round((completedNodes / totalNodes) * 100) : 0,
        percent_blocked: percentBlocked,
        linked_plan_count: Number(row.linked_plan_count || planIds.length || 0),
      },
      pending_decision_count: Number(row.plan_ready_nodes || 0) + Number(row.agent_request_nodes || 0),
      plan_ids: planIds,
    };
  }));

  const summary = goals.reduce((acc, goal) => {
    acc[goal.health] = (acc[goal.health] || 0) + 1;
    acc.total += 1;
    return acc;
  }, { on_track: 0, at_risk: 0, stale: 0, total: 0 });

  return { summary, goals };
}

async function pendingItemsForPlans(planIds, limit = 10) {
  const decisions = [];
  const activeClaims = [];

  for (const planId of planIds) {
    try {
      const rows = await dal.decisionsDal.listByPlan(planId, { status: 'pending' });
      decisions.push(...rows.map(d => ({
        id: d.id,
        title: d.title,
        urgency: d.urgency,
        plan_id: d.planId,
        node_id: d.nodeId,
        created_at: d.createdAt,
        status: d.status,
      })));
    } catch {}

    try {
      const rows = await dal.claimsDal.listActiveClaimsByPlan(planId);
      activeClaims.push(...rows.map(snakeClaim));
    } catch {}
  }

  return {
    pending_decisions: decisions.slice(0, limit),
    active_claims: activeClaims.slice(0, limit),
  };
}

async function getBriefing(user, { goal_id, plan_id, recent_window_hours = 24, scope } = {}) {
  const plans = await accessiblePlanIds(user.id, user.organizationId || null);
  let scopedPlanIds = plans.map(p => p.id);
  if (plan_id) scopedPlanIds = scopedPlanIds.filter(id => id === plan_id);

  const goalHealth = await goalDashboard(user);
  let goals = goalHealth.goals;
  if (goal_id) goals = goals.filter(g => g.id === goal_id);
  if (plan_id) goals = goals.filter(g => (g.plan_ids || []).includes(plan_id));
  const filteredSummary = goals.reduce((acc, goal) => {
    acc[goal.health] = (acc[goal.health] || 0) + 1;
    acc.total += 1;
    return acc;
  }, { on_track: 0, at_risk: 0, stale: 0, total: 0 });

  const pending = await pendingItemsForPlans(scopedPlanIds, 10);
  const recentCutoff = Date.now() - Number(recent_window_hours || 24) * 60 * 60 * 1000;
  // One cross-plan query, newest first — replaces a per-plan loop that both
  // capped at 10 plans AND called a non-existent logsDal.listByPlan (so the
  // feed was silently always empty).
  let recentActivity = [];
  try {
    const rows = await dal.logsDal.listRecentForPlans(scopedPlanIds, { sinceMs: recentCutoff, limit: 20 });
    recentActivity = rows.map(l => ({
      type: 'log',
      ref_id: l.id,
      plan_id: l.planId,
      node_id: l.planNodeId,
      summary: l.content,
      occurred_at: l.createdAt,
    }));
  } catch {}

  let topRecommendation = null;
  const atRisk = goals.filter(g => g.health === 'at_risk' || g.health === 'stale');
  for (const goal of atRisk) {
    const bottleneck = (goal.bottleneck_summary || [])[0];
    if (bottleneck) {
      topRecommendation = {
        goal_id: goal.id,
        plan_id: bottleneck.plan_id,
        node_id: bottleneck.node_id || bottleneck.id,
        suggested_action: `Unblock "${bottleneck.title}"`,
        reasoning: `Goal "${goal.title}" is ${goal.health}; this task has the highest bottleneck signal.`,
      };
      break;
    }
  }

  const effectiveScope = plan_id ? 'plan' : (goal_id ? 'goal' : 'mission_control');
  return {
    as_of: asOf(),
    // Echo the caller's requested scope (the MCP uses a different vocabulary,
    // e.g. 'task_session'/'org') plus the effective data scope derived from the
    // ids, so the response no longer silently contradicts the request.
    scope: scope || effectiveScope,
    effective_scope: effectiveScope,
    goal_health: { summary: filteredSummary, goals },
    pending_decisions: pending.pending_decisions,
    active_claims: pending.active_claims,
    recent_activity: recentActivity
      .sort((a, b) => new Date(b.occurred_at) - new Date(a.occurred_at))
      .slice(0, 20),
    top_recommendation: topRecommendation,
    meta: { plan_count: scopedPlanIds.length },
  };
}

async function resolvePlanIdsForScope(user, { plan_id, goal_id }) {
  if (plan_id) return [plan_id];
  if (!goal_id) throw new AgentLoopError('plan_id or goal_id is required', 400, 'invalid_scope');
  const plans = await accessiblePlanIds(user.id, user.organizationId || null);
  const tethers = await dal.goalsDal.listGoalTethersForPlanIds(plans.map(p => p.id));
  const planIds = tethers.filter(t => t.goal_id === goal_id).map(t => t.plan_id);
  if (planIds.length === 0) throw new AgentLoopError('No linked plans found for goal scope', 404, 'not_found');
  return planIds;
}

async function chooseTask(user, { plan_id, goal_id, fresh = false }) {
  const planIds = await resolvePlanIdsForScope(user, { plan_id, goal_id });

  if (!fresh) {
    // Resume the EARLIEST in-progress task in plan (document) order, not the
    // most recently touched one. listByPlanIds orders by updated_at DESC, so
    // "limit 1" used to resume near the latest activity and silently skip
    // earlier started-but-incomplete work. Walk plans in scope order; the
    // first plan with in-progress work wins, and within it the task earliest
    // in document order.
    for (const planId of planIds) {
      const inProgress = await dal.nodesDal.listByPlanIds([planId], {
        nodeType: 'task',
        status: 'in_progress',
        limit: 200,
      });
      if (inProgress.length === 0) continue;
      const order = buildDocumentOrder(await dal.nodesDal.listByPlan(planId));
      inProgress.sort((a, b) =>
        (order.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (order.get(b.id) ?? Number.MAX_SAFE_INTEGER));
      return { node: inProgress[0], source: 'resume_in_progress' };
    }
  }

  for (const planId of planIds) {
    const suggestions = await suggestNextTasks(planId, { limit: 1, orgId: user.organizationId });
    if (suggestions && suggestions[0]) {
      const node = suggestions[0].id ? suggestions[0] : suggestions[0].node;
      return { node, source: 'suggest_next_tasks' };
    }
  }

  // Fail closed: not_started tasks may exist but be dep-blocked. Distinguish
  // "no work in scope" from "all remaining work is blocked on incomplete deps"
  // so callers can act on it instead of being handed a dep-blind task.
  const notStartedExists = await dal.nodesDal.listByPlanIds(planIds, {
    nodeType: 'task',
    status: 'not_started',
    limit: 1,
  });
  if (notStartedExists[0]) {
    throw new AgentLoopError(
      'All remaining tasks are blocked on incomplete dependencies',
      404,
      'not_found',
      { reason: 'blocked_on_dep' },
    );
  }
  throw new AgentLoopError('No actionable task found in scope', 404, 'not_found', { reason: 'no_work_in_scope' });
}

async function startWorkSession(user, {
  plan_id,
  goal_id,
  task_id,
  ttl_minutes = 30,
  depth = 3,
  token_budget = 6000,
  dry_run = false,
  fresh = false,
  agent_id,
} = {}) {
  let chosen;
  let source = 'explicit_task';
  if (task_id) {
    const node = await dal.nodesDal.findById(task_id);
    if (!node) throw new AgentLoopError('Task not found', 404, 'not_found');
    chosen = node;
  } else {
    const result = await chooseTask(user, { plan_id, goal_id, fresh });
    chosen = result.node;
    source = result.source;
  }

  const taskPlanId = chosen.planId || chosen.plan_id || plan_id;
  const taskId = chosen.id;
  const access = await dal.plansDal.userHasAccess(taskPlanId, user.id);
  if (!access?.hasAccess) throw new AgentLoopError('Access denied to this plan', 403, 'forbidden');

  if (dry_run) {
    return {
      as_of: asOf(),
      dry_run: true,
      source,
      task: snakeNode(chosen),
      claim: null,
      context: null,
      next_action_hint: 'Call again with dry_run=false to claim and start work.',
    };
  }

  const actorAgentId = agent_id || `user:${user.id}`;
  const claim = await dal.claimsDal.claim(taskId, taskPlanId, actorAgentId, user.id, Number(ttl_minutes) || 30, []);
  if (!claim) {
    const existing = await dal.claimsDal.getActiveClaim(taskId);
    throw new AgentLoopError('Task is already claimed', 409, 'claim_collision', { existing_claim: snakeClaim(existing) });
  }

  const updated = chosen.status === 'in_progress'
    ? chosen
    : await dal.nodesDal.updateStatus(taskId, 'in_progress');

  const context = await assembleContext(taskId, {
    depth: Number(depth) || 3,
    token_budget: Number(token_budget) || 6000,
    log_limit: 10,
    include_research: true,
    orgId: user.organizationId,
  });

  return {
    as_of: asOf(),
    session_id: claim.id,
    source,
    task: snakeNode(updated),
    claim: snakeClaim(claim),
    context,
    next_action_hint: updated.taskMode === 'implement'
      ? 'Implementation task: verify research and plan context before changing code.'
      : 'Work session started. Complete or block this session when finished.',
  };
}

async function loadClaimSession(sessionId) {
  if (!dal.claimsDal.findById) {
    throw new AgentLoopError('claimsDal.findById is required for work sessions', 500, 'internal');
  }
  const claim = await dal.claimsDal.findById(sessionId);
  if (!claim || claim.releasedAt) throw new AgentLoopError('Active work session not found', 404, 'not_found');
  return claim;
}

async function finishWorkSession(user, sessionId, {
  status,
  summary,
  learning,
  decision,
  agent_id,
} = {}) {
  const claim = await loadClaimSession(sessionId);
  const node = await dal.nodesDal.findById(claim.nodeId);
  if (!node) throw new AgentLoopError('Task not found', 404, 'not_found');
  const access = await dal.plansDal.userHasAccess(claim.planId, user.id);
  if (!access?.hasAccess) throw new AgentLoopError('Access denied to this plan', 403, 'forbidden');

  const finalStatus = status || 'completed';
  const updated = await dal.nodesDal.updateStatus(claim.nodeId, finalStatus);
  const log = summary ? await dal.logsDal.create({
    planNodeId: claim.nodeId,
    userId: user.id,
    content: summary,
    logType: finalStatus === 'blocked' ? 'challenge' : 'progress',
    metadata: { source: 'agent_loop', session_id: sessionId },
  }) : null;

  let decisionRecord = null;
  if (decision && finalStatus === 'blocked') {
    decisionRecord = await dal.decisionsDal.create({
      planId: claim.planId,
      nodeId: claim.nodeId,
      requestedByUserId: user.id,
      title: decision.title || `Decision needed: ${node.title}`,
      context: decision.context || summary || '',
      options: decision.options || [],
      urgency: decision.urgency || 'blocking',
      status: 'pending',
      metadata: { source: 'agent_loop', session_id: sessionId },
    });
  }

  let learningRecorded = false;
  if (learning?.content && graphitiBridge.isAvailable()) {
    try {
      await graphitiBridge.addEpisode({
        content: learning.content,
        name: learning.name || learning.content.slice(0, 80),
        source: 'text',
        source_description: learning.source_description || 'Agent loop work-session completion',
        group_id: graphitiBridge.getGroupId(user),
      });
      learningRecorded = true;
    } catch {}
  }

  const released = await dal.claimsDal.release(claim.nodeId, agent_id || claim.agentId);

  return {
    as_of: asOf(),
    session_id: sessionId,
    task: snakeNode(updated),
    log_id: log?.id || null,
    decision_id: decisionRecord?.id || null,
    claim_released: Boolean(released),
    learning_recorded: learningRecorded,
  };
}

async function createIntention(user, { goal_id, title, description, rationale, status = 'draft', visibility = 'private', tree = [], client_version = null }) {
  if (!goal_id) throw new AgentLoopError('goal_id is required', 400, 'invalid_arg');
  if (!title) throw new AgentLoopError('title is required', 400, 'invalid_arg');

  const goal = await dal.goalsDal.findById(goal_id);
  if (!goal) throw new AgentLoopError('Goal not found', 404, 'not_found');
  if (goal.organizationId && goal.organizationId !== user.organizationId) {
    throw new AgentLoopError('Access denied to goal', 403, 'forbidden');
  }
  if (!goal.organizationId && goal.ownerId !== user.id) {
    throw new AgentLoopError('Access denied to goal', 403, 'forbidden');
  }

  // Plans require a workspace (NOT NULL since migration 0021). Inherit the
  // goal's workspace; fall back to the org's default workspace.
  const organizationId = goal.organizationId || user.organizationId || null;
  let workspaceId = goal.workspaceId || null;
  if (!workspaceId && organizationId) {
    const defaultWs = await dal.workspacesDal.findDefault(organizationId);
    workspaceId = defaultWs?.id || null;
  }
  if (!workspaceId) {
    throw new AgentLoopError('No workspace available for this goal', 400, 'invalid_arg');
  }

  const plan = await dal.plansDal.create({
    title,
    description: [rationale, description].filter(Boolean).join('\n\n'),
    ownerId: user.id,
    organizationId,
    workspaceId,
    status,
    visibility,
    // Stamp the creating runtime so a weak plan is debuggable later even if the
    // agent's MCP build is stale (created_by survives; get_started only reports
    // the live build). Falls back to a generic tag for older clients.
    metadata: { source: 'agent_loop', goal_id, created_by: client_version || 'agent-planner-mcp' },
  });
  const root = await dal.nodesDal.create({
    planId: plan.id,
    nodeType: 'root',
    title,
    description: description || '',
    status: 'not_started',
    orderIndex: 0,
  });

  // Maps for resolving inline `depends_on` references after the whole tree is
  // built. A node may carry an explicit `ref` key; otherwise its title is used.
  // Titles can collide, so titleMap holds a list and ambiguous refs are skipped.
  const refMap = new Map();       // ref → nodeId
  const titleMap = new Map();     // title → [nodeId, ...]
  const edgeIntents = [];         // { dependsOn: [ref], targetId } — source blocks target

  async function createChildren(children, parentId) {
    const out = [];
    for (let i = 0; i < children.length; i += 1) {
      const child = children[i];
      const node = await dal.nodesDal.create({
        planId: plan.id,
        parentId,
        nodeType: child.node_type || 'task',
        title: child.title,
        description: child.description || '',
        status: child.status || 'not_started',
        taskMode: child.task_mode || 'free',
        agentInstructions: child.agent_instructions || '',
        orderIndex: i,
        metadata: child.metadata || {},
      });
      if (child.ref) refMap.set(String(child.ref), node.id);
      const titleList = titleMap.get(child.title) || [];
      titleList.push(node.id);
      titleMap.set(child.title, titleList);
      if (Array.isArray(child.depends_on) && child.depends_on.length) {
        edgeIntents.push({ dependsOn: child.depends_on.map(String), targetId: node.id });
      }
      out.push({ ...snakeNode(node), children: await createChildren(child.children || [], node.id) });
    }
    return out;
  }

  const children = await createChildren(Array.isArray(tree) ? tree : [], root.id);
  // Link the plan AND cascade 'achieves' edges to the just-created task nodes.
  // addLink alone only inserts the link row (the achiever cascade lives in the
  // shared goalLinks service); without this the plan had an empty achiever path
  // and goal progress fell back to coarse linked-plan stats.
  const planLink = await dal.goalsDal.addLink(goal_id, 'plan', plan.id);
  try {
    await cascadePlanAchievers({ goalId: goal_id, planId: plan.id, linkId: planLink?.id, userId: user.id });
  } catch (cascadeErr) {
    await logger.error('createIntention achiever cascade error:', cascadeErr);
  }

  // Resolve inline dependency edges. depends_on:[X] on node N means "X blocks N"
  // → edge source=X, target=N, type=blocks. Best-effort: unresolved refs and
  // cycles are reported, never fatal — the plan still exists.
  const resolveRef = (ref) => {
    if (refMap.has(ref)) return refMap.get(ref);
    const byTitle = titleMap.get(ref);
    return byTitle && byTitle.length === 1 ? byTitle[0] : null;
  };
  const edges = [];
  const dependencyWarnings = [];
  for (const intent of edgeIntents) {
    for (const ref of intent.dependsOn) {
      const sourceId = resolveRef(ref);
      if (!sourceId) {
        dependencyWarnings.push(`Unresolved or ambiguous depends_on reference "${ref}"`);
        continue;
      }
      if (sourceId === intent.targetId) {
        dependencyWarnings.push(`Ignored self-dependency on "${ref}"`);
        continue;
      }
      edges.push({ sourceNodeId: sourceId, targetNodeId: intent.targetId, dependencyType: 'blocks', createdBy: user.id });
    }
  }
  let dependencyEdges = 0;
  if (edges.length) {
    try {
      const created = await dal.dependenciesDal.bulkCreate(edges);
      dependencyEdges = created.length;
    } catch (err) {
      dependencyWarnings.push(`Some dependency edges were rejected: ${err.message}`);
    }
  }

  // Structural quality signal so the agent can't silently ship fake structure.
  // Reuse the shared evaluator (persists qualityScore); fall back to a bare
  // edge/task count if evaluation fails for any reason.
  const taskCount = countTasks(children);
  let quality = null;
  try {
    quality = await evaluatePlanQuality(plan.id, goal_id, { orgId: organizationId, userId: user.id });
  } catch { /* non-fatal — structure summary below still computed */ }

  const createdWithoutDependencies = taskCount >= MIN_TASKS_FOR_DEP_WARNING && dependencyEdges === 0;
  const structure = {
    task_count: taskCount,
    dependency_edges: dependencyEdges,
    created_without_dependencies: createdWithoutDependencies,
    quality_score: quality?.score ?? null,
    ordering: quality?.ordering ?? null,
    created_by: client_version || 'agent-planner-mcp',
  };
  if (dependencyWarnings.length) structure.dependency_warnings = dependencyWarnings;

  const response = {
    as_of: asOf(),
    plan: {
      id: plan.id,
      title: plan.title,
      status: plan.status,
      visibility: plan.visibility,
      goal_id,
    },
    root: snakeNode(root),
    tree: children,
    structure,
    idempotency_key: crypto.createHash('sha256').update(`${goal_id}:${plan.id}`).digest('hex').slice(0, 16),
  };
  if (createdWithoutDependencies) {
    response.warning =
      `Plan has ${taskCount} tasks but no dependency edges — execution order is implicit only, ` +
      `so executor agents may run tasks out of order.`;
    response.next_required_action =
      'Call link_intentions to add blocking edges, or confirm the tasks are genuinely order-independent.';
  }
  return response;
}

// Count actionable (task/milestone) nodes in a created subtree.
function countTasks(children) {
  let n = 0;
  for (const c of children || []) {
    if (c.node_type === 'task' || c.node_type === 'milestone') n += 1;
    n += countTasks(c.children);
  }
  return n;
}

module.exports = {
  AgentLoopError,
  getBriefing,
  startWorkSession,
  finishWorkSession,
  createIntention,
};
