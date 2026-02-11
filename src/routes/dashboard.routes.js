/**
 * Dashboard Routes
 * 
 * Aggregated dashboard data for the home page.
 */

const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth.middleware');
const { supabaseAdmin } = require('../config/supabase');
const logger = require('../utils/logger');

/**
 * Helper to get all plan IDs a user has access to (owned + collaborated)
 */
async function getUserPlanIds(userId) {
  // Get owned plans
  const { data: ownedPlans } = await supabaseAdmin
    .from('plans')
    .select('id')
    .eq('owner_id', userId);

  // Get collaborated plans
  const { data: collabPlans } = await supabaseAdmin
    .from('plan_collaborators')
    .select('plan_id')
    .eq('user_id', userId);

  const planIds = [
    ...(ownedPlans?.map(p => p.id) || []),
    ...(collabPlans?.map(c => c.plan_id) || [])
  ];

  // Return unique IDs
  return [...new Set(planIds)];
}

/**
 * @swagger
 * tags:
 *   name: Dashboard
 *   description: Dashboard and home page data
 */

/**
 * @swagger
 * /dashboard/summary:
 *   get:
 *     summary: Get dashboard summary stats
 *     description: Returns quick stats for the user's dashboard including owned and collaborated plans
 *     tags: [Dashboard]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Dashboard summary stats
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 pending_decisions_count:
 *                   type: integer
 *                   example: 3
 *                 pending_agent_requests_count:
 *                   type: integer
 *                   example: 2
 *                 active_plans_count:
 *                   type: integer
 *                   example: 5
 *                 tasks_completed_this_week:
 *                   type: integer
 *                   example: 12
 *                 active_goals_count:
 *                   type: integer
 *                   example: 3
 *                 knowledge_entries_count:
 *                   type: integer
 *                   example: 47
 */
router.get('/summary', authenticate, async (req, res) => {
  try {
    const userId = req.user.id;
    
    // Get week start (Monday)
    const now = new Date();
    const dayOfWeek = now.getDay();
    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1));
    weekStart.setHours(0, 0, 0, 0);

    // Get all plan IDs user has access to (owned + collaborated)
    const planIds = await getUserPlanIds(userId);

    // Active plans count (from user's accessible plans)
    let activePlansCount = 0;
    if (planIds.length > 0) {
      const { count } = await supabaseAdmin
        .from('plans')
        .select('*', { count: 'exact', head: true })
        .in('id', planIds)
        .in('status', ['active', 'draft']);
      activePlansCount = count || 0;
    }

    // Pending decisions count (where user is requested_of)
    const { count: pendingDecisionsCount } = await supabaseAdmin
      .from('decision_requests')
      .select('*', { count: 'exact', head: true })
      .eq('requested_of_user_id', userId)
      .eq('status', 'pending');

    // Pending agent requests count - tasks with agent_requested set in user's plans
    // (agent_requested is set but agent hasn't responded yet, or response needs review)
    let pendingAgentRequestsCount = 0;
    if (planIds.length > 0) {
      const { count } = await supabaseAdmin
        .from('plan_nodes')
        .select('*', { count: 'exact', head: true })
        .in('plan_id', planIds)
        .not('agent_requested', 'is', null)
        .eq('agent_requested_by', userId);
      pendingAgentRequestsCount = count || 0;
    }

    // Tasks completed this week - optimized single query with join
    let tasksCompletedThisWeek = 0;
    if (planIds.length > 0) {
      const { count } = await supabaseAdmin
        .from('plan_nodes')
        .select('*', { count: 'exact', head: true })
        .in('plan_id', planIds)
        .eq('node_type', 'task')
        .eq('status', 'completed')
        .gte('updated_at', weekStart.toISOString());
      tasksCompletedThisWeek = count || 0;
    }

    // Active goals count
    const { count: activeGoalsCount } = await supabaseAdmin
      .from('goals')
      .select('*', { count: 'exact', head: true })
      .eq('created_by', userId)
      .eq('status', 'active');

    // Knowledge entries count
    const { count: knowledgeEntriesCount } = await supabaseAdmin
      .from('knowledge_entries')
      .select('*', { count: 'exact', head: true })
      .eq('created_by', userId);

    res.json({
      pending_decisions_count: pendingDecisionsCount || 0,
      pending_agent_requests_count: pendingAgentRequestsCount,
      active_plans_count: activePlansCount,
      tasks_completed_this_week: tasksCompletedThisWeek,
      active_goals_count: activeGoalsCount || 0,
      knowledge_entries_count: knowledgeEntriesCount || 0
    });
  } catch (error) {
    await logger.error('Dashboard summary error:', error);
    res.status(500).json({ error: 'Failed to fetch dashboard summary' });
  }
});

/**
 * @swagger
 * /dashboard/pending:
 *   get:
 *     summary: Get pending items requiring attention
 *     description: Returns pending decisions and tasks with agent requests
 *     tags: [Dashboard]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 5
 *         description: Maximum items per category
 *     responses:
 *       200:
 *         description: Pending items
 */
router.get('/pending', authenticate, async (req, res) => {
  try {
    const userId = req.user.id;
    const limit = Math.min(parseInt(req.query.limit) || 5, 20);

    // Pending decisions with plan info
    const { data: decisions } = await supabaseAdmin
      .from('decision_requests')
      .select(`
        id,
        title,
        description,
        urgency,
        status,
        created_at,
        plan_id,
        node_id,
        plans:plan_id (
          id,
          title
        )
      `)
      .eq('requested_of_user_id', userId)
      .eq('status', 'pending')
      .order('created_at', { ascending: false })
      .limit(limit);

    // Get plan IDs for agent request query
    const planIds = await getUserPlanIds(userId);

    // Tasks with agent requests (from plan_nodes table)
    let agentRequests = [];
    if (planIds.length > 0) {
      const { data } = await supabaseAdmin
        .from('plan_nodes')
        .select(`
          id,
          title,
          agent_requested,
          agent_requested_at,
          agent_request_message,
          plan_id,
          plans:plan_id (
            id,
            title
          )
        `)
        .in('plan_id', planIds)
        .not('agent_requested', 'is', null)
        .eq('agent_requested_by', userId)
        .order('agent_requested_at', { ascending: false })
        .limit(limit);
      agentRequests = data || [];
    }

    res.json({
      decisions: (decisions || [])
        .filter(d => d.plans) // Only include if plan exists
        .map(d => ({
          id: d.id,
          title: d.title,
          description: d.description,
          urgency: d.urgency,
          created_at: d.created_at,
          plan_id: d.plan_id,
          plan_title: d.plans?.title || 'Unknown Plan',
          node_id: d.node_id
        })),
      agent_requests: agentRequests
        .filter(r => r.plans) // Only include if plan exists
        .map(r => ({
          id: r.id,
          task_title: r.title,
          request_type: r.agent_requested,
          requested_at: r.agent_requested_at,
          message: r.agent_request_message,
          plan_id: r.plan_id,
          plan_title: r.plans?.title || 'Unknown Plan'
        })),
      total: ((decisions || []).filter(d => d.plans).length) + 
             (agentRequests.filter(r => r.plans).length)
    });
  } catch (error) {
    await logger.error('Dashboard pending error:', error);
    res.status(500).json({ error: 'Failed to fetch pending items' });
  }
});

/**
 * @swagger
 * /dashboard/recent-plans:
 *   get:
 *     summary: Get recently accessed plans
 *     description: Returns the user's most recently updated plans (owned and collaborated)
 *     tags: [Dashboard]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 6
 *         description: Maximum plans to return
 *     responses:
 *       200:
 *         description: Recent plans
 */
router.get('/recent-plans', authenticate, async (req, res) => {
  try {
    const userId = req.user.id;
    const limit = Math.min(parseInt(req.query.limit) || 6, 20);

    // Get all plan IDs user has access to
    const planIds = await getUserPlanIds(userId);

    if (planIds.length === 0) {
      return res.json({ plans: [] });
    }

    const { data: plans, error } = await supabaseAdmin
      .from('plans')
      .select(`
        id,
        title,
        description,
        status,
        created_at,
        updated_at,
        owner_id
      `)
      .in('id', planIds)
      .in('status', ['active', 'draft'])
      .order('updated_at', { ascending: false })
      .limit(limit);

    if (error) throw error;

    // Calculate progress for each plan (completed tasks / total tasks)
    const plansWithProgress = await Promise.all((plans || []).map(async (plan) => {
      const { count: totalTasks } = await supabaseAdmin
        .from('plan_nodes')
        .select('*', { count: 'exact', head: true })
        .eq('plan_id', plan.id)
        .eq('node_type', 'task');
      
      const { count: completedTasks } = await supabaseAdmin
        .from('plan_nodes')
        .select('*', { count: 'exact', head: true })
        .eq('plan_id', plan.id)
        .eq('node_type', 'task')
        .eq('status', 'completed');
      
      const progress = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;
      
      return {
        ...plan,
        progress,
        is_owner: plan.owner_id === userId
      };
    }));

    res.json({ plans: plansWithProgress });
  } catch (error) {
    await logger.error('Dashboard recent plans error:', error);
    res.status(500).json({ error: 'Failed to fetch recent plans' });
  }
});

/**
 * @swagger
 * /dashboard/active-goals:
 *   get:
 *     summary: Get active goals with progress
 *     description: Returns the user's active goals with completion progress
 *     tags: [Dashboard]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 5
 *         description: Maximum goals to return
 *     responses:
 *       200:
 *         description: Active goals with progress
 */
router.get('/active-goals', authenticate, async (req, res) => {
  try {
    const userId = req.user.id;
    const limit = Math.min(parseInt(req.query.limit) || 5, 20);

    const { data: goals, error } = await supabaseAdmin
      .from('goals')
      .select(`
        id,
        title,
        description,
        status,
        time_horizon,
        success_metrics,
        created_at,
        updated_at
      `)
      .eq('created_by', userId)
      .eq('status', 'active')
      .order('updated_at', { ascending: false })
      .limit(limit);

    if (error) throw error;

    // Calculate progress from success_metrics
    const goalsWithProgress = (goals || []).map(goal => {
      let progress = 0;
      const metrics = goal.success_metrics || [];
      if (metrics.length > 0) {
        const totalProgress = metrics.reduce((sum, m) => {
          const target = parseFloat(m.target) || 0;
          const current = parseFloat(m.current) || 0;
          const metricProgress = target > 0 ? Math.min(100, (current / target) * 100) : 0;
          return sum + metricProgress;
        }, 0);
        progress = Math.round(totalProgress / metrics.length);
      }
      return {
        ...goal,
        progress
      };
    });

    res.json({ goals: goalsWithProgress });
  } catch (error) {
    await logger.error('Dashboard active goals error:', error);
    res.status(500).json({ error: 'Failed to fetch active goals' });
  }
});

/**
 * GET /dashboard/agent-activity
 * Returns agent activity data: assignments, handoffs, recent activity
 */
router.get('/agent-activity', authenticate, async (req, res) => {
  try {
    const userId = req.user.id;
    const planIds = await getUserPlanIds(userId);

    if (planIds.length === 0) {
      return res.json({ agents: [], assignments: [], handoffs: [], recentActivity: [] });
    }

    // Get all agents with capability tags
    const { data: agents } = await supabaseAdmin
      .from('users')
      .select('id, name, email, avatar_url, capability_tags')
      .not('capability_tags', 'eq', '{}');

    // Get current agent assignments across user's plans
    const { data: assignedNodes } = await supabaseAdmin
      .from('plan_nodes')
      .select('id, title, status, assigned_agent_id, assigned_agent_at, plan_id, plans:plan_id(title)')
      .in('plan_id', planIds)
      .not('assigned_agent_id', 'is', null)
      .order('assigned_agent_at', { ascending: false })
      .limit(50);

    // Get recent handoffs
    const { data: handoffs } = await supabaseAdmin
      .from('handoffs')
      .select('id, node_id, from_agent_id, to_agent_id, status, reason, created_at, plan_id, plan_nodes:node_id(title)')
      .in('plan_id', planIds)
      .order('created_at', { ascending: false })
      .limit(20);

    // Get recent activity logs from agent-assigned nodes
    const agentNodeIds = (assignedNodes || []).map(n => n.id);
    let recentActivity = [];
    if (agentNodeIds.length > 0) {
      const { data: logs } = await supabaseAdmin
        .from('plan_node_logs')
        .select('id, plan_node_id, user_id, content, log_type, created_at')
        .in('plan_node_id', agentNodeIds.slice(0, 20))
        .order('created_at', { ascending: false })
        .limit(30);
      recentActivity = logs || [];
    }

    res.json({
      agents: agents || [],
      assignments: assignedNodes || [],
      handoffs: handoffs || [],
      recentActivity
    });
  } catch (error) {
    await logger.error('Dashboard agent activity error:', error);
    res.status(500).json({ error: 'Failed to fetch agent activity' });
  }
});

module.exports = router;
