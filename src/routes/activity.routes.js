const express = require('express');
const router = express.Router();
const activityController = require('../controllers/activity.controller');
const { authenticate } = require('../middleware/auth.middleware');

/**
 * @swagger
 * tags:
 *   name: Activity
 *   description: Activity and logging endpoints
 */

/**
 * @swagger
 * components:
 *   schemas:
 *     Activity:
 *       type: object
 *       properties:
 *         id:
 *           type: string
 *           format: uuid
 *         type:
 *           type: string
 *           enum: [log, comment]
 *         content:
 *           type: string
 *         activity_type:
 *           type: string
 *         created_at:
 *           type: string
 *           format: date-time
 *         user:
 *           type: object
 *           properties:
 *             id:
 *               type: string
 *             name:
 *               type: string
 *             email:
 *               type: string
 *         node:
 *           type: object
 *           properties:
 *             id:
 *               type: string
 *             title:
 *               type: string
 *             node_type:
 *               type: string
 *         plan:
 *           type: object
 *           properties:
 *             id:
 *               type: string
 *             title:
 *               type: string
 */

/**
 * @swagger
 * /activity/feed:
 *   get:
 *     summary: Get activity feed for the current user across all accessible plans
 *     tags: [Activity]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *         description: Page number
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *         description: Items per page (max 100)
 *     responses:
 *       200:
 *         description: User activity feed with pagination
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 activities:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Activity'
 *                 pagination:
 *                   type: object
 *                   properties:
 *                     page:
 *                       type: integer
 *                     limit:
 *                       type: integer
 *                     total:
 *                       type: integer
 *                     pages:
 *                       type: integer
 *       401:
 *         description: Authentication required
 */
router.get('/feed', authenticate, activityController.getUserActivityFeed);

/**
 * @swagger
 * /activity/plan/{id}/activity:
 *   get:
 *     summary: Get all activity logs for a plan
 *     tags: [Activity]
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
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *         description: Page number
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *         description: Items per page (max 100)
 *       - in: query
 *         name: type
 *         schema:
 *           type: string
 *           enum: [progress, reasoning, challenge, decision]
 *         description: Filter by log type
 *     responses:
 *       200:
 *         description: Plan activity logs with pagination
 *       401:
 *         description: Authentication required
 *       403:
 *         description: Access denied
 *       404:
 *         description: Plan not found
 */
router.get('/plan/:id/activity', authenticate, activityController.getPlanActivity);
router.get('/plans/:id/activity', authenticate, activityController.getPlanActivity);

/**
 * @swagger
 * /activity/plan/{id}/timeline:
 *   get:
 *     summary: Get a chronological timeline of significant events for a plan
 *     tags: [Activity]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: The plan ID
 *     responses:
 *       200:
 *         description: Plan timeline
 *       401:
 *         description: Authentication required
 *       403:
 *         description: Access denied
 *       404:
 *         description: Plan not found
 */
router.get('/plan/:id/timeline', authenticate, activityController.getPlanTimeline);
router.get('/plans/:id/timeline', authenticate, activityController.getPlanTimeline);

/**
 * @swagger
 * /activity/plan/{id}/nodes/{nodeId}/activity:
 *   get:
 *     summary: Get recent activity for a specific node
 *     tags: [Activity]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: The plan ID
 *       - in: path
 *         name: nodeId
 *         required: true
 *         schema:
 *           type: string
 *         description: The node ID
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 10
 *         description: Maximum number of activities to return
 *     responses:
 *       200:
 *         description: Node activity
 *       401:
 *         description: Authentication required
 *       403:
 *         description: Access denied
 *       404:
 *         description: Node not found
 */
router.get('/plan/:id/nodes/:nodeId/activity', authenticate, activityController.getNodeActivity);
router.get('/plans/:id/nodes/:nodeId/activity', authenticate, activityController.getNodeActivity);

/**
 * @swagger
 * /activity/plan/{id}/nodes/{nodeId}/detailed-log:
 *   post:
 *     summary: Add a detailed activity log entry with metadata and tags
 *     tags: [Activity]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: The plan ID
 *       - in: path
 *         name: nodeId
 *         required: true
 *         schema:
 *           type: string
 *         description: The node ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - content
 *             properties:
 *               content:
 *                 type: string
 *               log_type:
 *                 type: string
 *                 enum: [progress, reasoning, challenge, decision]
 *                 default: progress
 *               metadata:
 *                 type: object
 *               tags:
 *                 type: array
 *                 items:
 *                   type: string
 *     responses:
 *       201:
 *         description: Log entry added successfully
 *       400:
 *         description: Invalid input
 *       401:
 *         description: Authentication required
 *       403:
 *         description: Access denied
 *       404:
 *         description: Node not found
 */
router.post('/plan/:id/nodes/:nodeId/detailed-log', authenticate, activityController.addDetailedLog);

module.exports = router;