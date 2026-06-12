/**
 * v1 — Knowledge (Graphiti-backed). Episode CRUD aliases plus the
 * POST /v1/knowledge/search facade (mirrors the MCP `recall_knowledge`
 * tool): facts + entities + episodes + contradictions in one call.
 */
const express = require('express');
const router = express.Router();
const { authenticate } = require('../../middleware/auth.middleware');
const { searchLimiter } = require('../../middleware/rateLimit.middleware');
const domains = require('../../domains');
const v1Facades = require('../../services/v1Facades');
const { forwardTo, sendFacadeError, e } = require('./forward');

const knowledgeRoutes = domains.knowledge.routes.knowledgeRoutes;

/**
 * @swagger
 * /v1/knowledge/status:
 *   get:
 *     summary: Knowledge graph availability
 *     tags: [v1]
 *     security: [{ bearerAuth: [] }, { apiKey: [] }]
 *     responses:
 *       200: { description: Graphiti status }
 */
router.get('/knowledge/status', forwardTo(knowledgeRoutes, () => '/graphiti/status'));

/**
 * @swagger
 * /v1/knowledge/episodes:
 *   get:
 *     summary: List knowledge episodes (org-scoped)
 *     tags: [v1]
 *     security: [{ bearerAuth: [] }, { apiKey: [] }]
 *     responses:
 *       200: { description: Episode list }
 *   post:
 *     summary: Add a knowledge episode
 *     tags: [v1]
 *     security: [{ bearerAuth: [] }, { apiKey: [] }]
 *     responses:
 *       201: { description: Episode queued for processing }
 */
router.get('/knowledge/episodes', forwardTo(knowledgeRoutes, () => '/episodes'));
router.post('/knowledge/episodes', forwardTo(knowledgeRoutes, () => '/episodes'));

/**
 * @swagger
 * /v1/knowledge/episodes/{id}:
 *   delete:
 *     summary: Delete a knowledge episode
 *     tags: [v1]
 *     security: [{ bearerAuth: [] }, { apiKey: [] }]
 *     responses:
 *       200: { description: Episode deleted }
 */
router.delete('/knowledge/episodes/:id', forwardTo(knowledgeRoutes, (req) => `/episodes/${e(req.params.id)}`));

/**
 * @swagger
 * /v1/knowledge/search:
 *   post:
 *     summary: Universal knowledge query — facts, entities, episodes, contradictions in one call
 *     description: Composed facade mirroring the MCP `recall_knowledge` tool. Degrades to empty results when the knowledge graph is unavailable. Body — query, result_kind (facts|entities|episodes|all), since, entry_type, max_results, include_contradictions.
 *     tags: [v1]
 *     security: [{ bearerAuth: [] }, { apiKey: [] }]
 *     responses:
 *       200: { description: Combined knowledge results }
 */
router.post('/knowledge/search', searchLimiter, authenticate, async (req, res) => {
  try {
    res.json(await v1Facades.knowledgeSearch(req.user, req.body || {}));
  } catch (err) {
    sendFacadeError(res, err);
  }
});

module.exports = router;
