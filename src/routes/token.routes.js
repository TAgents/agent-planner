const express = require('express');
const router = express.Router();
const tokenController = require('../controllers/token.controller');
const { authenticate } = require('../middleware/auth.middleware');

/**
 * @swagger
 * tags:
 *   name: API Tokens
 *   description: API token management endpoints
 */

/**
 * @swagger
 * components:
 *   schemas:
 *     Token:
 *       type: object
 *       properties:
 *         id:
 *           type: string
 *           format: uuid
 *         name:
 *           type: string
 *         created_at:
 *           type: string
 *           format: date-time
 *         last_used:
 *           type: string
 *           format: date-time
 *           nullable: true
 *         permissions:
 *           type: array
 *           items:
 *             type: string
 *             enum: [read, write, admin]
 */

/**
 * @swagger
 * /tokens:
 *   get:
 *     summary: List all API tokens for the current user
 *     tags: [API Tokens]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of tokens
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/Token'
 *       401:
 *         description: Authentication required
 */
router.get('/', authenticate, tokenController.getTokens);

/**
 * @swagger
 * /tokens:
 *   post:
 *     summary: Create a new API token
 *     tags: [API Tokens]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - name
 *             properties:
 *               name:
 *                 type: string
 *                 description: A descriptive name for the token
 *               permissions:
 *                 type: array
 *                 items:
 *                   type: string
 *                   enum: [read, write, admin]
 *                 default: [read]
 *     responses:
 *       201:
 *         description: Token created successfully
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/Token'
 *                 - type: object
 *                   properties:
 *                     token:
 *                       type: string
 *                       description: The actual token value (displayed only once)
 *       400:
 *         description: Invalid input
 *       401:
 *         description: Authentication required
 */
router.post('/', authenticate, tokenController.createToken);

/**
 * @swagger
 * /tokens/{id}:
 *   delete:
 *     summary: Revoke an API token
 *     tags: [API Tokens]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: The token ID to revoke
 *     responses:
 *       204:
 *         description: Token revoked successfully
 *       401:
 *         description: Authentication required
 *       404:
 *         description: Token not found
 */
router.delete('/:id', authenticate, tokenController.revokeToken);

module.exports = router;