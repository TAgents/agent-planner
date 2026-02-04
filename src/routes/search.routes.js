const express = require('express');
const router = express.Router();
const searchController = require('../controllers/search.controller');
const { authenticate } = require('../middleware/auth.middleware');

/**
 * @swagger
 * tags:
 *   name: Search
 *   description: Search and filtering endpoints
 */

/**
 * @swagger
 * /search:
 *   get:
 *     summary: Global search across all accessible resources
 *     tags: [Search]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: query
 *         required: true
 *         schema:
 *           type: string
 *         description: Search term (min 3 characters)
 *     responses:
 *       200:
 *         description: Search results across all resources
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 query:
 *                   type: string
 *                 results:
 *                   type: object
 *                   properties:
 *                     plans:
 *                       type: array
 *                       items:
 *                         type: object
 *                     nodes:
 *                       type: array
 *                       items:
 *                         type: object
 *                     comments:
 *                       type: array
 *                       items:
 *                         type: object
 *                     logs:
 *                       type: array
 *                       items:
 *                         type: object
 *                 counts:
 *                   type: object
 *                   properties:
 *                     plans:
 *                       type: integer
 *                     nodes:
 *                       type: integer
 *                     comments:
 *                       type: integer
 *                     logs:
 *                       type: integer
 *                     total:
 *                       type: integer
 *       400:
 *         description: Invalid query
 *       401:
 *         description: Authentication required
 */
router.get('/', authenticate, searchController.globalSearch);

/**
 * @swagger
 * /plans/{id}/nodes/search:
 *   get:
 *     summary: Search for nodes in a specific plan with filtering
 *     tags: [Search]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: The plan ID
 *       - in: query
 *         name: query
 *         schema:
 *           type: string
 *         description: Search term (minimum 3 characters)
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *         description: Filter by status (comma-separated for multiple values)
 *       - in: query
 *         name: node_type
 *         schema:
 *           type: string
 *         description: Filter by node type (comma-separated for multiple values)
 *       - in: query
 *         name: date_from
 *         schema:
 *           type: string
 *           format: date
 *         description: Filter by creation date (from)
 *       - in: query
 *         name: date_to
 *         schema:
 *           type: string
 *           format: date
 *         description: Filter by creation date (to)
 *     responses:
 *       200:
 *         description: Search results for nodes in the plan
 *       401:
 *         description: Authentication required
 *       403:
 *         description: Access denied
 *       404:
 *         description: Plan not found
 */
router.get('/plans/:id/nodes/search', authenticate, searchController.searchNodes);

// Removed: /artifacts/search route (Phase 0 simplification)

/**
 * @swagger
 * /search/plan/{plan_id}:
 *   get:
 *     summary: Search within a plan using the database search function
 *     tags: [Search]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: plan_id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: ID of the plan to search within
 *       - in: query
 *         name: query
 *         required: true
 *         schema:
 *           type: string
 *         description: Search query text (min 2 characters)
 *     responses:
 *       200:
 *         description: Search results within the plan
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 query:
 *                   type: string
 *                   description: The original search query
 *                 results:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id:
 *                         type: string
 *                         format: uuid
 *                       type:
 *                         type: string
 *                         enum: [node, comment, log]
 *                       title:
 *                         type: string
 *                       content:
 *                         type: string
 *                       created_at:
 *                         type: string
 *                         format: date-time
 *                       user_id:
 *                         type: string
 *                         format: uuid
 *                 count:
 *                   type: integer
 *                   description: Total number of results
 *       400:
 *         description: Invalid query
 *       401:
 *         description: Authentication required
 *       403:
 *         description: Access denied
 *       404:
 *         description: Plan not found
 *       500:
 *         description: Server error
 */
router.get('/plan/:plan_id', authenticate, searchController.searchPlan);

module.exports = router;