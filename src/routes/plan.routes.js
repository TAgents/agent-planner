const express = require('express');
const router = express.Router();
const planController = require('../controllers/plan.controller');
const { authenticate } = require('../middleware/auth.middleware');
const { validate, schemas } = require('../validation');

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
router.post('/', authenticate, ...validate({ body: schemas.plan.createPlan }), planController.createPlan);

// Note: AI plan generation endpoint removed - UI now uses A2A protocol to call Planner Agent directly

/**
 * @swagger
 * /plans/public:
 *   get:
 *     summary: List all public plans with pagination and filtering (no authentication required)
 *     tags: [Plans]
 *     parameters:
 *       - in: query
 *         name: sortBy
 *         schema:
 *           type: string
 *           enum: [recent, alphabetical, completion]
 *           default: recent
 *         description: Sort order - recent (by updated_at DESC), alphabetical (by title ASC), or completion (by completion_percentage DESC)
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 12
 *           minimum: 1
 *           maximum: 100
 *         description: Maximum number of plans to return per page
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *           minimum: 1
 *         description: Page number for pagination (1-indexed)
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [active, completed, draft, archived]
 *         description: Filter plans by status
 *       - in: query
 *         name: hasGithubLink
 *         schema:
 *           type: string
 *           enum: [true, false]
 *         description: Filter plans by GitHub repository presence (true = has repo, false = no repo)
 *       - in: query
 *         name: owner
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Filter plans by owner user ID
 *       - in: query
 *         name: updatedAfter
 *         schema:
 *           type: string
 *           format: date-time
 *         description: Filter plans updated after this ISO date string
 *       - in: query
 *         name: updatedBefore
 *         schema:
 *           type: string
 *           format: date-time
 *         description: Filter plans updated before this ISO date string
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *         description: Search keyword to filter plans by title, description, or owner name/username (case-insensitive)
 *     responses:
 *       200:
 *         description: A paginated list of public plans with metadata
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
 *                         format: uuid
 *                         description: Plan ID
 *                       title:
 *                         type: string
 *                         description: Plan title
 *                       description:
 *                         type: string
 *                         description: Plan description
 *                       status:
 *                         type: string
 *                         enum: [draft, active, completed, archived]
 *                         description: Plan status
 *                       view_count:
 *                         type: integer
 *                         description: Number of times the plan has been viewed
 *                       created_at:
 *                         type: string
 *                         format: date-time
 *                         description: Creation timestamp
 *                       updated_at:
 *                         type: string
 *                         format: date-time
 *                         description: Last update timestamp
 *                       github_repo_owner:
 *                         type: string
 *                         nullable: true
 *                         description: GitHub repository owner
 *                       github_repo_name:
 *                         type: string
 *                         nullable: true
 *                         description: GitHub repository name
 *                       owner:
 *                         type: object
 *                         description: Plan owner information
 *                         properties:
 *                           id:
 *                             type: string
 *                             format: uuid
 *                           name:
 *                             type: string
 *                           email:
 *                             type: string
 *                           github_username:
 *                             type: string
 *                             nullable: true
 *                           avatar_url:
 *                             type: string
 *                             nullable: true
 *                       task_count:
 *                         type: integer
 *                         description: Total number of tasks in the plan
 *                       completed_count:
 *                         type: integer
 *                         description: Number of completed tasks
 *                       completion_percentage:
 *                         type: integer
 *                         description: Completion percentage (0-100)
 *                 total:
 *                   type: integer
 *                   description: Total number of public plans
 *                 limit:
 *                   type: integer
 *                   description: Number of plans per page
 *                 page:
 *                   type: integer
 *                   description: Current page number
 *                 total_pages:
 *                   type: integer
 *                   description: Total number of pages
 *       400:
 *         description: Invalid filter or sort parameters
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   example: Invalid sortBy value. Must be one of recent, alphabetical, completion
 *       500:
 *         description: Server error
 */
router.get('/public', planController.listPublicPlans);

/**
 * @swagger
 * /plans/public/{id}:
 *   get:
 *     summary: Get a public plan with full node hierarchy (no authentication required)
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
 *         description: Public plan with full hierarchy
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 plan:
 *                   type: object
 *                   properties:
 *                     id:
 *                       type: string
 *                     title:
 *                       type: string
 *                     description:
 *                       type: string
 *                     status:
 *                       type: string
 *                     view_count:
 *                       type: integer
 *                     created_at:
 *                       type: string
 *                     updated_at:
 *                       type: string
 *                     github_repo_owner:
 *                       type: string
 *                     github_repo_name:
 *                       type: string
 *                     metadata:
 *                       type: object
 *                     progress:
 *                       type: integer
 *                     owner:
 *                       type: object
 *                       properties:
 *                         name:
 *                           type: string
 *                         email:
 *                           type: string
 *                 structure:
 *                   type: object
 *                   description: Hierarchical structure of all plan nodes
 *       404:
 *         description: Plan not found or not public
 */
router.get('/public/:id', planController.getPublicPlanById);

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
router.put('/:id', authenticate, ...validate({ params: schemas.plan.planIdParam, body: schemas.plan.updatePlan }), planController.updatePlan);

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
router.post('/:id/collaborators', authenticate, ...validate({ params: schemas.plan.planIdParam, body: schemas.plan.addCollaborator }), planController.addCollaborator);

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
 *               - visibility
 *             properties:
 *               visibility:
 *                 type: string
 *                 enum: [public, private]
 *                 description: Plan visibility setting
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
 *                 visibility:
 *                   type: string
 *                   enum: [public, private]
 *                 is_public:
 *                   type: boolean
 *                   description: Deprecated - use visibility instead
 *                 github_repo_owner:
 *                   type: string
 *                 github_repo_name:
 *                   type: string
 *       400:
 *         description: Invalid input (invalid visibility value)
 *       401:
 *         description: Authentication required
 *       403:
 *         description: Access denied (must be owner)
 *       404:
 *         description: Plan not found
 */
router.put('/:id/visibility', authenticate, ...validate({ params: schemas.plan.planIdParam, body: schemas.plan.updateVisibility }), planController.updatePlanVisibility);

/**
 * @swagger
 * /plans/{id}/github:
 *   put:
 *     summary: Link GitHub repository to plan
 *     tags: [Plans]
 *     security:
 *       - BearerAuth: []
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
 *               - github_repo_owner
 *               - github_repo_name
 *             properties:
 *               github_repo_owner:
 *                 type: string
 *                 example: facebook
 *                 description: GitHub repository owner (user or organization)
 *               github_repo_name:
 *                 type: string
 *                 example: react
 *                 description: GitHub repository name
 *     responses:
 *       200:
 *         description: Repository linked successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                 plan:
 *                   type: object
 *       400:
 *         description: Invalid repository format or missing required fields
 *       403:
 *         description: Not plan owner
 *       404:
 *         description: Plan not found
 */
router.put('/:id/github', authenticate, planController.linkGitHubRepo);

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
