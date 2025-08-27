const express = require('express');
const router = express.Router();
const { collaborationController } = require('../controllers/collaboration.controller');
const { authenticate } = require('../middleware/auth.middleware');

/**
 * @swagger
 * tags:
 *   name: Collaboration
 *   description: Real-time collaboration and presence endpoints
 */

/**
 * @swagger
 * /plans/{id}/active-users:
 *   get:
 *     summary: Get currently active users in a plan
 *     tags: [Collaboration]
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
 *         description: List of active users
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 planId:
 *                   type: string
 *                 activeUsers:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id:
 *                         type: string
 *                       email:
 *                         type: string
 *                       name:
 *                         type: string
 *                       avatar_url:
 *                         type: string
 *                 count:
 *                   type: integer
 *       401:
 *         description: Authentication required
 *       403:
 *         description: Access denied
 *       404:
 *         description: Plan not found
 */
router.get('/:id/active-users', authenticate, collaborationController.getActivePlanUsers);

/**
 * @swagger
 * /plans/{id}/presence:
 *   post:
 *     summary: Update user presence in a plan
 *     tags: [Collaboration]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: The plan ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               status:
 *                 type: string
 *                 enum: [active, idle, away]
 *                 default: active
 *               nodeId:
 *                 type: string
 *                 description: Current node being viewed (optional)
 *     responses:
 *       200:
 *         description: Presence updated successfully
 *       401:
 *         description: Authentication required
 *       403:
 *         description: Access denied
 *       404:
 *         description: Plan not found
 */
router.post('/:id/presence', authenticate, collaborationController.updatePresence);

/**
 * @swagger
 * /plans/{id}/nodes/{nodeId}/active-users:
 *   get:
 *     summary: Get active and typing users for a specific node
 *     tags: [Collaboration]
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
 *     responses:
 *       200:
 *         description: List of active and typing users
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 nodeId:
 *                   type: string
 *                 activeUsers:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id:
 *                         type: string
 *                       email:
 *                         type: string
 *                       name:
 *                         type: string
 *                       avatar_url:
 *                         type: string
 *                 typingUsers:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id:
 *                         type: string
 *                       email:
 *                         type: string
 *                       name:
 *                         type: string
 *                       avatar_url:
 *                         type: string
 *                 counts:
 *                   type: object
 *                   properties:
 *                     active:
 *                       type: integer
 *                     typing:
 *                       type: integer
 *       401:
 *         description: Authentication required
 *       403:
 *         description: Access denied
 *       404:
 *         description: Node not found
 */
router.get('/:id/nodes/:nodeId/active-users', authenticate, collaborationController.getActiveNodeUsers);

module.exports = router;
