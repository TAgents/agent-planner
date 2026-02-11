const express = require('express');
const router = express.Router();
const nodeController = require('../controllers/node.controller');
const { authenticate } = require('../middleware/auth.middleware');
const { validate, schemas } = require('../validation');

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
 *     description: Returns hierarchical tree of nodes. By default returns minimal fields (id, parent_id, node_type, title, status, order_index) for efficient navigation. Use include_details=true for full node data, or use GET /plans/{id}/nodes/{nodeId}/context for detailed information about specific nodes.
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
 *       - in: query
 *         name: include_details
 *         required: false
 *         schema:
 *           type: boolean
 *           default: false
 *         description: Include full node details (description, context, agent_instructions, metadata, timestamps). Default is false for minimal response size.
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
router.post('/:id/nodes', authenticate, ...validate({ params: schemas.node.planIdParam, body: schemas.node.createNode }), nodeController.createNode);

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
router.put('/:id/nodes/:nodeId', authenticate, ...validate({ params: schemas.node.planNodeParams, body: schemas.node.updateNode }), nodeController.updateNode);

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
router.post('/:id/nodes/:nodeId/move', authenticate, ...validate({ params: schemas.node.planNodeParams, body: schemas.node.moveNode }), nodeController.moveNode);

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
 *               actor_type:
 *                 type: string
 *                 enum: [human, agent]
 *                 description: Whether this action was performed by a human or an AI agent
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
router.post('/:id/nodes/:nodeId/log', authenticate, ...validate({ params: schemas.node.planNodeParams, body: schemas.node.addLog }), nodeController.addLogEntry);

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

/**
 * Assignment Management Endpoints
 */
const assignmentController = require('../controllers/assignment.controller');

/**
 * @swagger
 * /plans/{id}/nodes/{nodeId}/assignments:
 *   get:
 *     summary: Get all user assignments for a node
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
 *         description: List of user assignments
 *       401:
 *         description: Authentication required
 *       403:
 *         description: Access denied
 *       404:
 *         description: Node not found
 */
router.get('/:id/nodes/:nodeId/assignments', authenticate, assignmentController.getNodeAssignments);

/**
 * @swagger
 * /plans/{id}/nodes/{nodeId}/assign:
 *   post:
 *     summary: Assign a user to a node
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
 *               - user_id
 *             properties:
 *               user_id:
 *                 type: string
 *                 description: ID of the user to assign
 *     responses:
 *       201:
 *         description: User assigned successfully
 *       400:
 *         description: Invalid input or user not a collaborator
 *       401:
 *         description: Authentication required
 *       403:
 *         description: Insufficient permissions
 *       404:
 *         description: Node or user not found
 */
router.post('/:id/nodes/:nodeId/assign', authenticate, assignmentController.assignUserToNode);

/**
 * @swagger
 * /plans/{id}/nodes/{nodeId}/unassign:
 *   delete:
 *     summary: Unassign a user from a node
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
 *               - user_id
 *             properties:
 *               user_id:
 *                 type: string
 *                 description: ID of the user to unassign
 *     responses:
 *       204:
 *         description: User unassigned successfully
 *       400:
 *         description: Invalid input
 *       401:
 *         description: Authentication required
 *       403:
 *         description: Insufficient permissions
 *       404:
 *         description: Node or assignment not found
 */
router.delete('/:id/nodes/:nodeId/unassign', authenticate, assignmentController.unassignUserFromNode);

/**
 * @swagger
 * /plans/{id}/available-users:
 *   get:
 *     summary: Get all users available for assignment (plan collaborators)
 *     tags: [Plans]
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
 *         description: List of available users
 *       401:
 *         description: Authentication required
 *       403:
 *         description: Access denied
 *       404:
 *         description: Plan not found
 */
router.get('/:id/available-users', authenticate, assignmentController.getAvailableUsers);

/**
 * Activities Aggregation Endpoint
 */
const activitiesController = require('../controllers/activities.controller');

/**
 * @swagger
 * /plans/{id}/nodes/{nodeId}/activities:
 *   get:
 *     summary: Get all activities for a node (logs, status changes, assignments, files)
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
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 50
 *         description: Maximum number of activities to return
 *       - in: query
 *         name: offset
 *         schema:
 *           type: integer
 *           default: 0
 *         description: Offset for pagination
 *     responses:
 *       200:
 *         description: Aggregated activities for the node
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 nodeId:
 *                   type: string
 *                 nodeTitle:
 *                   type: string
 *                 activities:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id:
 *                         type: string
 *                       type:
 *                         type: string
 *                         enum: [log, comment, assignment, status_change]
 *                       subtype:
 *                         type: string
 *                       content:
 *                         type: string
 *                       timestamp:
 *                         type: string
 *                         format: date-time
 *                       user:
 *                         type: object
 *                         properties:
 *                           id:
 *                             type: string
 *                           email:
 *                             type: string
 *                           name:
 *                             type: string
 *                           avatar_url:
 *                             type: string
 *                       metadata:
 *                         type: object
 *                 total:
 *                   type: integer
 *                 limit:
 *                   type: integer
 *                 offset:
 *                   type: integer
 *       401:
 *         description: Authentication required
 *       403:
 *         description: Access denied
 *       404:
 *         description: Node not found
 */
router.get('/:id/nodes/:nodeId/activities', authenticate, activitiesController.getNodeActivities);

/**
 * Agent Request Endpoints
 */

/**
 * @swagger
 * /plans/{id}/nodes/{nodeId}/request-agent:
 *   post:
 *     summary: Request agent assistance on a task
 *     description: Mark a task as needing agent attention. Agent will pick this up during heartbeat polling.
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
 *               - request_type
 *             properties:
 *               request_type:
 *                 type: string
 *                 enum: [start, review, help, continue]
 *                 description: Type of assistance needed
 *               message:
 *                 type: string
 *                 maxLength: 1000
 *                 description: Optional context for the agent
 *     responses:
 *       200:
 *         description: Agent request created
 *       400:
 *         description: Invalid input
 *       403:
 *         description: Access denied
 *       404:
 *         description: Node not found
 */
router.post('/:id/nodes/:nodeId/request-agent', authenticate, nodeController.requestAgent);

/**
 * @swagger
 * /plans/{id}/nodes/{nodeId}/request-agent:
 *   delete:
 *     summary: Clear agent request on a task
 *     description: Remove the agent assistance request from a task
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
 *         description: Agent request cleared
 *       403:
 *         description: Access denied
 *       404:
 *         description: Node not found
 */
router.delete('/:id/nodes/:nodeId/request-agent', authenticate, nodeController.clearAgentRequest);

/**
 * @swagger
 * /{id}/nodes/{nodeId}/assign-agent:
 *   post:
 *     summary: Assign an agent to a task
 *     tags: [Nodes]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *       - in: path
 *         name: nodeId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               agent_id:
 *                 type: string
 *     responses:
 *       200:
 *         description: Agent assigned
 */
router.post('/:id/nodes/:nodeId/assign-agent', authenticate, nodeController.assignAgent);

/**
 * @swagger
 * /{id}/nodes/{nodeId}/assign-agent:
 *   delete:
 *     summary: Unassign an agent from a task
 *     tags: [Nodes]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       204:
 *         description: Agent unassigned
 */
router.delete('/:id/nodes/:nodeId/assign-agent', authenticate, nodeController.unassignAgent);

/**
 * @swagger
 * /{id}/nodes/{nodeId}/suggested-agents:
 *   get:
 *     summary: Get suggested agents for a task based on capability tags
 *     tags: [Nodes]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: tags
 *         schema:
 *           type: string
 *         description: Comma-separated capability tags to match
 *     responses:
 *       200:
 *         description: List of suggested agents
 */
router.get('/:id/nodes/:nodeId/suggested-agents', authenticate, nodeController.getSuggestedAgents);

module.exports = router;
