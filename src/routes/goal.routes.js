/**
 * Goal Routes - using DAL layer
 */

const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth.middleware');
const { goalsDal, plansDal } = require('../db/dal.cjs');
const logger = require('../utils/logger');
const { calculatePlanProgress } = require('../controllers/plan.controller');

// ─── List goals ──────────────────────────────────────────────────
router.get('/', authenticate, async (req, res) => {
  try {
    const { status } = req.query;
    const userId = req.user.id;

    // Get goals owned by the user
    const goals = await goalsDal.findAll(userId, { status: status || undefined });

    return res.json({
      goals: goals.map(g => ({
        ...g,
        linked_plans_count: 0 // Would need goal links query
      }))
    });
  } catch (error) {
    await logger.error('List goals error:', error);
    return res.status(500).json({ error: 'Failed to list goals' });
  }
});

// ─── Get goal details ────────────────────────────────────────────
router.get('/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const goal = await goalsDal.findById(id);
    if (!goal) return res.status(404).json({ error: 'Goal not found' });

    // Get linked plans via goal links
    const linkedPlans = [];
    if (goal.links) {
      for (const link of goal.links.filter(l => l.linkedType === 'plan')) {
        try {
          const plan = await plansDal.findById(link.linkedId);
          if (plan) {
            const progress = await calculatePlanProgress(plan.id);
            linkedPlans.push({ ...plan, progress, linked_at: link.createdAt });
          }
        } catch (e) {}
      }
    }

    return res.json({
      ...goal,
      linked_plans: linkedPlans
    });
  } catch (error) {
    await logger.error('Get goal error:', error);
    return res.status(500).json({ error: 'Failed to get goal' });
  }
});

// ─── Create goal ─────────────────────────────────────────────────
router.post('/', authenticate, async (req, res) => {
  try {
    const { title, description, type = 'outcome', success_criteria, priority } = req.body;
    const userId = req.user.id;

    if (!title) return res.status(400).json({ error: 'title is required' });

    const goal = await goalsDal.create({
      ownerId: userId,
      title,
      description: description || '',
      type,
      successCriteria: success_criteria || null,
      priority: priority || 0,
      status: 'active'
    });

    return res.status(201).json(goal);
  } catch (error) {
    await logger.error('Create goal error:', error);
    return res.status(500).json({ error: 'Failed to create goal' });
  }
});

// ─── Update goal ─────────────────────────────────────────────────
router.put('/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const { title, description, success_criteria, status, priority } = req.body;

    const goal = await goalsDal.findById(id);
    if (!goal) return res.status(404).json({ error: 'Goal not found' });

    const updates = {};
    if (title !== undefined) updates.title = title;
    if (description !== undefined) updates.description = description;
    if (success_criteria !== undefined) updates.successCriteria = success_criteria;
    if (priority !== undefined) updates.priority = priority;
    if (status !== undefined) {
      if (!['active', 'achieved', 'paused', 'abandoned'].includes(status)) {
        return res.status(400).json({ error: 'Invalid status' });
      }
      updates.status = status;
    }

    const updated = await goalsDal.update(id, updates);
    return res.json(updated);
  } catch (error) {
    await logger.error('Update goal error:', error);
    return res.status(500).json({ error: 'Failed to update goal' });
  }
});

// ─── Delete goal ─────────────────────────────────────────────────
router.delete('/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const goal = await goalsDal.findById(id);
    if (!goal) return res.status(404).json({ error: 'Goal not found' });

    await goalsDal.softDelete(id);
    return res.json({ success: true, message: 'Goal deleted' });
  } catch (error) {
    await logger.error('Delete goal error:', error);
    return res.status(500).json({ error: 'Failed to delete goal' });
  }
});

// ─── Link plan to goal ──────────────────────────────────────────
router.post('/:goalId/plans/:planId', authenticate, async (req, res) => {
  try {
    const { goalId, planId } = req.params;
    const userId = req.user.id;

    const goal = await goalsDal.findById(goalId);
    if (!goal) return res.status(404).json({ error: 'Goal not found' });

    const { hasAccess } = await plansDal.userHasAccess(planId, userId);
    if (!hasAccess) return res.status(403).json({ error: 'No access to plan' });

    const link = await goalsDal.addLink(goalId, 'plan', planId);
    return res.status(201).json(link);
  } catch (error) {
    await logger.error('Link plan to goal error:', error);
    return res.status(500).json({ error: 'Failed to link plan to goal' });
  }
});

// ─── Unlink plan from goal ───────────────────────────────────────
router.delete('/:goalId/plans/:planId', authenticate, async (req, res) => {
  try {
    const { goalId, planId } = req.params;

    // Find the link and remove it
    const goal = await goalsDal.findById(goalId);
    if (!goal) return res.status(404).json({ error: 'Goal not found' });

    const link = goal.links?.find(l => l.linkedType === 'plan' && l.linkedId === planId);
    if (link) {
      await goalsDal.removeLink(link.id);
    }

    return res.json({ success: true, message: 'Plan unlinked from goal' });
  } catch (error) {
    await logger.error('Unlink plan from goal error:', error);
    return res.status(500).json({ error: 'Failed to unlink plan from goal' });
  }
});

module.exports = router;
