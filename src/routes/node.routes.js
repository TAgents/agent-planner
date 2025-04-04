const express = require('express');
const router = express.Router();
const nodeController = require('../controllers/node.controller');
const { authenticate } = require('../middleware/auth.middleware');

/**
 * @swagger
 * tags:
 *   name: Nodes
 *   description: Plan node management endpoints
 */

/**
 * @swagger
 * components:
 *   schemas:
 *     Node:
 *       type: object
 *       properties:
 *         id:
 *           type: string
 *           format: uuid
 *         plan_id:
 *           type: string
 *           format: uuid
 *         parent_id:
 *           type: string
 *           format: uuid
 *           nullable: true
 *         node_type:
 *           type: string
 *           enum: [root, phase, task, milestone]
 *         title:
 *           type: string
 *         description:
 *           type: string
 *         status:
 *           type: string
 *           enum: [not_started, in_progress, completed, blocked]
 *         order_index:
 *           type: integer
 *         due_date:
 *           type: string
 *           format: date-time
 *           nullable: true
 *         created_at:
 *           type: string
 *           format: date-time
 *         updated_at:
 *           type: string
 *           format: date-time
 *         context:
 *           type: string
 *         agent_instructions:
 *           type: string
 *           nullable: true
 *         acceptance_criteria:
 *           type: string
 *           nullable: true
 *         metadata:
 *           type: object
 *         children:
 *           type: array
 *           items:
 *             $ref: '#/components/schemas/Node'
 */

/**
 * @swagger
 * /plans/{id}/nodes:
 *   get:
 *     summary: Get all nodes for a plan (tree structure)
 *     tags: [Nodes]
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
 *         description: Hierarchical tree of plan nodes
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/Node'
 *       401:
 *         description: Authentication required
 *       403:
 *         description: Access denied
 *       404:
 *         description: Plan not found
 */
router.get('/:id/nodes', authenticate, nodeController.getNodes);

/**
 * @swagger
 * /plans/{id}/nodes/{nodeId}:
 *   get:
 *     summary: Get a specific node
 *     tags: [Nodes]
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
 *         description: Node details
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Node'
 *       401:
 *         description: Authentication required
 *       403:
 *         description: Access denied
 *       404:
 *         description: Node not found
 */
router.get('/:id/nodes/:nodeId', authenticate, nodeController.getNode);

/**
 * @swagger
 * /plans/{id}/nodes:
 *   post:
 *     summary: Create a new node in a plan
 *     tags: [Nodes]
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
 *             required:
 *               - node_type
 *               - title
 *             properties:
 *               parent_id:
 *                 type: string
 *                 description: Parent node ID (if not provided, will be assigned to the root node)
 *               node_type:
 *                 type: string
 *                 enum: [phase, task, milestone]
 *               title:
 *                 type: string
 *               description:
 *                 type: string
 *               status:
 *                 type: string
 *                 enum: [not_started, in_progress, completed, blocked]
 *               order_index:
 *                 type: integer
 *               due_date:
 *                 type: string
 *                 format: date-time
 *               context:
 *                 type: string
 *               agent_instructions:
 *                 type: string
 *               acceptance_criteria:
 *                 type: string
 *               metadata:
 *                 type: object
 *     responses:
 *       201:
 *         description: Node created successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Node'
 *       400:
 *         description: Invalid input
 *       401:
 *         description: Authentication required
 *       403:
 *         description: Access denied
 *       404:
 *         description: Plan or parent node not found
 */
router.post('/:id/nodes', authenticate, nodeController.createNode);

/**
 * @swagger
 * /plans/{id}/nodes/{nodeId}:
 *   put:
 *     summary: Update a node
 *     tags: [Nodes]
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
 *             properties:
 *               node_type:
 *                 type: string
 *                 enum: [phase, task, milestone]
 *               title:
 *                 type: string
 *               description:
 *                 type: string
 *               status:
 *                 type: string
 *                 enum: [not_started, in_progress, completed, blocked]
 *               order_index:
 *                 type: integer
 *               due_date:
 *                 type: string
 *                 format: date-time
 *               context:
 *                 type: string
 *               agent_instructions:
 *                 type: string
 *               acceptance_criteria:
 *                 type: string
 *               metadata:
 *                 type: object
 *     responses:
 *       200:
 *         description: Node updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Node'
 *       400:
 *         description: Invalid input
 *       401:
 *         description: Authentication required
 *       403:
 *         description: Access denied
 *       404:
 *         description: Node not found
 */
router.put('/:id/nodes/:nodeId', authenticate, nodeController.updateNode);

/**
 * @swagger
 * /plans/{id}/nodes/{nodeId}:
 *   delete:
 *     summary: Delete a node
 *     tags: [Nodes]
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
 *       204:
 *         description: Node deleted successfully
 *       400:
 *         description: Cannot delete root node
 *       401:
 *         description: Authentication required
 *       403:
 *         description: Access denied
 *       404:
 *         description: Node not found
 */
router.delete('/:id/nodes/:nodeId', authenticate, nodeController.deleteNode);

/**
 * @swagger
 * /plans/{id}/nodes/{nodeId}/comments:
 *   post:
 *     summary: Add a comment to a node
 *     tags: [Nodes]
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
 *               comment_type:
 *                 type: string
 *                 enum: [human, agent, system]
 *                 default: human
 *     responses:
 *       201:
 *         description: Comment added successfully
 *       400:
 *         description: Invalid input
 *       401:
 *         description: Authentication required
 *       403:
 *         description: Access denied
 *       404:
 *         description: Node not found
 */
router.post('/:id/nodes/:nodeId/comments', authenticate, nodeController.addComment);

/**
 * @swagger
 * /plans/{id}/nodes/{nodeId}/comments:
 *   get:
 *     summary: Get comments for a node
 *     tags: [Nodes]
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
 *         description: List of comments
 *       401:
 *         description: Authentication required
 *       403:
 *         description: Access denied
 *       404:
 *         description: Node not found
 */
router.get('/:id/nodes/:nodeId/comments', authenticate, nodeController.getComments);

/**
 * @swagger
 * /plans/{id}/nodes/{nodeId}/context:
 *   get:
 *     summary: Get detailed context for a specific node
 *     tags: [Nodes]
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
 *         description: Detailed node context
 *       401:
 *         description: Authentication required
 *       403:
 *         description: Access denied
 *       404:
 *         description: Node not found
 */
router.get('/:id/nodes/:nodeId/context', authenticate, nodeController.getNodeContext);

/**
 * @swagger
 * /plans/{id}/nodes/{nodeId}/ancestry:
 *   get:
 *     summary: Get the path from root to this node with context
 *     tags: [Nodes]
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
 *         description: Node ancestry path
 *       401:
 *         description: Authentication required
 *       403:
 *         description: Access denied
 *       404:
 *         description: Node not found
 */
router.get('/:id/nodes/:nodeId/ancestry', authenticate, nodeController.getNodeAncestry);

/**
 * @swagger
 * /plans/{id}/nodes/{nodeId}/status:
 *   put:
 *     summary: Update the status of a node
 *     tags: [Nodes]
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
 *               - status
 *             properties:
 *               status:
 *                 type: string
 *                 enum: [not_started, in_progress, completed, blocked]
 *     responses:
 *       200:
 *         description: Status updated successfully
 *       400:
 *         description: Invalid input
 *       401:
 *         description: Authentication required
 *       403:
 *         description: Access denied
 *       404:
 *         description: Node not found
 */
router.put('/:id/nodes/:nodeId/status', authenticate, nodeController.updateNodeStatus);

/**
 * @swagger
 * /plans/{id}/nodes/{nodeId}/move:
 *   post:
 *     summary: Move a node to a different parent or position
 *     tags: [Nodes]
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
 *             properties:
 *               parent_id:
 *                 type: string
 *                 description: New parent node ID
 *               order_index:
 *                 type: integer
 *                 description: New position among siblings
 *     responses:
 *       200:
 *         description: Node moved successfully
 *       400:
 *         description: Invalid input or cannot move root node
 *       401:
 *         description: Authentication required
 *       403:
 *         description: Access denied
 *       404:
 *         description: Node or parent not found
 */
router.post('/:id/nodes/:nodeId/move', authenticate, nodeController.moveNode);

/**
 * @swagger
 * /plans/{id}/nodes/{nodeId}/log:
 *   post:
 *     summary: Add a progress log entry (for tracking agent activity)
 *     tags: [Nodes]
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
router.post('/:id/nodes/:nodeId/log', authenticate, nodeController.addLogEntry);

/**
 * @swagger
 * /plans/{id}/nodes/{nodeId}/logs:
 *   get:
 *     summary: Get activity logs for a node
 *     tags: [Nodes]
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
 *         description: List of activity logs
 *       401:
 *         description: Authentication required
 *       403:
 *         description: Access denied
 *       404:
 *         description: Node not found
 */
router.get('/:id/nodes/:nodeId/logs', authenticate, nodeController.getNodeLogs);

module.exports = router;
