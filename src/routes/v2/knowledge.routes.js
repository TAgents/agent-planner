/**
 * Knowledge Routes — Temporal Knowledge Graph (Graphiti)
 *
 * All knowledge is stored in the Graphiti temporal knowledge graph.
 * These routes proxy through to the internal Graphiti MCP server.
 * Agents see the same /knowledge/* paths; Graphiti is invisible.
 */
const express = require('express');
const router = express.Router();
const { authenticate } = require('../../middleware/auth.middleware.v2');
const logger = require('../../utils/logger');
const graphitiBridge = require('../../services/graphitiBridge');

// ─── GRAPHITI STATUS ────────────────────────────────────────────
/**
 * @swagger
 * /knowledge/graphiti/status:
 *   get:
 *     summary: Get Graphiti availability status
 *     description: Returns whether the temporal knowledge graph (Graphiti) service is available and connected.
 *     tags: [Knowledge - Temporal Graph]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Graphiti status
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 available:
 *                   type: boolean
 *                   description: Whether Graphiti is available
 *                 version:
 *                   type: string
 *                   description: Graphiti service version
 */
// GET /api/knowledge/graphiti/status
router.get('/graphiti/status', authenticate, async (req, res) => {
  const status = await graphitiBridge.getStatus();
  res.json(status);
});

// ─── GET EPISODES (Temporal Query) ─────────────────────────────
/**
 * @swagger
 * /knowledge/episodes:
 *   get:
 *     summary: Get recent knowledge episodes
 *     description: Retrieves recent temporal knowledge episodes from the Graphiti graph, scoped to the user's organization.
 *     tags: [Knowledge - Temporal Graph]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: max_episodes
 *         schema:
 *           type: integer
 *           default: 20
 *         description: Maximum number of episodes to return
 *     responses:
 *       200:
 *         description: List of knowledge episodes
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 episodes:
 *                   type: array
 *                   items:
 *                     type: object
 *                 group_id:
 *                   type: string
 *                   description: Organization-scoped group identifier
 *       503:
 *         description: Knowledge graph not available
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 */
// GET /api/knowledge/episodes
router.get('/episodes', authenticate, async (req, res) => {
  try {
    if (!graphitiBridge.isAvailable()) {
      return res.status(503).json({ error: 'Knowledge graph not available' });
    }

    const { max_episodes = 20 } = req.query;

    const orgId = req.user.organizationId || req.user.org_id;
    const group_id = graphitiBridge.orgGroupId(orgId);

    const result = await graphitiBridge.getEpisodes({
      group_id,
      max_episodes: Number(max_episodes),
    });

    res.json({ episodes: result, group_id });
  } catch (err) {
    await logger.error('Graphiti get episodes error:', err);
    res.status(500).json({ error: 'Failed to get episodes' });
  }
});

// ─── ADD EPISODE (Graphiti knowledge entry) ─────────────────────
/**
 * @swagger
 * /knowledge/episodes:
 *   post:
 *     summary: Add a knowledge episode
 *     description: Adds a new temporal knowledge episode to the Graphiti graph. The episode is scoped to the user's organization.
 *     tags: [Knowledge - Temporal Graph]
 *     security:
 *       - bearerAuth: []
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
 *                 description: The knowledge content to store
 *               name:
 *                 type: string
 *                 description: Optional name/label for the episode
 *               plan_id:
 *                 type: string
 *                 format: uuid
 *                 description: Optional plan this episode relates to
 *               node_id:
 *                 type: string
 *                 format: uuid
 *                 description: Optional node this episode relates to
 *               metadata:
 *                 type: object
 *                 description: Additional metadata for the episode
 *     responses:
 *       201:
 *         description: Episode created
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 episode:
 *                   type: object
 *                 group_id:
 *                   type: string
 *                   description: Organization-scoped group identifier
 *       400:
 *         description: Missing required field (content)
 *       503:
 *         description: Knowledge graph not available
 */
// POST /api/knowledge/episodes
router.post('/episodes', authenticate, async (req, res) => {
  try {
    if (!graphitiBridge.isAvailable()) {
      return res.status(503).json({ error: 'Knowledge graph not available' });
    }

    const { content, name, plan_id, node_id, metadata = {} } = req.body;
    if (!content) {
      return res.status(400).json({ error: 'content is required' });
    }

    const orgId = req.user.organizationId || req.user.org_id;
    const group_id = graphitiBridge.orgGroupId(orgId);

    const result = await graphitiBridge.addEpisode({
      content,
      group_id,
      name: name || undefined,
      metadata: {
        ...metadata,
        plan_id: plan_id || undefined,
        node_id: node_id || undefined,
        user_id: req.user.id,
        user_name: req.user.name || req.user.email,
      },
    });

    res.status(201).json({ episode: result, group_id });
  } catch (err) {
    await logger.error('Graphiti add episode error:', err);
    res.status(500).json({ error: 'Failed to add knowledge episode' });
  }
});

// ─── DELETE EPISODE ─────────────────────────────────────────────
/**
 * @swagger
 * /knowledge/episodes/{episodeId}:
 *   delete:
 *     summary: Delete a knowledge episode
 *     description: Deletes a temporal knowledge episode from the Graphiti graph by its ID.
 *     tags: [Knowledge - Temporal Graph]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: episodeId
 *         required: true
 *         schema:
 *           type: string
 *         description: The episode ID to delete
 *     responses:
 *       200:
 *         description: Episode deleted
 *       503:
 *         description: Knowledge graph not available
 */
// DELETE /api/knowledge/episodes/:episodeId
router.delete('/episodes/:episodeId', authenticate, async (req, res) => {
  try {
    if (!graphitiBridge.isAvailable()) {
      return res.status(503).json({ error: 'Knowledge graph not available' });
    }

    const result = await graphitiBridge.deleteEpisode(req.params.episodeId);
    res.json({ deleted: true, result });
  } catch (err) {
    await logger.error('Graphiti delete episode error:', err);
    res.status(500).json({ error: 'Failed to delete episode' });
  }
});

// ─── SEARCH KNOWLEDGE (Graphiti) ────────────────────────────────
/**
 * @swagger
 * /knowledge/graph-search:
 *   post:
 *     summary: Search temporal knowledge graph
 *     description: Performs a semantic search across the temporal knowledge graph using Graphiti, returning relevant episodes and facts scoped to the user's organization.
 *     tags: [Knowledge - Temporal Graph]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - query
 *             properties:
 *               query:
 *                 type: string
 *                 description: The search query
 *               max_results:
 *                 type: integer
 *                 default: 10
 *                 description: Maximum number of results to return
 *     responses:
 *       200:
 *         description: Search results from the temporal knowledge graph
 *       400:
 *         description: Missing required field (query)
 *       503:
 *         description: Knowledge graph not available
 */
// POST /api/knowledge/graph-search
router.post('/graph-search', authenticate, async (req, res) => {
  try {
    if (!graphitiBridge.isAvailable()) {
      return res.status(503).json({ error: 'Knowledge graph not available' });
    }

    const { query, max_results = 10 } = req.body;
    if (!query) {
      return res.status(400).json({ error: 'query is required' });
    }

    const orgId = req.user.organizationId || req.user.org_id;
    const group_id = graphitiBridge.orgGroupId(orgId);

    const result = await graphitiBridge.searchMemory({
      query,
      group_id,
      max_results: Number(max_results),
    });

    res.json({ results: result, group_id, method: 'graphiti' });
  } catch (err) {
    await logger.error('Graphiti search error:', err);
    res.status(500).json({ error: 'Failed to search knowledge graph' });
  }
});

// ─── SEARCH ENTITIES (Graphiti) ─────────────────────────────────
/**
 * @swagger
 * /knowledge/entities:
 *   post:
 *     summary: Search entity nodes
 *     description: Searches for entity nodes in the temporal knowledge graph. Entities are extracted concepts, people, systems, or other named items found in episodes.
 *     tags: [Knowledge - Temporal Graph]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - query
 *             properties:
 *               query:
 *                 type: string
 *                 description: The search query for entities
 *               max_results:
 *                 type: integer
 *                 default: 10
 *                 description: Maximum number of results to return
 *     responses:
 *       200:
 *         description: Matching entity nodes
 *       400:
 *         description: Missing required field (query)
 *       503:
 *         description: Knowledge graph not available
 */
// POST /api/knowledge/entities
router.post('/entities', authenticate, async (req, res) => {
  try {
    if (!graphitiBridge.isAvailable()) {
      return res.status(503).json({ error: 'Knowledge graph not available' });
    }

    const { query, max_results = 10 } = req.body;
    if (!query) {
      return res.status(400).json({ error: 'query is required' });
    }

    const orgId = req.user.organizationId || req.user.org_id;
    const group_id = graphitiBridge.orgGroupId(orgId);

    const result = await graphitiBridge.searchEntities({
      query,
      group_id,
      max_results: Number(max_results),
    });

    res.json({ entities: result, group_id });
  } catch (err) {
    await logger.error('Graphiti entities error:', err);
    res.status(500).json({ error: 'Failed to search entities' });
  }
});

// ─── CONTRADICTION DETECTION ─────────────────────────────────────
/**
 * @swagger
 * /knowledge/contradictions:
 *   post:
 *     summary: Detect contradictions in knowledge
 *     description: Analyzes the temporal knowledge graph to detect contradictory or conflicting information related to the given query, scoped to the user's organization.
 *     tags: [Knowledge - Temporal Graph]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - query
 *             properties:
 *               query:
 *                 type: string
 *                 description: The query to check for contradictions
 *               max_results:
 *                 type: integer
 *                 default: 10
 *                 description: Maximum number of results to return
 *     responses:
 *       200:
 *         description: Contradiction detection results
 *       400:
 *         description: Missing required field (query)
 *       503:
 *         description: Knowledge graph not available
 */
// POST /api/knowledge/contradictions
router.post('/contradictions', authenticate, async (req, res) => {
  try {
    if (!graphitiBridge.isAvailable()) {
      return res.status(503).json({ error: 'Knowledge graph not available' });
    }

    const { query, max_results = 10 } = req.body;
    if (!query) {
      return res.status(400).json({ error: 'query is required' });
    }

    const orgId = req.user.organizationId || req.user.org_id;
    const group_id = graphitiBridge.orgGroupId(orgId);

    const result = await graphitiBridge.detectContradictions({
      query,
      group_id,
      max_results: Number(max_results),
    });

    res.json({ ...result, group_id });
  } catch (err) {
    await logger.error('Contradiction detection error:', err);
    res.status(500).json({ error: 'Failed to detect contradictions' });
  }
});

module.exports = router;
