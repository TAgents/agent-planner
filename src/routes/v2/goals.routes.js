/**
 * Goals v2 Routes
 * 
 * Full goals system with types, hierarchy, generic links, and evaluations.
 */
const express = require('express');
const router = express.Router();
const { authenticate } = require('../../middleware/auth.middleware');
const logger = require('../../utils/logger');

// DAL (via CJS bridge) — access methods directly via proxy
const goalsDal = require('../../db/dal.cjs').goalsDal;

const VALID_TYPES = ['outcome', 'constraint', 'metric', 'principle'];
const VALID_STATUSES = ['active', 'achieved', 'paused', 'abandoned'];
const VALID_LINK_TYPES = ['plan', 'task', 'agent', 'workflow'];

// GET /api/goals/tree — must be before /:id
router.get('/tree', authenticate, async (req, res) => {
  try {
    const dal = goalsDal;
    const tree = await dal.getTree(req.user.id);
    res.json({ tree });
  } catch (err) {
    await logger.error('Goals tree error:', err);
    res.status(500).json({ error: 'Failed to fetch goals tree' });
  }
});

// GET /api/goals
router.get('/', authenticate, async (req, res) => {
  try {
    const dal = goalsDal;
    const { status, type } = req.query;
    const goals = await dal.findAll(req.user.id, { status, type });
    res.json({ goals });
  } catch (err) {
    await logger.error('List goals error:', err);
    res.status(500).json({ error: 'Failed to list goals' });
  }
});

// POST /api/goals
router.post('/', authenticate, async (req, res) => {
  try {
    const { title, description, type, successCriteria, priority, parentGoalId } = req.body;
    if (!title || !type) {
      return res.status(400).json({ error: 'title and type are required' });
    }
    if (!VALID_TYPES.includes(type)) {
      return res.status(400).json({ error: `type must be one of: ${VALID_TYPES.join(', ')}` });
    }

    const dal = goalsDal;
    const goal = await dal.create({
      title,
      description: description || null,
      ownerId: req.user.id,
      type,
      successCriteria: successCriteria || null,
      priority: priority || 0,
      parentGoalId: parentGoalId || null,
    });
    res.status(201).json(goal);
  } catch (err) {
    await logger.error('Create goal error:', err);
    res.status(500).json({ error: 'Failed to create goal' });
  }
});

// GET /api/goals/:id
router.get('/:id', authenticate, async (req, res) => {
  try {
    const dal = goalsDal;
    const goal = await dal.findById(req.params.id);
    if (!goal) return res.status(404).json({ error: 'Goal not found' });
    // Basic access check
    if (goal.ownerId !== req.user.id) {
      return res.status(403).json({ error: 'Access denied' });
    }
    res.json(goal);
  } catch (err) {
    await logger.error('Get goal error:', err);
    res.status(500).json({ error: 'Failed to get goal' });
  }
});

// PUT /api/goals/:id
router.put('/:id', authenticate, async (req, res) => {
  try {
    const dal = goalsDal;
    const existing = await dal.findById(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Goal not found' });
    if (existing.ownerId !== req.user.id) return res.status(403).json({ error: 'Access denied' });

    const { title, description, type, status, successCriteria, priority, parentGoalId } = req.body;
    const updates = {};
    if (title !== undefined) updates.title = title;
    if (description !== undefined) updates.description = description;
    if (type !== undefined) {
      if (!VALID_TYPES.includes(type)) return res.status(400).json({ error: 'Invalid type' });
      updates.type = type;
    }
    if (status !== undefined) {
      if (!VALID_STATUSES.includes(status)) return res.status(400).json({ error: 'Invalid status' });
      updates.status = status;
    }
    if (successCriteria !== undefined) updates.successCriteria = successCriteria;
    if (priority !== undefined) updates.priority = priority;
    if (parentGoalId !== undefined) updates.parentGoalId = parentGoalId;

    const goal = await dal.update(req.params.id, updates);
    res.json(goal);
  } catch (err) {
    await logger.error('Update goal error:', err);
    res.status(500).json({ error: 'Failed to update goal' });
  }
});

// DELETE /api/goals/:id (soft delete)
router.delete('/:id', authenticate, async (req, res) => {
  try {
    const dal = goalsDal;
    const existing = await dal.findById(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Goal not found' });
    if (existing.ownerId !== req.user.id) return res.status(403).json({ error: 'Access denied' });

    const goal = await dal.softDelete(req.params.id);
    res.json({ success: true, goal });
  } catch (err) {
    await logger.error('Delete goal error:', err);
    res.status(500).json({ error: 'Failed to delete goal' });
  }
});

// POST /api/goals/:id/links
router.post('/:id/links', authenticate, async (req, res) => {
  try {
    const { linkedType, linkedId } = req.body;
    if (!linkedType || !linkedId) {
      return res.status(400).json({ error: 'linkedType and linkedId are required' });
    }
    if (!VALID_LINK_TYPES.includes(linkedType)) {
      return res.status(400).json({ error: `linkedType must be one of: ${VALID_LINK_TYPES.join(', ')}` });
    }

    const dal = goalsDal;
    const link = await dal.addLink(req.params.id, linkedType, linkedId);
    res.status(201).json(link);
  } catch (err) {
    await logger.error('Add link error:', err);
    res.status(500).json({ error: 'Failed to add link' });
  }
});

// DELETE /api/goals/:id/links/:linkId
router.delete('/:id/links/:linkId', authenticate, async (req, res) => {
  try {
    const dal = goalsDal;
    const link = await dal.removeLink(req.params.linkId);
    if (!link) return res.status(404).json({ error: 'Link not found' });
    res.json({ success: true });
  } catch (err) {
    await logger.error('Remove link error:', err);
    res.status(500).json({ error: 'Failed to remove link' });
  }
});

// POST /api/goals/:id/evaluations
router.post('/:id/evaluations', authenticate, async (req, res) => {
  try {
    const { evaluatedBy, score, reasoning, suggestedActions } = req.body;
    if (!evaluatedBy) {
      return res.status(400).json({ error: 'evaluatedBy is required' });
    }
    if (score !== undefined && (score < 0 || score > 100)) {
      return res.status(400).json({ error: 'score must be between 0 and 100' });
    }

    const dal = goalsDal;
    const evaluation = await dal.addEvaluation(req.params.id, {
      evaluatedBy,
      score: score ?? null,
      reasoning: reasoning || null,
      suggestedActions: suggestedActions || null,
    });
    res.status(201).json(evaluation);
  } catch (err) {
    await logger.error('Add evaluation error:', err);
    res.status(500).json({ error: 'Failed to add evaluation' });
  }
});

// GET /api/goals/:id/evaluations
router.get('/:id/evaluations', authenticate, async (req, res) => {
  try {
    const dal = goalsDal;
    const evaluations = await dal.getEvaluations(req.params.id);
    res.json({ evaluations });
  } catch (err) {
    await logger.error('Get evaluations error:', err);
    res.status(500).json({ error: 'Failed to get evaluations' });
  }
});

module.exports = router;
