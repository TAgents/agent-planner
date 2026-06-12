/**
 * v1 — Search & invites.
 */
const express = require('express');
const router = express.Router();
const { searchLimiter } = require('../../middleware/rateLimit.middleware');
const domains = require('../../domains');
const { forwardTo, e } = require('./forward');

const searchRoutes = domains.search.routes.searchRoutes;
const shareRoutes = domains.collaboration.routes.shareRoutes;

/**
 * @swagger
 * /v1/search:
 *   get:
 *     summary: Global text search across plans, nodes, and content
 *     tags: [v1]
 *     security: [{ bearerAuth: [] }, { apiKey: [] }]
 *     parameters:
 *       - in: query
 *         name: q
 *         schema: { type: string }
 *     responses:
 *       200: { description: Search results }
 */
router.get('/search', searchLimiter, forwardTo(searchRoutes, () => '/'));

/**
 * @swagger
 * /v1/invites/accept/{token}:
 *   post:
 *     summary: Accept a plan invite
 *     tags: [v1]
 *     security: [{ bearerAuth: [] }, { apiKey: [] }]
 *     responses:
 *       200: { description: Invite accepted }
 */
router.post('/invites/accept/:token', forwardTo(shareRoutes, (req) => `/accept/${e(req.params.token)}`));

module.exports = router;
