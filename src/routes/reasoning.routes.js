/**
 * Reasoning Routes — Dependency analysis, bottlenecks, RPI chains, scheduling
 */
const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth.middleware.v2');
const { plansDal } = require('../db/dal.cjs');
const {
  propagateStatus,
  detectBottlenecks,
  detectRpiChains,
  topologicalSort,
  detectDecompositionCandidates,
} = require('../services/reasoning');

const checkAccess = async (planId, userId) => {
  const { hasAccess } = await plansDal.userHasAccess(planId, userId);
  return hasAccess;
};

/**
 * @swagger
 * /api/plans/{id}/bottlenecks:
 *   get:
 *     summary: Detect bottleneck nodes
 *     description: >
 *       Analyzes the dependency graph of a plan and identifies bottleneck nodes
 *       with high fan-out that may slow down progress.
 *     tags: [Reasoning]
 *     security:
 *       - bearerAuth: []
 *       - apiKey: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: The plan ID
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 5
 *         description: Maximum number of bottleneck nodes to return
 *       - in: query
 *         name: incomplete_only
 *         schema:
 *           type: boolean
 *           default: true
 *         description: If true, only consider incomplete nodes as bottlenecks
 *     responses:
 *       200:
 *         description: List of detected bottleneck nodes
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 bottlenecks:
 *                   type: array
 *                   items:
 *                     type: object
 *                 count:
 *                   type: integer
 *       403:
 *         description: No access to this plan
 *       500:
 *         description: Internal server error
 */
router.get('/:id/bottlenecks', authenticate, async (req, res, next) => {
  try {
    const { id: planId } = req.params;
    const { limit = '5', incomplete_only = 'true' } = req.query;

    if (!(await checkAccess(planId, req.user.id))) {
      return res.status(403).json({ error: 'No access to this plan' });
    }

    const bottlenecks = await detectBottlenecks(planId, {
      limit: Number(limit),
      incomplete_only: incomplete_only !== 'false',
    });

    res.json({ bottlenecks, count: bottlenecks.length });
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /api/plans/{id}/rpi-chains:
 *   get:
 *     summary: Detect RPI chains
 *     description: >
 *       Identifies Research → Plan → Implement chains within the plan
 *       and reports their current status.
 *     tags: [Reasoning]
 *     security:
 *       - bearerAuth: []
 *       - apiKey: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: The plan ID
 *     responses:
 *       200:
 *         description: List of detected RPI chains
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 chains:
 *                   type: array
 *                   items:
 *                     type: object
 *                 count:
 *                   type: integer
 *       403:
 *         description: No access to this plan
 *       500:
 *         description: Internal server error
 */
router.get('/:id/rpi-chains', authenticate, async (req, res, next) => {
  try {
    const { id: planId } = req.params;

    if (!(await checkAccess(planId, req.user.id))) {
      return res.status(403).json({ error: 'No access to this plan' });
    }

    const chains = await detectRpiChains(planId);
    res.json({ chains, count: chains.length });
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /api/plans/{id}/schedule:
 *   get:
 *     summary: Get topological execution schedule
 *     description: >
 *       Returns tasks in topological (dependency-respecting) execution order,
 *       grouped into parallelizable layers.
 *     tags: [Reasoning]
 *     security:
 *       - bearerAuth: []
 *       - apiKey: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: The plan ID
 *     responses:
 *       200:
 *         description: Topologically sorted schedule with layer grouping
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 schedule:
 *                   type: array
 *                   items:
 *                     type: object
 *                 layers:
 *                   type: object
 *                   additionalProperties:
 *                     type: array
 *                     items:
 *                       type: object
 *                 total:
 *                   type: integer
 *       403:
 *         description: No access to this plan
 *       500:
 *         description: Internal server error
 */
router.get('/:id/schedule', authenticate, async (req, res, next) => {
  try {
    const { id: planId } = req.params;

    if (!(await checkAccess(planId, req.user.id))) {
      return res.status(403).json({ error: 'No access to this plan' });
    }

    const schedule = await topologicalSort(planId);
    const layers = {};
    for (const task of schedule) {
      layers[task.layer] = layers[task.layer] || [];
      layers[task.layer].push(task);
    }

    res.json({ schedule, layers, total: schedule.length });
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /api/plans/{id}/decomposition-alerts:
 *   get:
 *     summary: Detect decomposition candidates
 *     description: >
 *       Flags tasks that may be too large or complex and should be
 *       decomposed into smaller subtasks.
 *     tags: [Reasoning]
 *     security:
 *       - bearerAuth: []
 *       - apiKey: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: The plan ID
 *     responses:
 *       200:
 *         description: List of tasks that may need decomposition
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 alerts:
 *                   type: array
 *                   items:
 *                     type: object
 *                 count:
 *                   type: integer
 *       403:
 *         description: No access to this plan
 *       500:
 *         description: Internal server error
 */
router.get('/:id/decomposition-alerts', authenticate, async (req, res, next) => {
  try {
    const { id: planId } = req.params;

    if (!(await checkAccess(planId, req.user.id))) {
      return res.status(403).json({ error: 'No access to this plan' });
    }

    const alerts = await detectDecompositionCandidates(planId);
    res.json({ alerts, count: alerts.length });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
