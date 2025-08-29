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

module.exports = router;
