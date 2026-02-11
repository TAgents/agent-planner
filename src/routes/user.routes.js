const express = require('express');
const router = express.Router();
const userController = require('../controllers/user.controller');
const { authenticate } = require('../middleware/auth.middleware');

/**
 * @swagger
 * tags:
 *   name: User
 *   description: User profile management
 */

// NOTE: User profile management endpoints have been moved to /auth routes
// to avoid duplication. Use /auth/profile and /auth/change-password instead.

/**
 * @swagger
 * /users:
 *   get:
 *     summary: List all users
 *     tags: [Users]
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
 *           default: 50
 *         description: Items per page
 *     responses:
 *       200:
 *         description: List of users with pagination
 *       401:
 *         description: Authentication required
 *       500:
 *         description: Internal server error
 */
router.get('/', authenticate, userController.listUsers);

/**
 * @swagger
 * /users/search:
 *   get:
 *     summary: Search users by name or email
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: query
 *         required: true
 *         schema:
 *           type: string
 *           minLength: 2
 *         description: Search query (min 2 characters)
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 10
 *         description: Maximum results to return
 *     responses:
 *       200:
 *         description: Search results
 *       400:
 *         description: Invalid query
 *       401:
 *         description: Authentication required
 *       500:
 *         description: Internal server error
 */
router.get('/search', authenticate, userController.searchUsers);

/**
 * @swagger
 * /users/my-tasks:
 *   get:
 *     summary: Get tasks assigned to or requested for the current user/agent
 *     description: |
 *       Returns tasks where:
 *       - User is assigned (via plan_node_assignments)
 *       - Agent assistance was requested (agent_requested is set)
 *       
 *       Use `requested=true` to filter only agent-requested tasks.
 *       Agents should poll this endpoint during heartbeat.
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: requested
 *         schema:
 *           type: boolean
 *         description: Only return tasks with agent_requested set
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [not_started, in_progress, completed, blocked]
 *         description: Filter by task status
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 50
 *     responses:
 *       200:
 *         description: List of tasks
 *       401:
 *         description: Authentication required
 */
router.get('/my-tasks', authenticate, userController.getMyTasks);

/**
 * @swagger
 * /users/capabilities:
 *   get:
 *     summary: Get capability tags for the current user
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Capability tags
 */
router.get('/capabilities', authenticate, userController.getCapabilityTags);

/**
 * @swagger
 * /users/capabilities:
 *   put:
 *     summary: Update capability tags for the current user
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               capability_tags:
 *                 type: array
 *                 items:
 *                   type: string
 *     responses:
 *       200:
 *         description: Updated capability tags
 */
router.put('/capabilities', authenticate, userController.updateCapabilityTags);

/**
 * @swagger
 * /users/capabilities/search:
 *   get:
 *     summary: Search users by capability tags
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: tags
 *         required: true
 *         schema:
 *           type: string
 *         description: Comma-separated capability tags
 *       - in: query
 *         name: match
 *         schema:
 *           type: string
 *           enum: [any, all]
 *           default: any
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *     responses:
 *       200:
 *         description: Users matching capability tags
 */
router.get('/capabilities/search', authenticate, userController.searchByCapabilities);

/**
 * @swagger
 * /users/{userId}/capabilities:
 *   get:
 *     summary: Get capability tags for a specific user
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Capability tags for the user
 */
router.get('/:userId/capabilities', authenticate, userController.getCapabilityTags);

module.exports = router;
