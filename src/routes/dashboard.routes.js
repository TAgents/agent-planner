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
 *     description: Returns quick stats for the user's dashboard
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
 *                 pending_agent_requests_count:
 *                   type: integer
 *                 active_plans_count:
 *                   type: integer
 *                 tasks_completed_this_week:
 *                   type: integer
 *                 active_goals_count:
 *                   type: integer
 *                 knowledge_entries_count:
 *                   type: integer
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

    // Active plans count (owned or collaborating, status active/draft)
    const { count: activePlansCount } = await supabaseAdmin
      .from('plans')
      .select('*', { count: 'exact', head: true })
      .eq('owner_id', userId)
      .in('status', ['active', 'draft']);

    // Pending decisions count
    const { count: pendingDecisionsCount } = await supabaseAdmin
      .from('decision_requests')
      .select('*', { count: 'exact', head: true })
      .eq('requested_of_user_id', userId)
      .eq('status', 'pending');

    // Pending agent requests count
    const { count: pendingAgentRequestsCount } = await supabaseAdmin
      .from('agent_task_requests')
      .select('*', { count: 'exact', head: true })
      .eq('owner_id', userId)
      .eq('status', 'completed'); // Completed means agent responded, waiting for user to acknowledge

    // Tasks completed this week - get user's plans first
    const { data: userPlans } = await supabaseAdmin
      .from('plans')
      .select('id')
      .eq('owner_id', userId);
    
    const planIds = userPlans?.map(p => p.id) || [];
    
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
      .eq('owner_id', userId)
      .eq('status', 'active');

    // Knowledge entries count
    const { count: knowledgeEntriesCount } = await supabaseAdmin
      .from('knowledge_entries')
      .select('*', { count: 'exact', head: true })
      .eq('owner_id', userId);

    res.json({
      pending_decisions_count: pendingDecisionsCount || 0,
      pending_agent_requests_count: pendingAgentRequestsCount || 0,
      active_plans_count: activePlansCount || 0,
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
 *     description: Returns pending decisions and agent requests
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

    // Agent requests that are completed (ready for review)
    const { data: agentRequests } = await supabaseAdmin
      .from('agent_task_requests')
      .select(`
        id,
        request_type,
        status,
        completed_at,
        plan_id,
        task_id,
        plans:plan_id (
          id,
          title
        ),
        plan_nodes:task_id (
          id,
          title
        )
      `)
      .eq('owner_id', userId)
      .eq('status', 'completed')
      .order('completed_at', { ascending: false })
      .limit(limit);

    res.json({
      decisions: (decisions || []).map(d => ({
        id: d.id,
        title: d.title,
        description: d.description,
        urgency: d.urgency,
        created_at: d.created_at,
        plan_id: d.plan_id,
        plan_title: d.plans?.title,
        node_id: d.node_id
      })),
      agent_requests: (agentRequests || []).map(r => ({
        id: r.id,
        request_type: r.request_type,
        completed_at: r.completed_at,
        plan_id: r.plan_id,
        plan_title: r.plans?.title,
        task_id: r.task_id,
        task_title: r.plan_nodes?.title
      })),
      total: (decisions?.length || 0) + (agentRequests?.length || 0)
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
 *     description: Returns the user's most recently updated plans
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

    const { data: plans, error } = await supabaseAdmin
      .from('plans')
      .select(`
        id,
        title,
        description,
        status,
        created_at,
        updated_at,
        progress
      `)
      .eq('owner_id', userId)
      .in('status', ['active', 'draft'])
      .order('updated_at', { ascending: false })
      .limit(limit);

    if (error) throw error;

    res.json({ plans: plans || [] });
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
        target_date,
        current_value,
        target_value,
        metric_type,
        created_at,
        updated_at
      `)
      .eq('owner_id', userId)
      .eq('status', 'active')
      .order('updated_at', { ascending: false })
      .limit(limit);

    if (error) throw error;

    // Calculate progress for each goal
    const goalsWithProgress = (goals || []).map(goal => {
      let progress = 0;
      if (goal.target_value && goal.current_value !== null) {
        progress = Math.min(100, Math.round((goal.current_value / goal.target_value) * 100));
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

module.exports = router;
