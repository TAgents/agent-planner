/**
 * v1 — Goals. Aliases onto routes/v2/goals.routes.js handlers, plus the
 * composed GET /v1/goals/:id/state facade (mirrors the MCP `goal_state` tool).
 */
const express = require('express');
const router = express.Router();
const { authenticate } = require('../../middleware/auth.middleware');
const domains = require('../../domains');
const goalStateService = require('../../domains/goal/services/goalState.service');
const logger = require('../../utils/logger');
const { forwardTo, e, UUID } = require('./forward');

const goalsRoutes = domains.goal.routes.goalRoutes;
const { requireGoalAccess } = goalsRoutes;

/**
 * @swagger
 * /v1/goals/dashboard:
 *   get:
 *     summary: Goal health dashboard (on_track / at_risk / stale rollup)
 *     tags: [v1]
 *     security: [{ bearerAuth: [] }, { apiKey: [] }]
 *     responses:
 *       200: { description: Goal health rollup }
 */
router.get('/goals/dashboard', forwardTo(goalsRoutes, () => '/dashboard'));

/**
 * @swagger
 * /v1/goals:
 *   get:
 *     summary: List goals
 *     tags: [v1]
 *     security: [{ bearerAuth: [] }, { apiKey: [] }]
 *     responses:
 *       200: { description: Goal list }
 *   post:
 *     summary: Create a goal
 *     tags: [v1]
 *     security: [{ bearerAuth: [] }, { apiKey: [] }]
 *     responses:
 *       201: { description: Goal created }
 */
router.get('/goals', forwardTo(goalsRoutes, () => '/'));
router.post('/goals', forwardTo(goalsRoutes, () => '/'));

/**
 * @swagger
 * /v1/goals/{id}/state:
 *   get:
 *     summary: Comprehensive single-goal read — details, quality, progress, bottlenecks, knowledge gaps
 *     description: Composed facade mirroring the MCP `goal_state` tool. Partial backend failures are surfaced in meta.failures.
 *     tags: [v1]
 *     security: [{ bearerAuth: [] }, { apiKey: [] }]
 *     responses:
 *       200: { description: Composed goal state }
 *       404: { description: Goal not found }
 */
router.get(`/goals/:id${UUID}/state`, authenticate, async (req, res) => {
  try {
    const goal = await requireGoalAccess(req, res);
    if (!goal) return;

    res.json(await goalStateService.getGoalState(goal, req.user));
  } catch (err) {
    await logger.error('v1 goal state error:', err);
    res.status(500).json({ error: 'Failed to get goal state' });
  }
});

/**
 * @swagger
 * /v1/goals/{id}/promote:
 *   post:
 *     summary: Promote a desire goal to an intention (readiness-checked)
 *     tags: [v1]
 *     security: [{ bearerAuth: [] }, { apiKey: [] }]
 *     responses:
 *       200: { description: Promotion result with readiness gaps if not ready }
 */
router.post(`/goals/:id${UUID}/promote`, forwardTo(goalsRoutes, (req) => `/${e(req.params.id)}/promote`));

/**
 * @swagger
 * /v1/goals/{id}:
 *   get:
 *     summary: Get a goal
 *     tags: [v1]
 *     security: [{ bearerAuth: [] }, { apiKey: [] }]
 *     responses:
 *       200: { description: Goal }
 *   patch:
 *     summary: Update a goal
 *     tags: [v1]
 *     security: [{ bearerAuth: [] }, { apiKey: [] }]
 *     responses:
 *       200: { description: Updated goal }
 *   delete:
 *     summary: Delete a goal (soft delete)
 *     tags: [v1]
 *     security: [{ bearerAuth: [] }, { apiKey: [] }]
 *     responses:
 *       200: { description: Goal deleted }
 */
router.get(`/goals/:id${UUID}`, forwardTo(goalsRoutes, (req) => `/${e(req.params.id)}`));
router.patch(`/goals/:id${UUID}`, forwardTo(goalsRoutes, (req) => `/${e(req.params.id)}`, { method: 'PUT' }));
router.delete(`/goals/:id${UUID}`, forwardTo(goalsRoutes, (req) => `/${e(req.params.id)}`));

module.exports = router;
