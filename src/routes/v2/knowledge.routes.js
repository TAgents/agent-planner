/**
 * Knowledge v2 Routes — Phase 4: Knowledge System
 * 
 * CRUD + semantic search + similarity graph for knowledge entries.
 * Embeddings generated via OpenAI text-embedding-3-small.
 * 
 * Route order matters: /search, /graph must come before /:id
 */
const express = require('express');
const router = express.Router();
const { authenticate } = require('../../middleware/auth.middleware');
const logger = require('../../utils/logger');

// DAL (via CJS bridge) — access methods directly via proxy
const knowledgeDal = require('../../db/dal.cjs').knowledgeDal;

async function getEmbeddingService() {
  return require('../../services/embeddings');
}

const VALID_ENTRY_TYPES = ['decision', 'learning', 'context', 'constraint', 'reference', 'note'];
const VALID_SCOPES = ['global', 'plan', 'task'];
const VALID_SOURCES = ['agent', 'human', 'import', 'openclaw'];

// ─── LIST ────────────────────────────────────────────────────────
// GET /api/knowledge
router.get('/', authenticate, async (req, res) => {
  try {
    const dal = knowledgeDal;
    const { limit = 50, offset = 0, entryType, scope, scopeId } = req.query;

    let entries;
    if (scope && scopeId) {
      entries = await dal.listByScope(scope, scopeId, { limit: Number(limit) });
    } else {
      entries = await dal.listByOwner(req.user.id, {
        limit: Number(limit),
        offset: Number(offset),
        entryType,
      });
    }

    res.json({ entries, count: entries.length });
  } catch (err) {
    await logger.error('Knowledge list error:', err);
    res.status(500).json({ error: 'Failed to list knowledge entries' });
  }
});

// ─── SEMANTIC SEARCH ─────────────────────────────────────────────
// POST /api/knowledge/search  (before /:id to avoid param capture)
router.post('/search', authenticate, async (req, res) => {
  try {
    const { query, limit = 20, scope, scopeId, entryType, source, threshold = 0.0 } = req.body;

    if (!query) {
      return res.status(400).json({ error: 'query is required' });
    }

    const dal = knowledgeDal;

    // If OpenAI key available, do semantic search; otherwise fall back to text
    if (process.env.OPENAI_API_KEY) {
      try {
        const embSvc = await getEmbeddingService();
        const queryEmbedding = await embSvc.generateEmbedding(query);
        const results = await dal.semanticSearch(queryEmbedding, {
          ownerId: req.user.id,
          scope,
          scopeId,
          entryType,
          source,
          limit: Number(limit),
          threshold: Number(threshold),
        });
        return res.json({ results, method: 'semantic', count: results.length });
      } catch (embErr) {
        await logger.error('Semantic search failed, falling back to text:', embErr);
      }
    }

    // Fallback: text search
    const results = await dal.search(query, { ownerId: req.user.id, limit: Number(limit) });
    res.json({ results, method: 'text', count: results.length });
  } catch (err) {
    await logger.error('Knowledge search error:', err);
    res.status(500).json({ error: 'Failed to search knowledge' });
  }
});

// ─── SIMILARITY GRAPH ────────────────────────────────────────────
// GET /api/knowledge/graph  (before /:id to avoid param capture)
router.get('/graph', authenticate, async (req, res) => {
  try {
    const dal = knowledgeDal;
    const { threshold = 0.7, limit = 100 } = req.query;
    const graph = await dal.getGraphData({
      ownerId: req.user.id,
      threshold: Number(threshold),
      limit: Number(limit),
    });
    res.json(graph);
  } catch (err) {
    await logger.error('Knowledge graph error:', err);
    res.status(500).json({ error: 'Failed to generate knowledge graph' });
  }
});

// ─── GET ONE ─────────────────────────────────────────────────────
// GET /api/knowledge/:id
router.get('/:id', authenticate, async (req, res) => {
  try {
    const dal = knowledgeDal;
    const entry = await dal.findById(req.params.id);
    if (!entry) return res.status(404).json({ error: 'Knowledge entry not found' });
    if (entry.ownerId !== req.user.id) return res.status(403).json({ error: 'Forbidden' });
    res.json({ entry });
  } catch (err) {
    await logger.error('Knowledge get error:', err);
    res.status(500).json({ error: 'Failed to get knowledge entry' });
  }
});

// ─── CREATE ──────────────────────────────────────────────────────
// POST /api/knowledge
router.post('/', authenticate, async (req, res) => {
  try {
    const { title, content, entryType = 'note', scope = 'global', scopeId, tags = [], source = 'human', metadata = {}, createdBy } = req.body;

    if (!title || !content) {
      return res.status(400).json({ error: 'title and content are required' });
    }
    if (!VALID_ENTRY_TYPES.includes(entryType)) {
      return res.status(400).json({ error: `Invalid entryType. Must be one of: ${VALID_ENTRY_TYPES.join(', ')}` });
    }
    if (!VALID_SCOPES.includes(scope)) {
      return res.status(400).json({ error: `Invalid scope. Must be one of: ${VALID_SCOPES.join(', ')}` });
    }

    const dal = knowledgeDal;

    // Generate embedding if OPENAI_API_KEY is configured
    let embedding = null;
    if (process.env.OPENAI_API_KEY) {
      try {
        const embSvc = await getEmbeddingService();
        const inputText = embSvc.buildEmbeddingInput({ title, content, tags });
        embedding = await embSvc.generateEmbedding(inputText);
      } catch (embErr) {
        await logger.error('Embedding generation failed, saving without vector:', embErr);
      }
    }

    const entry = await dal.createWithEmbedding({
      ownerId: req.user.id,
      title,
      content,
      entryType,
      scope,
      scopeId: scopeId || null,
      tags,
      source,
      metadata,
      createdBy: createdBy || req.user.name || req.user.email,
    }, embedding);

    res.status(201).json({ entry, embedded: !!embedding });
  } catch (err) {
    await logger.error('Knowledge create error:', err);
    res.status(500).json({ error: 'Failed to create knowledge entry' });
  }
});

// ─── UPDATE ──────────────────────────────────────────────────────
// PUT /api/knowledge/:id
router.put('/:id', authenticate, async (req, res) => {
  try {
    const dal = knowledgeDal;
    const existing = await dal.findById(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Knowledge entry not found' });
    if (existing.ownerId !== req.user.id) return res.status(403).json({ error: 'Forbidden' });

    const { title, content, entryType, scope, scopeId, tags, source, metadata } = req.body;
    const updates = {};
    if (title !== undefined) updates.title = title;
    if (content !== undefined) updates.content = content;
    if (entryType !== undefined) {
      if (!VALID_ENTRY_TYPES.includes(entryType)) {
        return res.status(400).json({ error: `Invalid entryType` });
      }
      updates.entryType = entryType;
    }
    if (scope !== undefined) updates.scope = scope;
    if (scopeId !== undefined) updates.scopeId = scopeId;
    if (tags !== undefined) updates.tags = tags;
    if (source !== undefined) updates.source = source;
    if (metadata !== undefined) updates.metadata = metadata;

    // Re-embed if content or title changed
    let embedding = null;
    const contentChanged = title !== undefined || content !== undefined || tags !== undefined;
    if (contentChanged && process.env.OPENAI_API_KEY) {
      try {
        const embSvc = await getEmbeddingService();
        const merged = { title: title || existing.title, content: content || existing.content, tags: tags || existing.tags };
        embedding = await embSvc.generateEmbedding(embSvc.buildEmbeddingInput(merged));
      } catch (embErr) {
        await logger.error('Re-embedding failed:', embErr);
      }
    }

    const entry = await dal.updateWithEmbedding(req.params.id, updates, embedding);
    res.json({ entry, reEmbedded: !!embedding });
  } catch (err) {
    await logger.error('Knowledge update error:', err);
    res.status(500).json({ error: 'Failed to update knowledge entry' });
  }
});

// ─── DELETE ──────────────────────────────────────────────────────
// DELETE /api/knowledge/:id
router.delete('/:id', authenticate, async (req, res) => {
  try {
    const dal = knowledgeDal;
    const existing = await dal.findById(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Knowledge entry not found' });
    if (existing.ownerId !== req.user.id) return res.status(403).json({ error: 'Forbidden' });

    await dal.delete(req.params.id);
    res.json({ deleted: true, id: req.params.id });
  } catch (err) {
    await logger.error('Knowledge delete error:', err);
    res.status(500).json({ error: 'Failed to delete knowledge entry' });
  }
});

// ─── SIMILAR ENTRIES ─────────────────────────────────────────────
// GET /api/knowledge/:id/similar
router.get('/:id/similar', authenticate, async (req, res) => {
  try {
    const dal = knowledgeDal;
    const existing = await dal.findById(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Knowledge entry not found' });
    if (existing.ownerId !== req.user.id) return res.status(403).json({ error: 'Forbidden' });

    const { limit = 10 } = req.query;
    const similar = await dal.findSimilar(req.params.id, { limit: Number(limit) });
    res.json({ similar, count: similar.length });
  } catch (err) {
    await logger.error('Knowledge similar error:', err);
    res.status(500).json({ error: 'Failed to find similar entries' });
  }
});

module.exports = router;
