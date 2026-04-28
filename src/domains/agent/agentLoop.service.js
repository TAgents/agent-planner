const crypto = require('crypto');
const dal = require('../../db/dal.cjs');
const { assembleContext, suggestNextTasks } = require('../../services/contextEngine');
const reasoning = require('../../services/reasoning');
const graphitiBridge = require('../../services/graphitiBridge');

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
  coherence_status: node.coherenceStatus,
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
  belief_snapshot: claim.beliefSnapshot,
});

async function accessiblePlanIds(userId, organizationId) {
  const { owned = [], shared = [], organization = [] } =
    await dal.plansDal.listForUser(userId, { organizationId });
  return [...new Map([...owned, ...shared, ...organization].map(p => [p.id, p])).values()];
}

async function goalDashboard(user) {
  const rows = await dal.goalsDal.getDashboardData({
    organizationId: user.organizationId,
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
    const isStale = planIds.length > 0 && (!lastActivityTs || Date.now() - lastActivityTs > 3 * 24 * 60 * 60 * 1000);
    const percentBlocked = totalNodes ? Math.round((blockedNodes / totalNodes) * 100) : 0;
    const health = isStale
      ? 'stale'
      : (bottleneckSummary.length > 0 || percentBlocked > 30 || stalePending > 0 ? 'at_risk' : 'on_track');

    return {
      id: row.id,
      title: row.title,
      description: row.description,
      type: row.type,
      goal_type: row.goal_type || 'desire',
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

async function getBriefing(user, { goal_id, plan_id, recent_window_hours = 24 } = {}) {
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
  const recentActivity = [];
  for (const planId of scopedPlanIds.slice(0, 10)) {
    try {
      const logs = await dal.logsDal.listByPlan(planId, { limit: 20 });
      const rows = Array.isArray(logs) ? logs : (logs.logs || []);
      recentActivity.push(...rows
        .filter(l => l.createdAt && new Date(l.createdAt).getTime() >= recentCutoff)
        .map(l => ({
          type: 'log',
          ref_id: l.id,
          plan_id: planId,
          node_id: l.planNodeId,
          summary: l.content,
          occurred_at: l.createdAt,
        })));
    } catch {}
  }

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

  return {
    as_of: asOf(),
    scope: plan_id ? 'plan' : (goal_id ? 'goal' : 'mission_control'),
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
    const inProgress = await dal.nodesDal.listByPlanIds(planIds, {
      nodeType: 'task',
      status: 'in_progress',
      limit: 1,
    });
    if (inProgress[0]) return { node: inProgress[0], source: 'resume_in_progress' };
  }

  for (const planId of planIds) {
    const suggestions = await suggestNextTasks(planId, { limit: 1, orgId: user.organizationId });
    if (suggestions && suggestions[0]) {
      const node = suggestions[0].id ? suggestions[0] : suggestions[0].node;
      return { node, source: 'suggest_next_tasks' };
    }
  }

  const fallback = await dal.nodesDal.listByPlanIds(planIds, {
    nodeType: 'task',
    status: 'not_started',
    limit: 1,
  });
  if (fallback[0]) return { node: fallback[0], source: 'my_tasks_fallback' };
  throw new AgentLoopError('No actionable task found in scope', 404, 'not_found');
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

async function createIntention(user, { goal_id, title, description, rationale, status = 'draft', visibility = 'private', tree = [] }) {
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

  const plan = await dal.plansDal.create({
    title,
    description: [rationale, description].filter(Boolean).join('\n\n'),
    ownerId: user.id,
    organizationId: goal.organizationId || user.organizationId || null,
    status,
    visibility,
    metadata: { source: 'agent_loop', goal_id },
  });
  const root = await dal.nodesDal.create({
    planId: plan.id,
    nodeType: 'root',
    title,
    description: description || '',
    status: 'not_started',
    orderIndex: 0,
  });

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
      out.push({ ...snakeNode(node), children: await createChildren(child.children || [], node.id) });
    }
    return out;
  }

  const children = await createChildren(Array.isArray(tree) ? tree : [], root.id);
  await dal.goalsDal.addLink(goal_id, 'plan', plan.id);

  return {
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
    idempotency_key: crypto.createHash('sha256').update(`${goal_id}:${plan.id}`).digest('hex').slice(0, 16),
  };
}

module.exports = {
  AgentLoopError,
  getBriefing,
  startWorkSession,
  finishWorkSession,
  createIntention,
};
