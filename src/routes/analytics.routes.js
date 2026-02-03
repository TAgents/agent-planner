/**
 * Analytics Routes
 * 
 * Plan analytics, metrics, trends, and insights.
 */

const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth.middleware');
const { supabaseAdmin } = require('../config/supabase');
const logger = require('../utils/logger');

/**
 * @swagger
 * /plans/{id}/analytics:
 *   get:
 *     summary: Get plan analytics
 *     description: Get comprehensive analytics for a plan including velocity, trends, and insights
 *     tags: [Analytics]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *       - in: query
 *         name: period
 *         schema:
 *           type: string
 *           enum: [week, month, quarter, all]
 *           default: month
 *         description: Time period for trends
 *     responses:
 *       200:
 *         description: Plan analytics
 */
router.get('/:id/analytics', authenticate, async (req, res) => {
  try {
    const { id: planId } = req.params;
    const { period = 'month' } = req.query;
    const userId = req.user.id;

    // Verify plan access
    const { data: plan, error: planError } = await supabaseAdmin
      .from('plans')
      .select('id, title, owner_id, created_at')
      .eq('id', planId)
      .single();

    if (planError || !plan) {
      return res.status(404).json({ error: 'Plan not found' });
    }

    // Check access
    if (plan.owner_id !== userId) {
      const { data: collab } = await supabaseAdmin
        .from('plan_collaborators')
        .select('role')
        .eq('plan_id', planId)
        .eq('user_id', userId)
        .single();

      if (!collab) {
        return res.status(403).json({ error: 'Access denied' });
      }
    }

    // Get all nodes for this plan
    const { data: nodes, error: nodesError } = await supabaseAdmin
      .from('plan_nodes')
      .select('id, node_type, title, status, created_at, updated_at, parent_id')
      .eq('plan_id', planId);

    if (nodesError) {
      await logger.error('Failed to fetch nodes for analytics:', nodesError);
      return res.status(500).json({ error: 'Failed to fetch plan data' });
    }

    // Get activity logs for trends (skip if no nodes to avoid empty IN clause)
    const periodStart = getPeriodStart(period);
    let logs = [];
    if (nodes.length > 0) {
      const { data: logsData, error: logsError } = await supabaseAdmin
        .from('plan_node_logs')
        .select('id, node_id, log_type, created_at, content')
        .in('node_id', nodes.map(n => n.id))
        .gte('created_at', periodStart.toISOString())
        .order('created_at', { ascending: true });

      if (logsError) {
        await logger.error('Failed to fetch logs for analytics:', logsError);
        // Continue with empty logs rather than failing - logs are supplementary
      } else {
        logs = logsData || [];
      }
    }

    // Calculate metrics
    const tasks = nodes.filter(n => n.node_type === 'task');
    const phases = nodes.filter(n => n.node_type === 'phase');
    
    const completedTasks = tasks.filter(t => t.status === 'completed');
    const inProgressTasks = tasks.filter(t => t.status === 'in_progress');
    const blockedTasks = tasks.filter(t => t.status === 'blocked');
    const notStartedTasks = tasks.filter(t => t.status === 'not_started');

    // Calculate completion rate
    const completionRate = tasks.length > 0 
      ? Math.round((completedTasks.length / tasks.length) * 100) 
      : 0;

    // Calculate velocity (tasks completed per week)
    const velocity = calculateVelocity(completedTasks, logs);

    // Calculate phase progress
    const phaseProgress = phases.map(phase => {
      const phaseTasks = tasks.filter(t => t.parent_id === phase.id);
      const phaseCompleted = phaseTasks.filter(t => t.status === 'completed').length;
      return {
        id: phase.id,
        title: phase.title,
        status: phase.status,
        total_tasks: phaseTasks.length,
        completed_tasks: phaseCompleted,
        progress: phaseTasks.length > 0 
          ? Math.round((phaseCompleted / phaseTasks.length) * 100) 
          : 0,
        blocked_tasks: phaseTasks.filter(t => t.status === 'blocked').length
      };
    });

    // Find bottleneck phases (phases with blocked tasks or low progress)
    const bottlenecks = phaseProgress
      .filter(p => p.blocked_tasks > 0 || (p.total_tasks > 0 && p.progress < 25))
      .map(p => ({
        phase: p.title,
        reason: p.blocked_tasks > 0 
          ? `${p.blocked_tasks} blocked task(s)` 
          : `Only ${p.progress}% complete`
      }));

    // Calculate trends (tasks completed per time unit)
    const trends = calculateTrends(completedTasks, logs, period);

    // Identify overdue tasks (tasks with due_date in the past)
    const { data: overdueTasks } = await supabaseAdmin
      .from('plan_nodes')
      .select('id, title, due_date, status')
      .eq('plan_id', planId)
      .eq('node_type', 'task')
      .neq('status', 'completed')
      .lt('due_date', new Date().toISOString())
      .not('due_date', 'is', null);

    // Find longest-running tasks (in_progress for longest time)
    const longestRunning = inProgressTasks
      .map(t => ({
        id: t.id,
        title: t.title,
        days_in_progress: Math.floor((new Date() - new Date(t.updated_at)) / (1000 * 60 * 60 * 24))
      }))
      .sort((a, b) => b.days_in_progress - a.days_in_progress)
      .slice(0, 5);

    // Activity summary
    const activitySummary = {
      total_logs: logs.length,
      progress_updates: logs.filter(l => l.log_type === 'progress').length,
      status_changes: logs.filter(l => l.log_type === 'status_change').length,
      comments: logs.filter(l => l.log_type === 'comment').length
    };

    // Build response
    const analytics = {
      plan: {
        id: plan.id,
        title: plan.title,
        created_at: plan.created_at,
        age_days: Math.floor((new Date() - new Date(plan.created_at)) / (1000 * 60 * 60 * 24))
      },
      summary: {
        total_tasks: tasks.length,
        completed: completedTasks.length,
        in_progress: inProgressTasks.length,
        blocked: blockedTasks.length,
        not_started: notStartedTasks.length,
        completion_rate: completionRate,
        total_phases: phases.length
      },
      velocity: {
        tasks_per_week: velocity.tasksPerWeek,
        trend: velocity.trend, // 'increasing', 'decreasing', 'stable'
        estimated_completion: velocity.estimatedCompletion
      },
      phases: phaseProgress,
      trends: trends,
      insights: {
        bottlenecks: bottlenecks,
        overdue_tasks: overdueTasks || [],
        longest_running: longestRunning
      },
      activity: activitySummary,
      period: period,
      generated_at: new Date().toISOString()
    };

    return res.json(analytics);

  } catch (error) {
    await logger.error('Analytics error:', error);
    return res.status(500).json({ error: 'Failed to generate analytics' });
  }
});

/**
 * @swagger
 * /plans/{id}/analytics/export:
 *   get:
 *     summary: Export plan analytics
 *     description: Export analytics as CSV or JSON
 *     tags: [Analytics]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *       - in: query
 *         name: format
 *         schema:
 *           type: string
 *           enum: [csv, json]
 *           default: json
 */
router.get('/:id/analytics/export', authenticate, async (req, res) => {
  try {
    const { id: planId } = req.params;
    const { format = 'json' } = req.query;
    const userId = req.user.id;

    // Verify plan access
    const { data: plan, error: planError } = await supabaseAdmin
      .from('plans')
      .select('id, title, owner_id')
      .eq('id', planId)
      .single();

    if (planError || !plan) {
      return res.status(404).json({ error: 'Plan not found' });
    }

    if (plan.owner_id !== userId) {
      const { data: collab } = await supabaseAdmin
        .from('plan_collaborators')
        .select('role')
        .eq('plan_id', planId)
        .eq('user_id', userId)
        .single();

      if (!collab) {
        return res.status(403).json({ error: 'Access denied' });
      }
    }

    // Get all tasks with details
    const { data: tasks } = await supabaseAdmin
      .from('plan_nodes')
      .select(`
        id,
        title,
        description,
        node_type,
        status,
        created_at,
        updated_at,
        due_date,
        parent_id
      `)
      .eq('plan_id', planId)
      .eq('node_type', 'task')
      .order('created_at');

    // Get phases for task grouping
    const { data: phases } = await supabaseAdmin
      .from('plan_nodes')
      .select('id, title')
      .eq('plan_id', planId)
      .eq('node_type', 'phase');

    const phaseMap = new Map(phases?.map(p => [p.id, p.title]) || []);

    const exportData = tasks?.map(task => ({
      id: task.id,
      title: task.title,
      description: task.description || '',
      phase: phaseMap.get(task.parent_id) || 'No Phase',
      status: task.status,
      created_at: task.created_at,
      updated_at: task.updated_at,
      due_date: task.due_date || '',
      days_since_update: Math.floor((new Date() - new Date(task.updated_at)) / (1000 * 60 * 60 * 24))
    })) || [];

    if (format === 'csv') {
      // Generate CSV
      const headers = ['ID', 'Title', 'Description', 'Phase', 'Status', 'Created', 'Updated', 'Due Date', 'Days Since Update'];
      const rows = exportData.map(t => [
        t.id,
        `"${t.title.replace(/"/g, '""')}"`,
        `"${t.description.replace(/"/g, '""')}"`,
        `"${t.phase.replace(/"/g, '""')}"`,
        t.status,
        t.created_at,
        t.updated_at,
        t.due_date,
        t.days_since_update
      ]);

      const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="${plan.title.replace(/[^a-z0-9]/gi, '_')}_analytics.csv"`);
      return res.send(csv);
    }

    // JSON format
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="${plan.title.replace(/[^a-z0-9]/gi, '_')}_analytics.json"`);
    return res.json({
      plan: { id: plan.id, title: plan.title },
      exported_at: new Date().toISOString(),
      tasks: exportData
    });

  } catch (error) {
    await logger.error('Analytics export error:', error);
    return res.status(500).json({ error: 'Failed to export analytics' });
  }
});

/**
 * Helper: Get period start date
 */
function getPeriodStart(period) {
  const now = new Date();
  switch (period) {
    case 'week':
      return new Date(now.setDate(now.getDate() - 7));
    case 'month':
      return new Date(now.setMonth(now.getMonth() - 1));
    case 'quarter':
      return new Date(now.setMonth(now.getMonth() - 3));
    case 'all':
      return new Date(0); // Beginning of time
    default:
      return new Date(now.setMonth(now.getMonth() - 1));
  }
}

/**
 * Helper: Calculate velocity metrics
 */
function calculateVelocity(completedTasks, logs) {
  if (completedTasks.length === 0) {
    return {
      tasksPerWeek: 0,
      trend: 'stable',
      estimatedCompletion: null
    };
  }

  // Group completions by week
  const weeklyCompletions = {};
  completedTasks.forEach(task => {
    const weekStart = getWeekStart(new Date(task.updated_at));
    const key = weekStart.toISOString().split('T')[0];
    weeklyCompletions[key] = (weeklyCompletions[key] || 0) + 1;
  });

  const weeks = Object.keys(weeklyCompletions).sort();
  const recentWeeks = weeks.slice(-4); // Last 4 weeks
  
  const tasksPerWeek = recentWeeks.length > 0
    ? Math.round(recentWeeks.reduce((sum, w) => sum + weeklyCompletions[w], 0) / recentWeeks.length * 10) / 10
    : 0;

  // Determine trend
  let trend = 'stable';
  if (recentWeeks.length >= 2) {
    const recent = weeklyCompletions[recentWeeks[recentWeeks.length - 1]] || 0;
    const previous = weeklyCompletions[recentWeeks[recentWeeks.length - 2]] || 0;
    if (recent > previous * 1.2) trend = 'increasing';
    else if (recent < previous * 0.8) trend = 'decreasing';
  }

  return {
    tasksPerWeek,
    trend,
    estimatedCompletion: null // Could calculate based on remaining tasks
  };
}

/**
 * Helper: Calculate trends over time
 */
function calculateTrends(completedTasks, logs, period) {
  const buckets = {};
  const bucketFormat = period === 'week' ? 'day' : 'week';

  completedTasks.forEach(task => {
    const date = new Date(task.updated_at);
    let key;
    
    if (bucketFormat === 'day') {
      key = date.toISOString().split('T')[0];
    } else {
      const weekStart = getWeekStart(date);
      key = weekStart.toISOString().split('T')[0];
    }
    
    buckets[key] = (buckets[key] || 0) + 1;
  });

  // Convert to array and sort
  return Object.entries(buckets)
    .map(([date, count]) => ({ date, completed: count }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Helper: Get week start (Monday)
 */
function getWeekStart(date) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  return new Date(d.setDate(diff));
}

module.exports = router;
