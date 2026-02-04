/**
 * Goal Routes
 * 
 * Manage goals, success metrics, and plan-goal relationships.
 */

const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth.middleware');
const { supabaseAdmin } = require('../config/supabase');
const logger = require('../utils/logger');
const { calculatePlanProgress } = require('../controllers/plan.controller');

/**
 * @swagger
 * /goals:
 *   get:
 *     summary: List goals
 *     description: List goals for an organization or across all user's orgs
 *     tags: [Goals]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: organization_id
 *         schema:
 *           type: string
 *           format: uuid
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [active, achieved, at_risk, abandoned]
 *     responses:
 *       200:
 *         description: List of goals
 */
router.get('/', authenticate, async (req, res) => {
  try {
    const { organization_id, status } = req.query;
    const userId = req.user.id;

    // Get user's organizations
    const { data: memberships } = await supabaseAdmin
      .from('organization_members')
      .select('organization_id')
      .eq('user_id', userId);

    const orgIds = memberships?.map(m => m.organization_id) || [];

    if (orgIds.length === 0) {
      return res.json({ goals: [] });
    }

    // Validate organization_id filter against user's memberships (security)
    let filterOrgIds = orgIds;
    if (organization_id) {
      if (!orgIds.includes(organization_id)) {
        return res.status(403).json({ error: 'Access denied to this organization' });
      }
      filterOrgIds = [organization_id];
    }

    let query = supabaseAdmin
      .from('goals')
      .select(`
        *,
        organizations (id, name, slug),
        users!goals_created_by_fkey (id, name, email)
      `)
      .in('organization_id', filterOrgIds)
      .order('created_at', { ascending: false });

    if (status) {
      query = query.eq('status', status);
    }

    const { data: goals, error } = await query;

    if (error) {
      await logger.error('Failed to fetch goals:', error);
      return res.status(500).json({ error: 'Failed to fetch goals' });
    }

    // Get linked plan counts
    const goalIds = goals.map(g => g.id);
    const { data: planCounts } = await supabaseAdmin
      .from('plan_goals')
      .select('goal_id')
      .in('goal_id', goalIds);

    const countMap = {};
    planCounts?.forEach(pc => {
      countMap[pc.goal_id] = (countMap[pc.goal_id] || 0) + 1;
    });

    return res.json({
      goals: goals.map(g => ({
        ...g,
        organization: g.organizations,
        created_by_user: g.users,
        linked_plans_count: countMap[g.id] || 0,
        organizations: undefined,
        users: undefined
      }))
    });

  } catch (error) {
    await logger.error('List goals error:', error);
    return res.status(500).json({ error: 'Failed to list goals' });
  }
});

/**
 * @swagger
 * /goals/{id}:
 *   get:
 *     summary: Get goal details
 *     tags: [Goals]
 *     security:
 *       - bearerAuth: []
 */
router.get('/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const { data: goal, error } = await supabaseAdmin
      .from('goals')
      .select(`
        *,
        organizations (id, name, slug),
        users!goals_created_by_fkey (id, name, email)
      `)
      .eq('id', id)
      .single();

    if (error || !goal) {
      return res.status(404).json({ error: 'Goal not found' });
    }

    // Check access
    const { data: membership } = await supabaseAdmin
      .from('organization_members')
      .select('role')
      .eq('organization_id', goal.organization_id)
      .eq('user_id', userId)
      .single();

    if (!membership) {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Get linked plans - fetch plan_goals first, then plans separately
    const { data: planGoalLinks, error: linkError } = await supabaseAdmin
      .from('plan_goals')
      .select('plan_id, linked_at')
      .eq('goal_id', id);

    if (linkError) {
      await logger.error('Error fetching plan_goals:', linkError);
    }
    await logger.api(`Goal ${id} has ${planGoalLinks?.length || 0} plan links`);

    let linkedPlans = [];
    if (planGoalLinks && planGoalLinks.length > 0) {
      const planIds = planGoalLinks.map(pg => pg.plan_id);
      await logger.api(`Fetching plans: ${planIds.join(', ')}`);
      
      const { data: plans, error: plansError } = await supabaseAdmin
        .from('plans')
        .select('id, title, status')
        .in('id', planIds);

      if (plansError) {
        await logger.error('Error fetching plans:', plansError);
      }
      await logger.api(`Found ${plans?.length || 0} plans`);

      // Calculate progress for each plan
      linkedPlans = await Promise.all((plans || []).map(async plan => {
        const link = planGoalLinks.find(pg => pg.plan_id === plan.id);
        const progress = await calculatePlanProgress(plan.id);
        return {
          ...plan,
          progress,
          linked_at: link?.linked_at
        };
      }));
    }

    return res.json({
      ...goal,
      organization: goal.organizations,
      created_by_user: goal.users,
      linked_plans: linkedPlans,
      organizations: undefined,
      users: undefined
    });

  } catch (error) {
    await logger.error('Get goal error:', error);
    return res.status(500).json({ error: 'Failed to get goal' });
  }
});

/**
 * @swagger
 * /goals:
 *   post:
 *     summary: Create goal
 *     tags: [Goals]
 *     security:
 *       - bearerAuth: []
 */
router.post('/', authenticate, async (req, res) => {
  try {
    const { 
      organization_id, 
      title, 
      description, 
      success_metrics,
      time_horizon,
      github_repo_url 
    } = req.body;
    const userId = req.user.id;

    if (!organization_id || !title) {
      return res.status(400).json({ error: 'organization_id and title are required' });
    }

    // Check membership
    const { data: membership } = await supabaseAdmin
      .from('organization_members')
      .select('role')
      .eq('organization_id', organization_id)
      .eq('user_id', userId)
      .single();

    if (!membership) {
      return res.status(403).json({ error: 'You must be a member of the organization' });
    }

    // Validate success_metrics format
    let metrics = [];
    if (success_metrics) {
      if (!Array.isArray(success_metrics)) {
        return res.status(400).json({ error: 'success_metrics must be an array' });
      }
      metrics = success_metrics.map(m => ({
        metric: m.metric || '',
        target: m.target || null,
        current: m.current || null,
        unit: m.unit || ''
      }));
    }

    const { data: goal, error } = await supabaseAdmin
      .from('goals')
      .insert({
        organization_id,
        title,
        description: description || '',
        success_metrics: metrics,
        time_horizon: time_horizon || null,
        github_repo_url: github_repo_url || null,
        created_by: userId,
        status: 'active'
      })
      .select()
      .single();

    if (error) {
      await logger.error('Failed to create goal:', error);
      return res.status(500).json({ error: 'Failed to create goal' });
    }

    await logger.api(`Goal created: ${goal.id} in org ${organization_id}`);

    return res.status(201).json(goal);

  } catch (error) {
    await logger.error('Create goal error:', error);
    return res.status(500).json({ error: 'Failed to create goal' });
  }
});

/**
 * @swagger
 * /goals/{id}:
 *   put:
 *     summary: Update goal
 *     tags: [Goals]
 *     security:
 *       - bearerAuth: []
 */
router.put('/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const { title, description, success_metrics, time_horizon, status, github_repo_url } = req.body;
    const userId = req.user.id;

    // Get goal and check access
    const { data: goal } = await supabaseAdmin
      .from('goals')
      .select('organization_id, created_by')
      .eq('id', id)
      .single();

    if (!goal) {
      return res.status(404).json({ error: 'Goal not found' });
    }

    // Check if user is org admin/owner or goal creator
    const { data: membership } = await supabaseAdmin
      .from('organization_members')
      .select('role')
      .eq('organization_id', goal.organization_id)
      .eq('user_id', userId)
      .single();

    const canEdit = membership && 
      (['owner', 'admin'].includes(membership.role) || goal.created_by === userId);

    if (!canEdit) {
      return res.status(403).json({ error: 'Only org admins or goal creator can update' });
    }

    const updates = { updated_at: new Date().toISOString() };
    if (title !== undefined) updates.title = title;
    if (description !== undefined) updates.description = description;
    if (success_metrics !== undefined) updates.success_metrics = success_metrics;
    if (time_horizon !== undefined) updates.time_horizon = time_horizon;
    if (status !== undefined) {
      if (!['active', 'achieved', 'at_risk', 'abandoned'].includes(status)) {
        return res.status(400).json({ error: 'Invalid status' });
      }
      updates.status = status;
    }
    if (github_repo_url !== undefined) updates.github_repo_url = github_repo_url;

    const { data: updated, error } = await supabaseAdmin
      .from('goals')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      await logger.error('Failed to update goal:', error);
      return res.status(500).json({ error: 'Failed to update goal' });
    }

    return res.json(updated);

  } catch (error) {
    await logger.error('Update goal error:', error);
    return res.status(500).json({ error: 'Failed to update goal' });
  }
});

/**
 * @swagger
 * /goals/{id}/metrics:
 *   put:
 *     summary: Update goal metrics
 *     tags: [Goals]
 *     security:
 *       - bearerAuth: []
 */
router.put('/:id/metrics', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const { metrics } = req.body;
    const userId = req.user.id;

    if (!Array.isArray(metrics)) {
      return res.status(400).json({ error: 'metrics must be an array' });
    }

    // Get goal and check access
    const { data: goal } = await supabaseAdmin
      .from('goals')
      .select('organization_id')
      .eq('id', id)
      .single();

    if (!goal) {
      return res.status(404).json({ error: 'Goal not found' });
    }

    // Check membership (any member can update metrics)
    const { data: membership } = await supabaseAdmin
      .from('organization_members')
      .select('role')
      .eq('organization_id', goal.organization_id)
      .eq('user_id', userId)
      .single();

    if (!membership) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const { data: updated, error } = await supabaseAdmin
      .from('goals')
      .update({ 
        success_metrics: metrics,
        updated_at: new Date().toISOString()
      })
      .eq('id', id)
      .select()
      .single();

    if (error) {
      await logger.error('Failed to update metrics:', error);
      return res.status(500).json({ error: 'Failed to update metrics' });
    }

    return res.json(updated);

  } catch (error) {
    await logger.error('Update metrics error:', error);
    return res.status(500).json({ error: 'Failed to update metrics' });
  }
});

/**
 * @swagger
 * /goals/{id}:
 *   delete:
 *     summary: Delete goal
 *     tags: [Goals]
 *     security:
 *       - bearerAuth: []
 */
router.delete('/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    // Get goal
    const { data: goal } = await supabaseAdmin
      .from('goals')
      .select('organization_id')
      .eq('id', id)
      .single();

    if (!goal) {
      return res.status(404).json({ error: 'Goal not found' });
    }

    // Check admin/owner access
    const { data: membership } = await supabaseAdmin
      .from('organization_members')
      .select('role')
      .eq('organization_id', goal.organization_id)
      .eq('user_id', userId)
      .single();

    if (!membership || !['owner', 'admin'].includes(membership.role)) {
      return res.status(403).json({ error: 'Only org admins can delete goals' });
    }

    const { error } = await supabaseAdmin
      .from('goals')
      .delete()
      .eq('id', id);

    if (error) {
      await logger.error('Failed to delete goal:', error);
      return res.status(500).json({ error: 'Failed to delete goal' });
    }

    await logger.api(`Goal deleted: ${id}`);

    return res.json({ success: true, message: 'Goal deleted' });

  } catch (error) {
    await logger.error('Delete goal error:', error);
    return res.status(500).json({ error: 'Failed to delete goal' });
  }
});

/**
 * @swagger
 * /goals/{goalId}/plans/{planId}:
 *   post:
 *     summary: Link plan to goal
 *     tags: [Goals]
 *     security:
 *       - bearerAuth: []
 */
router.post('/:goalId/plans/:planId', authenticate, async (req, res) => {
  try {
    const { goalId, planId } = req.params;
    const userId = req.user.id;

    // Check goal exists and user has access
    const { data: goal } = await supabaseAdmin
      .from('goals')
      .select('organization_id')
      .eq('id', goalId)
      .single();

    if (!goal) {
      return res.status(404).json({ error: 'Goal not found' });
    }

    // Check plan exists and user has access
    const { data: plan } = await supabaseAdmin
      .from('plans')
      .select('id, owner_id')
      .eq('id', planId)
      .single();

    if (!plan) {
      return res.status(404).json({ error: 'Plan not found' });
    }

    // Check user can access plan
    if (plan.owner_id !== userId) {
      const { data: collab } = await supabaseAdmin
        .from('plan_collaborators')
        .select('role')
        .eq('plan_id', planId)
        .eq('user_id', userId)
        .single();

      if (!collab) {
        return res.status(403).json({ error: 'No access to plan' });
      }
    }

    // Check if already linked
    const { data: existing } = await supabaseAdmin
      .from('plan_goals')
      .select('id')
      .eq('plan_id', planId)
      .eq('goal_id', goalId)
      .single();

    if (existing) {
      return res.status(400).json({ error: 'Plan is already linked to this goal' });
    }

    // Create link
    const { data: link, error } = await supabaseAdmin
      .from('plan_goals')
      .insert({
        plan_id: planId,
        goal_id: goalId,
        linked_by: userId
      })
      .select()
      .single();

    if (error) {
      await logger.error('Failed to link plan to goal:', error);
      return res.status(500).json({ error: 'Failed to link plan to goal' });
    }

    await logger.api(`Plan ${planId} linked to goal ${goalId}`);

    return res.status(201).json(link);

  } catch (error) {
    await logger.error('Link plan to goal error:', error);
    return res.status(500).json({ error: 'Failed to link plan to goal' });
  }
});

/**
 * @swagger
 * /goals/{goalId}/plans/{planId}:
 *   delete:
 *     summary: Unlink plan from goal
 *     tags: [Goals]
 *     security:
 *       - bearerAuth: []
 */
router.delete('/:goalId/plans/:planId', authenticate, async (req, res) => {
  try {
    const { goalId, planId } = req.params;
    const userId = req.user.id;

    // Check plan access
    const { data: plan } = await supabaseAdmin
      .from('plans')
      .select('owner_id')
      .eq('id', planId)
      .single();

    if (!plan) {
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
        return res.status(403).json({ error: 'No access to plan' });
      }
    }

    const { error } = await supabaseAdmin
      .from('plan_goals')
      .delete()
      .eq('plan_id', planId)
      .eq('goal_id', goalId);

    if (error) {
      await logger.error('Failed to unlink plan from goal:', error);
      return res.status(500).json({ error: 'Failed to unlink plan from goal' });
    }

    await logger.api(`Plan ${planId} unlinked from goal ${goalId}`);

    return res.json({ success: true, message: 'Plan unlinked from goal' });

  } catch (error) {
    await logger.error('Unlink plan from goal error:', error);
    return res.status(500).json({ error: 'Failed to unlink plan from goal' });
  }
});

module.exports = router;
