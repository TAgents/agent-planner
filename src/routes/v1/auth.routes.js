/**
 * v1 — Auth & identity. Aliases onto routes/auth.routes.js handlers.
 */
const express = require('express');
const router = express.Router();
const { authLimiter } = require('../../middleware/rateLimit.middleware');
const authRoutes = require('../auth.routes');
const { forwardTo, e } = require('./forward');

/**
 * @swagger
 * /v1/auth/register:
 *   post:
 *     summary: Register a new user
 *     tags: [v1]
 *     responses:
 *       201: { description: User created with session tokens }
 */
router.post('/auth/register', authLimiter, forwardTo(authRoutes, () => '/register'));

/**
 * @swagger
 * /v1/auth/login:
 *   post:
 *     summary: Log in with email and password
 *     tags: [v1]
 *     responses:
 *       200: { description: Session tokens }
 */
router.post('/auth/login', authLimiter, forwardTo(authRoutes, () => '/login'));

/**
 * @swagger
 * /v1/auth/refresh:
 *   post:
 *     summary: Refresh an access token
 *     tags: [v1]
 *     responses:
 *       200: { description: New session tokens }
 */
router.post('/auth/refresh', authLimiter, forwardTo(authRoutes, () => '/refresh'));

/**
 * @swagger
 * /v1/me:
 *   get:
 *     summary: Get the authenticated user's profile
 *     tags: [v1]
 *     security: [{ bearerAuth: [] }, { apiKey: [] }]
 *     responses:
 *       200: { description: User profile }
 *   patch:
 *     summary: Update the authenticated user's profile
 *     tags: [v1]
 *     security: [{ bearerAuth: [] }, { apiKey: [] }]
 *     responses:
 *       200: { description: Updated profile }
 */
router.get('/me', forwardTo(authRoutes, () => '/profile'));
router.patch('/me', forwardTo(authRoutes, () => '/profile', { method: 'PUT' }));

/**
 * @swagger
 * /v1/me/tokens:
 *   get:
 *     summary: List the authenticated user's API tokens
 *     tags: [v1]
 *     security: [{ bearerAuth: [] }, { apiKey: [] }]
 *     responses:
 *       200: { description: Token list }
 *   post:
 *     summary: Create an API token
 *     tags: [v1]
 *     security: [{ bearerAuth: [] }, { apiKey: [] }]
 *     responses:
 *       201: { description: Token created (value shown once) }
 */
router.get('/me/tokens', forwardTo(authRoutes, () => '/token'));
router.post('/me/tokens', forwardTo(authRoutes, () => '/token'));

/**
 * @swagger
 * /v1/me/tokens/{id}:
 *   delete:
 *     summary: Revoke an API token
 *     tags: [v1]
 *     security: [{ bearerAuth: [] }, { apiKey: [] }]
 *     responses:
 *       200: { description: Token revoked }
 */
router.delete('/me/tokens/:id', forwardTo(authRoutes, (req) => `/token/${e(req.params.id)}`));

module.exports = router;
