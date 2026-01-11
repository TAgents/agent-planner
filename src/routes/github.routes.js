const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth.middleware');
const githubController = require('../controllers/github.controller');

/**
 * @swagger
 * components:
 *   schemas:
 *     GitHubRepo:
 *       type: object
 *       properties:
 *         id:
 *           type: integer
 *           description: GitHub repository ID
 *         name:
 *           type: string
 *           description: Repository name
 *         full_name:
 *           type: string
 *           description: Full repository name (owner/name)
 *         owner:
 *           type: string
 *           description: Repository owner login
 *         description:
 *           type: string
 *           description: Repository description
 *         html_url:
 *           type: string
 *           description: GitHub URL
 *         private:
 *           type: boolean
 *           description: Whether the repo is private
 *         language:
 *           type: string
 *           description: Primary programming language
 *         stargazers_count:
 *           type: integer
 *           description: Number of stars
 *         forks_count:
 *           type: integer
 *           description: Number of forks
 *         updated_at:
 *           type: string
 *           format: date-time
 *           description: Last updated timestamp
 *         default_branch:
 *           type: string
 *           description: Default branch name
 *     GitHubRepoContent:
 *       type: object
 *       properties:
 *         readme:
 *           type: string
 *           nullable: true
 *           description: README content (markdown)
 *         file_structure:
 *           type: array
 *           items:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *               type:
 *                 type: string
 *                 enum: [file, dir]
 *               path:
 *                 type: string
 *               size:
 *                 type: integer
 *         languages:
 *           type: object
 *           additionalProperties:
 *             type: integer
 *           description: Languages used in the repo with byte counts
 *     GitHubIssue:
 *       type: object
 *       properties:
 *         id:
 *           type: integer
 *         number:
 *           type: integer
 *         title:
 *           type: string
 *         html_url:
 *           type: string
 *         state:
 *           type: string
 *         created_at:
 *           type: string
 *           format: date-time
 *     GitHubConnectionStatus:
 *       type: object
 *       properties:
 *         connected:
 *           type: boolean
 *           description: Whether GitHub is connected
 *         github_username:
 *           type: string
 *           nullable: true
 *         github_avatar_url:
 *           type: string
 *           nullable: true
 */

/**
 * @swagger
 * /github/status:
 *   get:
 *     summary: Check GitHub connection status
 *     description: Check if the current user has GitHub connected
 *     tags: [GitHub]
 *     security:
 *       - bearerAuth: []
 *       - apiKeyAuth: []
 *     responses:
 *       200:
 *         description: Connection status
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/GitHubConnectionStatus'
 *       401:
 *         description: Unauthorized
 */
router.get('/status', authenticate, githubController.checkGitHubConnection);

/**
 * @swagger
 * /github/repos:
 *   get:
 *     summary: List user's GitHub repositories
 *     description: Get all repositories accessible to the authenticated user
 *     tags: [GitHub]
 *     security:
 *       - bearerAuth: []
 *       - apiKeyAuth: []
 *     responses:
 *       200:
 *         description: List of repositories
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 repos:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/GitHubRepo'
 *       400:
 *         description: GitHub not connected
 *       401:
 *         description: Unauthorized
 */
router.get('/repos', authenticate, githubController.listRepos);

/**
 * @swagger
 * /github/repos/{owner}/{name}:
 *   get:
 *     summary: Get repository details
 *     description: Get detailed information about a specific repository
 *     tags: [GitHub]
 *     security:
 *       - bearerAuth: []
 *       - apiKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: owner
 *         required: true
 *         schema:
 *           type: string
 *         description: Repository owner
 *       - in: path
 *         name: name
 *         required: true
 *         schema:
 *           type: string
 *         description: Repository name
 *     responses:
 *       200:
 *         description: Repository details
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/GitHubRepo'
 *       404:
 *         description: Repository not found
 *       401:
 *         description: Unauthorized
 */
router.get('/repos/:owner/:name', authenticate, githubController.getRepo);

/**
 * @swagger
 * /github/repos/{owner}/{name}/content:
 *   get:
 *     summary: Get repository content
 *     description: Get README, file structure, and languages for a repository
 *     tags: [GitHub]
 *     security:
 *       - bearerAuth: []
 *       - apiKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: owner
 *         required: true
 *         schema:
 *           type: string
 *         description: Repository owner
 *       - in: path
 *         name: name
 *         required: true
 *         schema:
 *           type: string
 *         description: Repository name
 *     responses:
 *       200:
 *         description: Repository content
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/GitHubRepoContent'
 *       404:
 *         description: Repository not found
 *       401:
 *         description: Unauthorized
 */
router.get('/repos/:owner/:name/content', authenticate, githubController.getRepoContent);

/**
 * @swagger
 * /github/repos/{owner}/{name}/issues:
 *   post:
 *     summary: Create a GitHub issue
 *     description: Create a new issue in the specified repository
 *     tags: [GitHub]
 *     security:
 *       - bearerAuth: []
 *       - apiKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: owner
 *         required: true
 *         schema:
 *           type: string
 *         description: Repository owner
 *       - in: path
 *         name: name
 *         required: true
 *         schema:
 *           type: string
 *         description: Repository name
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
 *                 description: Issue title
 *               body:
 *                 type: string
 *                 description: Issue body (markdown)
 *               labels:
 *                 type: array
 *                 items:
 *                   type: string
 *                 description: Labels to apply
 *     responses:
 *       201:
 *         description: Issue created
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/GitHubIssue'
 *       400:
 *         description: GitHub not connected or invalid request
 *       403:
 *         description: No permission to create issues
 *       404:
 *         description: Repository not found
 *       401:
 *         description: Unauthorized
 */
router.post('/repos/:owner/:name/issues', authenticate, githubController.createIssue);

/**
 * @swagger
 * /github/repos/{owner}/{name}/issues/bulk:
 *   post:
 *     summary: Bulk create GitHub issues from plan tasks
 *     description: Create multiple GitHub issues from plan tasks
 *     tags: [GitHub]
 *     security:
 *       - bearerAuth: []
 *       - apiKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: owner
 *         required: true
 *         schema:
 *           type: string
 *         description: Repository owner
 *       - in: path
 *         name: name
 *         required: true
 *         schema:
 *           type: string
 *         description: Repository name
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - tasks
 *               - planTitle
 *               - planUrl
 *             properties:
 *               tasks:
 *                 type: array
 *                 items:
 *                   type: object
 *                   required:
 *                     - id
 *                     - title
 *                   properties:
 *                     id:
 *                       type: string
 *                       description: Task ID
 *                     title:
 *                       type: string
 *                       description: Task title (becomes issue title)
 *                     description:
 *                       type: string
 *                       description: Task description
 *                     acceptance_criteria:
 *                       type: string
 *                       description: Acceptance criteria
 *                     context:
 *                       type: string
 *                       description: Additional context
 *                     node_type:
 *                       type: string
 *                       enum: [phase, task, milestone]
 *                     status:
 *                       type: string
 *                       enum: [not_started, in_progress, completed, blocked]
 *               planTitle:
 *                 type: string
 *                 description: Plan title for issue footer
 *               planUrl:
 *                 type: string
 *                 description: URL back to the plan
 *     responses:
 *       201:
 *         description: Issues created
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 created:
 *                   type: integer
 *                   description: Number of issues created
 *                 failed:
 *                   type: integer
 *                   description: Number of failures
 *                 results:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       task_id:
 *                         type: string
 *                       task_title:
 *                         type: string
 *                       issue_number:
 *                         type: integer
 *                       issue_url:
 *                         type: string
 *                       success:
 *                         type: boolean
 *                 errors:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       task_id:
 *                         type: string
 *                       task_title:
 *                         type: string
 *                       error:
 *                         type: string
 *                       success:
 *                         type: boolean
 *       400:
 *         description: GitHub not connected or invalid request
 *       401:
 *         description: Unauthorized
 */
router.post('/repos/:owner/:name/issues/bulk', authenticate, githubController.createIssuesFromTasks);

/**
 * @swagger
 * /github/search:
 *   get:
 *     summary: Search GitHub repositories
 *     description: Search repositories for autocomplete
 *     tags: [GitHub]
 *     security:
 *       - bearerAuth: []
 *       - apiKeyAuth: []
 *     parameters:
 *       - in: query
 *         name: q
 *         required: true
 *         schema:
 *           type: string
 *           minLength: 2
 *         description: Search query (min 2 characters)
 *     responses:
 *       200:
 *         description: Search results
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 repos:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/GitHubRepo'
 *       400:
 *         description: Query too short
 *       401:
 *         description: Unauthorized
 */
router.get('/search', authenticate, githubController.searchRepos);

module.exports = router;
