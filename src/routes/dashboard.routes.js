/**
 * Dashboard Routes - using DAL layer
 */

const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth.middleware');
const { plansDal, nodesDal, decisionsDal, collaboratorsDal, usersDal, logsDal } = require('../db/dal.cjs');
const logger = require('../utils/logger');

/**
 * Helper to get all plan IDs a user has access to
 */
async function getUserPlanIds(userId) {
  const ownedPlans = await plansDal.listByOwner(userId);
  const collabPlanIds = await collaboratorsDal.listPlanIdsForUser(userId);
  return [...new Set([...ownedPlans.map(p => p.id), ...collabPlanIds])];
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

    const planIds = await getUserPlanIds(userId);

    // Active plans count
    const activePlansCount = planIds.length > 0
      ? await plansDal.countByIds(planIds, { status: ['active', 'draft'] })
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
    const planIds = await getUserPlanIds(userId);

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

    res.json({
      decisions: allDecisions.slice(0, limit).map(d => ({
        id: d.id, title: d.title, description: d.context, urgency: d.urgency,
        created_at: d.createdAt, plan_id: d.planId, plan_title: d.planTitle, node_id: d.nodeId
      })),
      agent_requests: agentRequests,
      total: allDecisions.length + agentRequests.length
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
    const planIds = await getUserPlanIds(userId);

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
    res.json({ goals: [] }); // Goals are handled by goal routes
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch active goals' });
  }
});

// ─── Agent activity ──────────────────────────────────────────────
router.get('/agent-activity', authenticate, async (req, res) => {
  try {
    const userId = req.user.id;
    const planIds = await getUserPlanIds(userId);

    if (planIds.length === 0) {
      return res.json({ agents: [], assignments: [], handoffs: [], recentActivity: [] });
    }

    // Get assigned nodes
    const allAssignedNodes = [];
    for (const planId of planIds) {
      const nodes = await nodesDal.listByPlan(planId);
      const assigned = nodes.filter(n => n.assignedAgentId);
      const plan = await plansDal.findById(planId);
      assigned.forEach(n => allAssignedNodes.push({ ...n, planTitle: plan?.title }));
    }

    // Get agent users with capability tags
    const agentIds = [...new Set(allAssignedNodes.map(n => n.assignedAgentId).filter(Boolean))];
    const agents = agentIds.length > 0 ? await usersDal.findByIds(agentIds) : [];

    res.json({
      agents: agents.filter(a => a.capabilityTags?.length > 0),
      assignments: allAssignedNodes.slice(0, 50),
      handoffs: [],
      recentActivity: []
    });
  } catch (error) {
    await logger.error('Dashboard agent activity error:', error);
    res.status(500).json({ error: 'Failed to fetch agent activity' });
  }
});

module.exports = router;
