/**
 * Dashboard Routes - using DAL layer
 */

const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth.middleware');
const { plansDal, nodesDal, decisionsDal, collaboratorsDal, usersDal, logsDal, goalsDal } = require('../db/dal.cjs');
const logger = require('../utils/logger');

/**
 * Helper to get all plan IDs a user has access to (owned + collaborated + org-level)
 * Must pass organizationId so org-scoped plans are included — matching listPlans controller behaviour.
 */
async function getUserPlanIds(userId, organizationId = null) {
  const { owned, shared, organization } = await plansDal.listForUser(userId, { organizationId });
  const allPlans = [...owned, ...shared, ...organization];
  return [...new Set(allPlans.map(p => p.id))];
}

// ─── Dashboard summary stats ─────────────────────────────────────
router.get('/summary', authenticate, async (req, res) => {
  try {
    const userId = req.user.id;
    const now = new Date();
    const dayOfWeek = now.getDay();
    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1));
    weekStart.setHours(0, 0, 0, 0);

    const organizationId = req.user.organizationId || null;
    const planIds = await getUserPlanIds(userId, organizationId);

    // Active plans count — only 'active' status, matching the Plans page filter
    const activePlansCount = planIds.length > 0
      ? await plansDal.countByIds(planIds, { status: ['active'] })
      : 0;

    // Pending decisions
    let pendingDecisionsCount = 0;
    for (const planId of planIds) {
      try {
        pendingDecisionsCount += await decisionsDal.countPending(planId);
      } catch (e) {}
    }

    // Tasks with agent requests
    let pendingAgentRequestsCount = 0;
    if (planIds.length > 0) {
      const requestedNodes = await nodesDal.listByPlanIds(planIds, { agentRequested: true, agentRequestedBy: userId });
      pendingAgentRequestsCount = requestedNodes.length;
    }

    // Tasks completed this week
    let tasksCompletedThisWeek = 0;
    for (const planId of planIds) {
      tasksCompletedThisWeek += await nodesDal.countByPlan(planId, {
        nodeType: 'task', status: 'completed', since: weekStart
      });
    }

    res.json({
      pending_decisions_count: pendingDecisionsCount,
      pending_agent_requests_count: pendingAgentRequestsCount,
      active_plans_count: activePlansCount,
      tasks_completed_this_week: tasksCompletedThisWeek,
      active_goals_count: 0,
      knowledge_entries_count: 0
    });
  } catch (error) {
    await logger.error('Dashboard summary error:', error);
    res.status(500).json({ error: 'Failed to fetch dashboard summary' });
  }
});

// ─── Pending items ───────────────────────────────────────────────
router.get('/pending', authenticate, async (req, res) => {
  try {
    const userId = req.user.id;
    const limit = Math.min(parseInt(req.query.limit) || 5, 20);
    const organizationId = req.user.organizationId || null;
    const planIds = await getUserPlanIds(userId, organizationId);

    // Pending decisions
    const allDecisions = [];
    for (const planId of planIds) {
      try {
        const decisions = await decisionsDal.listByPlan(planId, { status: 'pending' });
        const plan = await plansDal.findById(planId);
        decisions.forEach(d => allDecisions.push({ ...d, planTitle: plan?.title }));
      } catch (e) {}
    }

    // Tasks with agent requests
    let agentRequests = [];
    if (planIds.length > 0) {
      const nodes = await nodesDal.listByPlanIds(planIds, { agentRequested: true, agentRequestedBy: userId, limit });
      for (const node of nodes) {
        const plan = await plansDal.findById(node.planId);
        agentRequests.push({
          id: node.id, task_title: node.title, request_type: node.agentRequested,
          requested_at: node.agentRequestedAt, message: node.agentRequestMessage,
          plan_id: node.planId, plan_title: plan?.title || 'Unknown Plan'
        });
      }
    }

    // Drafts: agent-proposed plans + goals awaiting human review
    const drafts = [];
    try {
      const { owned, shared, organization } = await plansDal.listForUser(userId, { organizationId, status: 'draft' });
      const draftPlans = [...owned, ...shared, ...organization];
      for (const p of draftPlans) {
        drafts.push({
          id: p.id,
          kind: 'plan',
          title: p.title,
          rationale: p.description,
          created_at: p.createdAt,
          owner_id: p.ownerId,
        });
      }
    } catch (e) {}

    try {
      const draftGoals = await goalsDal.findAll({ userId, organizationId }, { status: 'draft' });
      for (const g of draftGoals) {
        drafts.push({
          id: g.id,
          kind: 'goal',
          title: g.title,
          rationale: g.description,
          created_at: g.createdAt,
          owner_id: g.ownerId,
          parent_goal_id: g.parentGoalId,
        });
      }
    } catch (e) {}

    res.json({
      decisions: allDecisions.slice(0, limit).map(d => ({
        id: d.id, title: d.title, description: d.context, urgency: d.urgency,
        options: d.options || [],
        created_at: d.createdAt, plan_id: d.planId, plan_title: d.planTitle, node_id: d.nodeId,
        kind: 'decision',
      })),
      agent_requests: agentRequests,
      drafts: drafts.slice(0, limit),
      total: allDecisions.length + agentRequests.length + drafts.length
    });
  } catch (error) {
    await logger.error('Dashboard pending error:', error);
    res.status(500).json({ error: 'Failed to fetch pending items' });
  }
});

// ─── Recent plans ────────────────────────────────────────────────
router.get('/recent-plans', authenticate, async (req, res) => {
  try {
    const userId = req.user.id;
    const limit = Math.min(parseInt(req.query.limit) || 6, 20);
    const organizationId = req.user.organizationId || null;
    const planIds = await getUserPlanIds(userId, organizationId);

    if (planIds.length === 0) return res.json({ plans: [] });

    // Get plans and sort by updatedAt
    const allPlans = [];
    for (const planId of planIds) {
      const plan = await plansDal.findById(planId);
      if (plan && ['active', 'draft'].includes(plan.status)) allPlans.push(plan);
    }

    allPlans.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
    const recentPlans = allPlans.slice(0, limit);

    // Calculate progress
    const plansWithProgress = await Promise.all(recentPlans.map(async (plan) => {
      const nodes = await nodesDal.listByPlan(plan.id);
      const tasks = nodes.filter(n => n.nodeType === 'task');
      const completed = tasks.filter(n => n.status === 'completed');
      const progress = tasks.length > 0 ? Math.round((completed.length / tasks.length) * 100) : 0;

      return { ...plan, progress, is_owner: plan.ownerId === userId };
    }));

    res.json({ plans: plansWithProgress });
  } catch (error) {
    await logger.error('Dashboard recent plans error:', error);
    res.status(500).json({ error: 'Failed to fetch recent plans' });
  }
});

// ─── Active goals ────────────────────────────────────────────────
router.get('/active-goals', authenticate, async (req, res) => {
  try {
    const userId = req.user.id;
    const limit = parseInt(req.query.limit) || 5;
    const activeGoals = await goalsDal.getActiveGoalsForOwner(userId);

    // Calculate progress from linked plans
    const goalsWithProgress = await Promise.all(activeGoals.slice(0, limit).map(async (goal) => {
      const links = await goalsDal.findById(goal.id);
      const planLinks = (links?.links || []).filter(l => l.linkedType === 'plan');
      let totalTasks = 0, completedTasks = 0;

      for (const link of planLinks) {
        try {
          const nodes = await nodesDal.listByPlan(link.linkedId);
          const tasks = nodes.filter(n => n.nodeType === 'task');
          totalTasks += tasks.length;
          completedTasks += tasks.filter(n => n.status === 'completed').length;
        } catch (_) { /* plan may not exist */ }
      }

      const progress = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;
      return {
        id: goal.id,
        title: goal.title,
        description: goal.description,
        status: goal.status,
        type: goal.type,
        target_date: goal.targetDate,
        progress,
      };
    }));

    res.json({ goals: goalsWithProgress });
  } catch (error) {
    await logger.error('Dashboard active goals error:', error);
    res.status(500).json({ error: 'Failed to fetch active goals' });
  }
});


module.exports = router;
