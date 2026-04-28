/**
 * Dependency Routes — Node dependency graph edges
 *
 * Mounted at /plans so all routes are nested under plan context.
 * Uses mergeParams to access :id (planId) from parent router.
 */
const express = require('express');
const router = express.Router({ mergeParams: true });
const { authenticate } = require('../middleware/auth.middleware');
const {
  createDependency,
  deleteDependency,
  listPlanDependencies,
  listNodeDependencies,
  getUpstream,
  getDownstream,
  getImpact,
  getCriticalPath,
} = require('../controllers/dependency.controller.v2');

/**
 * @swagger
 * tags:
 *   name: Dependencies
 *   description: Node dependency graph management
 */

/**
 * @swagger
 * /plans/{planId}/dependencies:
 *   get:
 *     summary: List all dependency edges in a plan
 *     tags: [Dependencies]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: planId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: List of dependency edges
 *   post:
 *     summary: Create a dependency edge between two nodes
 *     tags: [Dependencies]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: planId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [source_node_id, target_node_id]
 *             properties:
 *               source_node_id:
 *                 type: string
 *                 format: uuid
 *               target_node_id:
 *                 type: string
 *                 format: uuid
 *               dependency_type:
 *                 type: string
 *                 enum: [blocks, requires, relates_to]
 *                 default: blocks
 *               weight:
 *                 type: integer
 *                 default: 1
 *               metadata:
 *                 type: object
 *     responses:
 *       201:
 *         description: Dependency created
 *       409:
 *         description: Cycle detected or duplicate edge
 */
router.get('/:id/dependencies', authenticate, listPlanDependencies);
router.post('/:id/dependencies', authenticate, createDependency);

/**
 * @swagger
 * /plans/{planId}/dependencies/{depId}:
 *   delete:
 *     summary: Delete a dependency edge
 *     tags: [Dependencies]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: planId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *       - in: path
 *         name: depId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Dependency deleted
 */
router.delete('/:id/dependencies/:depId', authenticate, deleteDependency);

/**
 * @swagger
 * /plans/{planId}/nodes/{nodeId}/dependencies:
 *   get:
 *     summary: List dependencies for a specific node
 *     tags: [Dependencies]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: planId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *       - in: path
 *         name: nodeId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *       - in: query
 *         name: direction
 *         schema:
 *           type: string
 *           enum: [upstream, downstream, both]
 *           default: both
 *     responses:
 *       200:
 *         description: Node dependencies
 */
router.get('/:id/nodes/:nodeId/dependencies', authenticate, listNodeDependencies);

/**
 * @swagger
 * /plans/{planId}/nodes/{nodeId}/upstream:
 *   get:
 *     summary: Get all upstream (blocking) nodes via recursive traversal
 *     tags: [Dependencies]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: planId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *       - in: path
 *         name: nodeId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *       - in: query
 *         name: max_depth
 *         schema:
 *           type: integer
 *           default: 10
 *     responses:
 *       200:
 *         description: Upstream nodes
 */
router.get('/:id/nodes/:nodeId/upstream', authenticate, getUpstream);

/**
 * @swagger
 * /plans/{planId}/nodes/{nodeId}/downstream:
 *   get:
 *     summary: Get all downstream (dependent) nodes via recursive traversal
 *     tags: [Dependencies]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: planId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *       - in: path
 *         name: nodeId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *       - in: query
 *         name: max_depth
 *         schema:
 *           type: integer
 *           default: 10
 *     responses:
 *       200:
 *         description: Downstream nodes
 */
router.get('/:id/nodes/:nodeId/downstream', authenticate, getDownstream);

/**
 * @swagger
 * /plans/{planId}/nodes/{nodeId}/impact:
 *   get:
 *     summary: Analyze impact of a node being delayed, blocked, or removed
 *     tags: [Dependencies]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: planId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *       - in: path
 *         name: nodeId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *       - in: query
 *         name: scenario
 *         schema:
 *           type: string
 *           enum: [delay, block, remove]
 *           default: block
 *     responses:
 *       200:
 *         description: Impact analysis results
 */
router.get('/:id/nodes/:nodeId/impact', authenticate, getImpact);

/**
 * @swagger
 * /plans/{planId}/critical-path:
 *   get:
 *     summary: Find the critical path (longest dependency chain) in a plan
 *     tags: [Dependencies]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: planId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Critical path with ordered nodes and total weight
 */
router.get('/:id/critical-path', authenticate, getCriticalPath);

module.exports = router;
