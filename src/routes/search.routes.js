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
 *                     artifacts:
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
 *                     artifacts:
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

/**
 * @swagger
 * /artifacts/search:
 *   get:
 *     summary: Search for artifacts across all accessible plans
 *     tags: [Search]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: query
 *         schema:
 *           type: string
 *         description: Search term
 *       - in: query
 *         name: content_type
 *         schema:
 *           type: string
 *         description: Filter by content type (comma-separated for multiple values)
 *     responses:
 *       200:
 *         description: Search results for artifacts
 *       401:
 *         description: Authentication required
 */
router.get('/artifacts/search', authenticate, searchController.searchArtifacts);

module.exports = router;