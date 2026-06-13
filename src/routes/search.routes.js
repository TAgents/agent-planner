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

// GET /search/plans/:id/nodes/search removed (API v1 consolidation Phase 5 —
// no consumers; global search and /search/plan/:plan_id cover node search).

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