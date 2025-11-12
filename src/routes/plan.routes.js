const express = require('express');
const router = express.Router();
const planController = require('../controllers/plan.controller');
const { authenticate } = require('../middleware/auth.middleware');

/**
 * @swagger
 * tags:
 *   name: Plans
 *   description: Plan management endpoints
 */

/**
 * @swagger
 * components:
 *   schemas:
 *     Plan:
 *       type: object
 *       properties:
 *         id:
 *           type: string
 *           format: uuid
 *         title:
 *           type: string
 *         description:
 *           type: string
 *         status:
 *           type: string
 *           enum: [draft, active, completed, archived]
 *         created_at:
 *           type: string
 *           format: date-time
 *         updated_at:
 *           type: string
 *           format: date-time
 *         metadata:
 *           type: object
 */

/**
 * @swagger
 * /plans:
 *   get:
 *     summary: List all plans accessible to the user
 *     tags: [Plans]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: A list of plans
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/Plan'
 *       401:
 *         description: Authentication required
 */
router.get('/', authenticate, planController.listPlans);

/**
 * @swagger
 * /plans:
 *   post:
 *     summary: Create a new plan
 *     tags: [Plans]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - title
 *             properties:
 *               title:
 *                 type: string
 *               description:
 *                 type: string
 *               status:
 *                 type: string
 *                 enum: [draft, active, completed, archived]
 *               metadata:
 *                 type: object
 *     responses:
 *       201:
 *         description: Plan created successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Plan'
 *       400:
 *         description: Invalid input
 *       401:
 *         description: Authentication required
 */
router.post('/', authenticate, planController.createPlan);

/**
 * @swagger
 * /plans/public:
 *   get:
 *     summary: List all public plans (no authentication required)
 *     tags: [Plans]
 *     parameters:
 *       - in: query
 *         name: sort
 *         schema:
 *           type: string
 *           enum: [recent, popular, views]
 *         description: Sort order (recent, popular, or views)
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 50
 *         description: Maximum number of plans to return
 *       - in: query
 *         name: offset
 *         schema:
 *           type: integer
 *           default: 0
 *         description: Offset for pagination
 *     responses:
 *       200:
 *         description: A list of public plans
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 plans:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id:
 *                         type: string
 *                       title:
 *                         type: string
 *                       description:
 *                         type: string
 *                       status:
 *                         type: string
 *                       view_count:
 *                         type: integer
 *                       created_at:
 *                         type: string
 *                       updated_at:
 *                         type: string
 *                       github_repo_owner:
 *                         type: string
 *                       github_repo_name:
 *                         type: string
 *                       owner:
 *                         type: object
 *                         properties:
 *                           name:
 *                             type: string
 *                           email:
 *                             type: string
 *                 total:
 *                   type: integer
 *                 limit:
 *                   type: integer
 *                 offset:
 *                   type: integer
 */
router.get('/public', planController.listPublicPlans);

/**
 * @swagger
 * /plans/{id}:
 *   get:
 *     summary: Get a specific plan with its root node
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
 *         description: Plan details
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/Plan'
 *                 - type: object
 *                   properties:
 *                     root_node:
 *                       type: object
 *                       properties:
 *                         id:
 *                           type: string
 *                         node_type:
 *                           type: string
 *                         title:
 *                           type: string
 *                         description:
 *                           type: string
 *                         status:
 *                           type: string
 *                         context:
 *                           type: string
 *       401:
 *         description: Authentication required
 *       403:
 *         description: Access denied
 *       404:
 *         description: Plan not found
 */
router.get('/:id', authenticate, planController.getPlan);

/**
 * @swagger
 * /plans/{id}:
 *   put:
 *     summary: Update a plan's properties
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
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               title:
 *                 type: string
 *               description:
 *                 type: string
 *               status:
 *                 type: string
 *                 enum: [draft, active, completed, archived]
 *               metadata:
 *                 type: object
 *     responses:
 *       200:
 *         description: Plan updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Plan'
 *       400:
 *         description: Invalid input
 *       401:
 *         description: Authentication required
 *       403:
 *         description: Access denied
 *       404:
 *         description: Plan not found
 */
router.put('/:id', authenticate, planController.updatePlan);

/**
 * @swagger
 * /plans/{id}:
 *   delete:
 *     summary: Delete a plan (or archive it)
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
 *       - in: query
 *         name: archive
 *         schema:
 *           type: boolean
 *         description: If true, archive the plan instead of deleting it
 *     responses:
 *       204:
 *         description: Plan deleted successfully
 *       200:
 *         description: Plan archived successfully (when archive=true)
 *       401:
 *         description: Authentication required
 *       403:
 *         description: Access denied
 *       404:
 *         description: Plan not found
 */
router.delete('/:id', authenticate, planController.deletePlan);

/**
 * @swagger
 * /plans/{id}/collaborators:
 *   get:
 *     summary: List collaborators on a plan
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
 *         description: Collaborators list
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 owner:
 *                   type: object
 *                   properties:
 *                     id:
 *                       type: string
 *                     name:
 *                       type: string
 *                     email:
 *                       type: string
 *                 collaborators:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id:
 *                         type: string
 *                       user:
 *                         type: object
 *                         properties:
 *                           id:
 *                             type: string
 *                           name:
 *                             type: string
 *                           email:
 *                             type: string
 *                       role:
 *                         type: string
 *                       created_at:
 *                         type: string
 *                         format: date-time
 *       401:
 *         description: Authentication required
 *       403:
 *         description: Access denied
 *       404:
 *         description: Plan not found
 */
router.get('/:id/collaborators', authenticate, planController.listCollaborators);

/**
 * @swagger
 * /plans/{id}/collaborators:
 *   post:
 *     summary: Add a collaborator to a plan
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
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *               - role
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *               role:
 *                 type: string
 *                 enum: [viewer, editor, admin]
 *     responses:
 *       201:
 *         description: Collaborator added successfully
 *       200:
 *         description: Collaborator role updated successfully
 *       400:
 *         description: Invalid input
 *       401:
 *         description: Authentication required
 *       403:
 *         description: Access denied
 *       404:
 *         description: User or plan not found
 */
router.post('/:id/collaborators', authenticate, planController.addCollaborator);

/**
 * @swagger
 * /plans/{id}/collaborators/{userId}:
 *   delete:
 *     summary: Remove a collaborator from a plan
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
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
 *         description: The user ID to remove
 *     responses:
 *       204:
 *         description: Collaborator removed successfully
 *       401:
 *         description: Authentication required
 *       403:
 *         description: Access denied
 *       404:
 *         description: Plan or collaborator not found
 */
router.delete('/:id/collaborators/:userId', authenticate, planController.removeCollaborator);

/**
 * @swagger
 * /plans/{id}/context:
 *   get:
 *     summary: Get a compiled context of the entire plan suitable for agents
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
 *         description: Plan context
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 plan:
 *                   $ref: '#/components/schemas/Plan'
 *                 structure:
 *                   type: object
 *                   description: Hierarchical structure of nodes
 *       401:
 *         description: Authentication required
 *       403:
 *         description: Access denied
 *       404:
 *         description: Plan not found
 */
router.get('/:id/context', authenticate, planController.getPlanContext);

/**
 * @swagger
 * /plans/{id}/progress:
 *   get:
 *     summary: Get progress statistics for a plan
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
 *         description: Plan progress statistics
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 progress:
 *                   type: integer
 *                   description: Progress percentage (0-100)
 *                 totalNodes:
 *                   type: integer
 *                   description: Total number of nodes in the plan
 *                 completedNodes:
 *                   type: integer
 *                   description: Number of completed nodes
 *                 inProgress:
 *                   type: integer
 *                   description: Number of nodes in progress
 *                 notStarted:
 *                   type: integer
 *                   description: Number of nodes not started
 *                 blocked:
 *                   type: integer
 *                   description: Number of blocked nodes
 *       401:
 *         description: Authentication required
 *       403:
 *         description: Access denied
 *       404:
 *         description: Plan not found
 *       500:
 *         description: Failed to calculate progress
 */
router.get('/:id/progress', authenticate, planController.getPlanProgress);

/**
 * @swagger
 * /plans/{id}/public:
 *   get:
 *     summary: Get a public plan (no authentication required)
 *     tags: [Plans]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: The plan ID
 *     responses:
 *       200:
 *         description: Public plan details
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 id:
 *                   type: string
 *                 title:
 *                   type: string
 *                 description:
 *                   type: string
 *                 status:
 *                   type: string
 *                 view_count:
 *                   type: integer
 *                 created_at:
 *                   type: string
 *                 updated_at:
 *                   type: string
 *                 github_repo_owner:
 *                   type: string
 *                 github_repo_name:
 *                   type: string
 *                 owner:
 *                   type: object
 *                 root_node:
 *                   type: object
 *                 progress:
 *                   type: integer
 *       403:
 *         description: Plan is not public
 *       404:
 *         description: Plan not found
 */
router.get('/:id/public', planController.getPublicPlan);

/**
 * @swagger
 * /plans/{id}/visibility:
 *   put:
 *     summary: Update plan visibility settings (public/private)
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
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - is_public
 *             properties:
 *               is_public:
 *                 type: boolean
 *                 description: Whether the plan should be publicly accessible
 *               github_repo_owner:
 *                 type: string
 *                 description: GitHub repository owner (optional)
 *               github_repo_name:
 *                 type: string
 *                 description: GitHub repository name (optional)
 *     responses:
 *       200:
 *         description: Visibility updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 id:
 *                   type: string
 *                 is_public:
 *                   type: boolean
 *                 github_repo_owner:
 *                   type: string
 *                 github_repo_name:
 *                   type: string
 *       400:
 *         description: Invalid input
 *       401:
 *         description: Authentication required
 *       403:
 *         description: Access denied (must be owner)
 *       404:
 *         description: Plan not found
 */
router.put('/:id/visibility', authenticate, planController.updatePlanVisibility);

/**
 * @swagger
 * /plans/{id}/view:
 *   post:
 *     summary: Increment view count for a public plan
 *     tags: [Plans]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: The plan ID
 *     responses:
 *       200:
 *         description: View count incremented
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 view_count:
 *                   type: integer
 *       403:
 *         description: Plan is not public
 *       404:
 *         description: Plan not found
 */
router.post('/:id/view', planController.incrementViewCount);

module.exports = router;
