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
const messageBus = require('../../services/messageBus');
const { checkCoherence } = require('../../services/coherenceEngine');

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

    const group_id = graphitiBridge.getGroupId(req.user);

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
 *                 coherence_warnings:
 *                   type: array
 *                   description: Tasks whose beliefs may be affected by this new knowledge (BDI coherence check)
 *                   items:
 *                     type: object
 *                     properties:
 *                       node_id:
 *                         type: string
 *                         format: uuid
 *                       title:
 *                         type: string
 *                       conflict_type:
 *                         type: string
 *                         enum: [contradiction_detected, stale_beliefs]
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

    const group_id = graphitiBridge.getGroupId(req.user);

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

    const episodeId = result?.uuid || result?.episode_id || null;

    // BDI Phase 2: Synchronous coherence check (plan-scoped, 2s timeout)
    let coherence_warnings = [];
    if (plan_id) {
      try {
        const { issues } = await checkCoherence({
          episodeContent: content,
          episodeId,
          groupId: group_id,
          planId: plan_id,
          options: { maxTasks: 10, timeoutMs: 2000 },
        });
        coherence_warnings = issues.map(i => ({
          node_id: i.node_id,
          title: i.title,
          conflict_type: i.conflict_type,
        }));
      } catch (err) {
        await logger.warn('Sync coherence check failed:', err.message);
      }
    }

    // BDI Phase 2: Async full org-wide coherence check via messageBus
    messageBus.publish('episode.created', {
      episodeId,
      content,
      groupId: group_id,
      planId: plan_id || null,
      nodeId: node_id || null,
      userId: req.user.id,
      organizationId: req.user.organizationId,
    }).catch(err => logger.warn('Failed to publish episode.created:', err.message));

    res.status(201).json({ episode: result, group_id, coherence_warnings });
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

    const { episodeId } = req.params;
    await logger.info('Knowledge episode delete', {
      episodeId,
      userId: req.user.id,
      organizationId: req.user.organizationId,
    });
    const result = await graphitiBridge.deleteEpisode(episodeId);
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

    const group_id = graphitiBridge.getGroupId(req.user);

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

    const group_id = graphitiBridge.getGroupId(req.user);

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

    const group_id = graphitiBridge.getGroupId(req.user);

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

// ─── COVERAGE MAP ─────────────────────────────────────────────
/**
 * @swagger
 * /knowledge/coverage-map:
 *   get:
 *     summary: Get knowledge coverage map
 *     description: Returns knowledge organized by topic (Graphiti entities), with each fact showing which plan tasks it relates to. Also lists tasks with no knowledge backing. Knowledge-centric view of coverage.
 *     tags: [Knowledge]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Knowledge coverage map with topics, facts, and task links
 *       503:
 *         description: Knowledge graph not available
 */
router.get('/coverage-map', authenticate, async (req, res) => {
  try {
    if (!graphitiBridge.isAvailable()) {
      return res.status(503).json({ error: 'Knowledge graph not available' });
    }

    const dal = require('../../db/dal.cjs');
    const groupId = graphitiBridge.getGroupId(req.user);
    const userId = req.user.id;
    const organizationId = req.user.organizationId;

    // 1. Get all active plan tasks first (needed for search query)
    // (moved up so we can build a meaningful search query from task titles)
    const planResult = await dal.plansDal.listForUser(userId, { organizationId });
    const allPlans = [...(planResult.owned || []), ...(planResult.shared || []), ...(planResult.organization || [])];
    const activePlans = allPlans.filter(p => p.status === 'active' || p.status === 'draft');

    const allTasks = [];
    const planTitles = new Map();
    for (const plan of activePlans) {
      planTitles.set(plan.id, plan.title);
      const nodes = await dal.nodesDal.listByPlan(plan.id);
      for (const n of nodes) {
        if (n.nodeType === 'task' || n.nodeType === 'milestone') {
          allTasks.push({ ...n, planTitle: plan.title });
        }
      }
    }

    // 2. Build search query from plan/task titles for Graphiti
    const searchTerms = [
      ...activePlans.map(p => p.title),
      ...allTasks.slice(0, 10).map(t => t.title),
    ].join(' ');

    // 3. Fetch entities and facts from Graphiti
    const [entityResult, factResult] = await Promise.all([
      graphitiBridge.searchEntities({ query: searchTerms, group_id: groupId, max_results: 30 }),
      graphitiBridge.searchMemory({ query: searchTerms, group_id: groupId, max_results: 50 }),
    ]);

    const entities = Array.isArray(entityResult)
      ? entityResult
      : entityResult?.nodes || entityResult?.entities || [];
    const allFacts = Array.isArray(factResult)
      ? factResult
      : factResult?.facts || [];

    // 4. Build topic groups from entities
    const topics = [];
    const linkedTaskIds = new Set();

    // Build entity UUID→name map for fact matching
    const entityUuidMap = new Map();
    for (const e of entities) {
      if (e.uuid) entityUuidMap.set(e.uuid, e.name || '');
    }

    for (const entity of entities) {
      const entityName = entity.name || '';
      const entityUuid = entity.uuid || '';
      const entityType = (entity.labels || []).find(l => l !== 'Entity') || entity.entity_type || '';

      // Find facts related to this entity (match by UUID or by name in fact text)
      const entityFacts = allFacts.filter(f => {
        // Match by source/target UUID
        if (f.source_node_uuid === entityUuid || f.target_node_uuid === entityUuid) return true;
        // Fallback: match entity name in fact text
        if (entityName.length > 3 && (f.fact || '').toLowerCase().includes(entityName.toLowerCase())) return true;
        return false;
      });

      if (entityFacts.length === 0) continue;

      const factsWithTasks = entityFacts.map(f => {
        const factText = f.fact || f.content || '';
        // Find tasks whose title or description overlaps with this fact
        const related = allTasks.filter(t => {
          const taskText = (t.title + ' ' + (t.description || '')).toLowerCase();
          const factWords = factText.toLowerCase().split(/\s+/).filter(w => w.length > 4);
          return factWords.some(w => taskText.includes(w));
        }).slice(0, 3);

        related.forEach(t => linkedTaskIds.add(t.id));

        return {
          fact: factText.length > 150 ? factText.slice(0, 150) + '...' : factText,
          relation: f.name || '',
          linked_tasks: related.map(t => ({
            task_id: t.id,
            task_title: t.title,
            plan_id: t.planId,
            plan_title: t.planTitle,
          })),
        };
      });

      topics.push({
        entity: {
          name: entityName,
          entity_type: entityType,
          summary: (entity.summary || '').slice(0, 200),
        },
        facts: factsWithTasks,
      });
    }

    // 5. Find tasks with no knowledge backing
    const unlinkedTasks = allTasks
      .filter(t => !linkedTaskIds.has(t.id) && t.status !== 'completed')
      .map(t => ({
        task_id: t.id,
        task_title: t.title,
        plan_id: t.planId,
        plan_title: t.planTitle,
        status: t.status,
      }));

    res.json({
      topics,
      unlinked_tasks: unlinkedTasks,
      stats: {
        total_facts: allFacts.length,
        total_entities: entities.length,
        total_tasks: allTasks.length,
        covered_tasks: linkedTaskIds.size,
        uncovered_tasks: unlinkedTasks.length,
        coverage_pct: allTasks.length > 0 ? Math.round((linkedTaskIds.size / allTasks.length) * 100) : 100,
      },
    });
  } catch (err) {
    await logger.error('Coverage map error:', err);
    res.status(500).json({ error: 'Failed to build coverage map' });
  }
});

/**
 * @swagger
 * /knowledge/coverage:
 *   get:
 *     summary: Per-plan + per-task knowledge coverage aggregation (Phase 3)
 *     description: |
 *       Computes coverage from the structured `episode_node_links` table —
 *       exact, not text-match-based like /coverage-map. Returns:
 *
 *         - org_summary: { total_tasks, tasks_with_facts, ratio }
 *         - plans: [{ plan_id, plan_title, total_tasks, tasks_with_facts,
 *                     ratio, stale_tasks: [...], conflict_tasks: [...] }]
 *
 *       A task is "stale" if its most-recent episode link is older than
 *       STALE_DAYS (default 5). A task is "conflict" if it has at least
 *       one link with link_type='contradicts'.
 */
router.get('/coverage', authenticate, async (req, res) => {
  try {
    const dal = require('../../db/dal.cjs');
    const { plansDal, nodesDal, episodeLinksDal } = dal;

    const userId = req.user.id;
    const organizationId = req.user.organizationId;
    const STALE_DAYS = 5;
    const staleCutoff = Date.now() - STALE_DAYS * 24 * 60 * 60 * 1000;

    const planResult = await plansDal.listForUser(userId, { organizationId });
    const allPlans = [
      ...(planResult.owned || []),
      ...(planResult.shared || []),
      ...(planResult.organization || []),
    ];
    const activePlans = allPlans.filter((p) => p.status === 'active' || p.status === 'draft');

    let orgTotalTasks = 0;
    let orgWithFacts = 0;
    const planSummaries = [];

    for (const plan of activePlans) {
      const nodes = await nodesDal.listByPlan(plan.id);
      const tasks = nodes.filter(
        (n) => (n.nodeType === 'task' || n.nodeType === 'milestone') && n.status !== 'completed',
      );
      if (tasks.length === 0) continue;

      const taskIds = tasks.map((t) => t.id);
      const links = await episodeLinksDal.listByNodeIds(taskIds);

      // Group links per node for fast lookups
      const byNode = new Map();
      for (const l of links) {
        const arr = byNode.get(l.nodeId) || [];
        arr.push(l);
        byNode.set(l.nodeId, arr);
      }

      let withFacts = 0;
      const staleTasks = [];
      const conflictTasks = [];

      for (const t of tasks) {
        const taskLinks = byNode.get(t.id) || [];
        if (taskLinks.length === 0) continue;
        withFacts += 1;

        const newest = Math.max(...taskLinks.map((l) => new Date(l.createdAt).getTime()));
        if (newest < staleCutoff) {
          staleTasks.push({ task_id: t.id, task_title: t.title, last_link_at: new Date(newest).toISOString() });
        }
        if (taskLinks.some((l) => l.linkType === 'contradicts')) {
          conflictTasks.push({ task_id: t.id, task_title: t.title });
        }
      }

      orgTotalTasks += tasks.length;
      orgWithFacts += withFacts;

      planSummaries.push({
        plan_id: plan.id,
        plan_title: plan.title,
        total_tasks: tasks.length,
        tasks_with_facts: withFacts,
        ratio: tasks.length > 0 ? withFacts / tasks.length : 0,
        stale_tasks: staleTasks,
        conflict_tasks: conflictTasks,
      });
    }

    res.json({
      org_summary: {
        total_tasks: orgTotalTasks,
        tasks_with_facts: orgWithFacts,
        ratio: orgTotalTasks > 0 ? orgWithFacts / orgTotalTasks : 0,
        stale_days_threshold: STALE_DAYS,
      },
      plans: planSummaries.sort((a, b) => a.ratio - b.ratio),
      computed_at: new Date().toISOString(),
    });
  } catch (err) {
    await logger.error('Coverage error:', err);
    res.status(500).json({ error: 'Failed to compute coverage' });
  }
});

module.exports = router;
