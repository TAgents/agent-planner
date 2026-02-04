/**
 * Knowledge Store Routes
 * 
 * Manage knowledge stores and entries (decisions, context, constraints, learnings).
 * Supports semantic search via pgvector embeddings.
 */

const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth.middleware');
const { supabaseAdmin } = require('../config/supabase');
const logger = require('../utils/logger');
const { generateEmbedding, createSearchableText, isConfigured: isEmbeddingConfigured } = require('../services/embedding');

// Valid entry types
const ENTRY_TYPES = ['decision', 'context', 'constraint', 'learning', 'reference', 'note'];
const SCOPES = ['organization', 'goal', 'plan'];

/**
 * Helper: Check if user can access a knowledge store based on scope
 * @param {boolean} writeAccess - If true, checks for write permission
 */
async function canAccessStore(storeId, userId, writeAccess = false) {
  const { data: store } = await supabaseAdmin
    .from('knowledge_stores')
    .select('scope, scope_id')
    .eq('id', storeId)
    .single();

  if (!store) return false;

  return canAccessScope(store.scope, store.scope_id, userId, writeAccess);
}

/**
 * Helper: Check if user can access a scope (org/goal/plan)
 * @param {string} scope - 'organization', 'goal', or 'plan'
 * @param {string} scopeId - UUID of the scope entity
 * @param {string} userId - User's UUID
 * @param {boolean} writeAccess - If true, checks for write permission (public plans are read-only)
 */
async function canAccessScope(scope, scopeId, userId, writeAccess = false) {
  switch (scope) {
    case 'organization': {
      const { data } = await supabaseAdmin
        .from('organization_members')
        .select('role')
        .eq('organization_id', scopeId)
        .eq('user_id', userId)
        .single();
      return !!data;
    }
    case 'goal': {
      const { data: goal } = await supabaseAdmin
        .from('goals')
        .select('organization_id')
        .eq('id', scopeId)
        .single();
      if (!goal) return false;
      const { data } = await supabaseAdmin
        .from('organization_members')
        .select('role')
        .eq('organization_id', goal.organization_id)
        .eq('user_id', userId)
        .single();
      return !!data;
    }
    case 'plan': {
      const { data: plan } = await supabaseAdmin
        .from('plans')
        .select('owner_id, visibility')
        .eq('id', scopeId)
        .single();
      if (!plan) return false;
      if (plan.owner_id === userId) return true;
      // Public plans are read-only for non-owners/collaborators
      if (plan.visibility === 'public' && !writeAccess) return true;
      const { data: collab } = await supabaseAdmin
        .from('plan_collaborators')
        .select('role')
        .eq('plan_id', scopeId)
        .eq('user_id', userId)
        .single();
      return !!collab;
    }
    default:
      return false;
  }
}

/**
 * Helper: Get or create knowledge store for a scope
 */
async function getOrCreateStore(scope, scopeId, userId) {
  // Check existing
  const { data: existing } = await supabaseAdmin
    .from('knowledge_stores')
    .select('*')
    .eq('scope', scope)
    .eq('scope_id', scopeId)
    .single();

  if (existing) return existing;

  // Create new store
  const { data: store, error } = await supabaseAdmin
    .from('knowledge_stores')
    .insert({
      scope,
      scope_id: scopeId,
      storage_mode: 'database'
    })
    .select()
    .single();

  if (error) {
    await logger.error('Failed to create knowledge store:', error);
    return null;
  }

  // Link store to scope entity
  const linkColumn = 'knowledge_store_id';
  const table = scope === 'organization' ? 'organizations' : scope === 'goal' ? 'goals' : 'plans';
  
  await supabaseAdmin
    .from(table)
    .update({ [linkColumn]: store.id })
    .eq('id', scopeId);

  await logger.api(`Knowledge store created for ${scope} ${scopeId}`);
  return store;
}

/**
 * @swagger
 * /knowledge/stores:
 *   get:
 *     summary: List knowledge stores
 *     description: List knowledge stores the user has access to
 *     tags: [Knowledge]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: scope
 *         schema:
 *           type: string
 *           enum: [organization, goal, plan]
 *       - in: query
 *         name: scope_id
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: List of knowledge stores
 */
router.get('/stores', authenticate, async (req, res) => {
  try {
    const { scope, scope_id } = req.query;
    const userId = req.user.id;

    // If specific scope requested, check access and return
    if (scope && scope_id) {
      if (!SCOPES.includes(scope)) {
        return res.status(400).json({ error: 'Invalid scope' });
      }

      const hasAccess = await canAccessScope(scope, scope_id, userId);
      if (!hasAccess) {
        return res.status(403).json({ error: 'Access denied' });
      }

      const store = await getOrCreateStore(scope, scope_id, userId);
      if (!store) {
        return res.status(500).json({ error: 'Failed to get/create store' });
      }

      // Get entry count
      const { count } = await supabaseAdmin
        .from('knowledge_entries')
        .select('id', { count: 'exact', head: true })
        .eq('store_id', store.id);

      return res.json({
        stores: [{
          ...store,
          entry_count: count || 0
        }]
      });
    }

    // Get all accessible stores
    // First get user's org memberships
    const { data: memberships } = await supabaseAdmin
      .from('organization_members')
      .select('organization_id')
      .eq('user_id', userId);

    const orgIds = memberships?.map(m => m.organization_id) || [];

    // Get goals in those orgs
    const { data: goals } = await supabaseAdmin
      .from('goals')
      .select('id')
      .in('organization_id', orgIds);

    const goalIds = goals?.map(g => g.id) || [];

    // Get plans user owns or collaborates on
    const { data: ownedPlans } = await supabaseAdmin
      .from('plans')
      .select('id')
      .eq('owner_id', userId);

    const { data: collabPlans } = await supabaseAdmin
      .from('plan_collaborators')
      .select('plan_id')
      .eq('user_id', userId);

    const planIds = [
      ...(ownedPlans?.map(p => p.id) || []),
      ...(collabPlans?.map(c => c.plan_id) || [])
    ];

    // Get all stores for these scopes
    const { data: stores, error } = await supabaseAdmin
      .from('knowledge_stores')
      .select('*')
      .or(`and(scope.eq.organization,scope_id.in.(${orgIds.join(',')})),and(scope.eq.goal,scope_id.in.(${goalIds.join(',')})),and(scope.eq.plan,scope_id.in.(${planIds.join(',')}))`);

    if (error && orgIds.length > 0) {
      await logger.error('Failed to fetch knowledge stores:', error);
      return res.status(500).json({ error: 'Failed to fetch stores' });
    }

    // Get entry counts
    const storeIds = stores?.map(s => s.id) || [];
    const counts = {};
    if (storeIds.length > 0) {
      const { data: entryCounts } = await supabaseAdmin
        .from('knowledge_entries')
        .select('store_id')
        .in('store_id', storeIds);

      entryCounts?.forEach(e => {
        counts[e.store_id] = (counts[e.store_id] || 0) + 1;
      });
    }

    return res.json({
      stores: (stores || []).map(s => ({
        ...s,
        entry_count: counts[s.id] || 0
      }))
    });

  } catch (error) {
    await logger.error('List knowledge stores error:', error);
    return res.status(500).json({ error: 'Failed to list stores' });
  }
});

/**
 * @swagger
 * /knowledge/stores/{id}:
 *   get:
 *     summary: Get knowledge store details
 *     tags: [Knowledge]
 *     security:
 *       - bearerAuth: []
 */
router.get('/stores/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const hasAccess = await canAccessStore(id, userId);
    if (!hasAccess) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const { data: store, error } = await supabaseAdmin
      .from('knowledge_stores')
      .select('*')
      .eq('id', id)
      .single();

    if (error || !store) {
      return res.status(404).json({ error: 'Store not found' });
    }

    // Get entry count by type
    const { data: entries } = await supabaseAdmin
      .from('knowledge_entries')
      .select('entry_type')
      .eq('store_id', id);

    const typeCounts = {};
    entries?.forEach(e => {
      typeCounts[e.entry_type] = (typeCounts[e.entry_type] || 0) + 1;
    });

    return res.json({
      ...store,
      entry_count: entries?.length || 0,
      entries_by_type: typeCounts
    });

  } catch (error) {
    await logger.error('Get knowledge store error:', error);
    return res.status(500).json({ error: 'Failed to get store' });
  }
});

/**
 * @swagger
 * /knowledge/entries:
 *   get:
 *     summary: List knowledge entries
 *     tags: [Knowledge]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: store_id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *       - in: query
 *         name: entry_type
 *         schema:
 *           type: string
 *           enum: [decision, context, constraint, learning, reference, note]
 *       - in: query
 *         name: tags
 *         schema:
 *           type: string
 *         description: Comma-separated tags to filter by
 */
router.get('/entries', authenticate, async (req, res) => {
  try {
    const { store_id, entry_type, tags } = req.query;
    // Parse pagination params to integers to avoid string concatenation bugs
    const limit = parseInt(req.query.limit, 10) || 50;
    const offset = parseInt(req.query.offset, 10) || 0;
    const userId = req.user.id;

    if (!store_id) {
      return res.status(400).json({ error: 'store_id is required' });
    }

    const hasAccess = await canAccessStore(store_id, userId);
    if (!hasAccess) {
      return res.status(403).json({ error: 'Access denied' });
    }

    let query = supabaseAdmin
      .from('knowledge_entries')
      .select(`
        *,
        users!knowledge_entries_created_by_fkey (id, name, email)
      `)
      .eq('store_id', store_id)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (entry_type) {
      if (!ENTRY_TYPES.includes(entry_type)) {
        return res.status(400).json({ error: 'Invalid entry_type' });
      }
      query = query.eq('entry_type', entry_type);
    }

    if (tags) {
      const tagArray = tags.split(',').map(t => t.trim());
      query = query.overlaps('tags', tagArray);
    }

    const { data: entries, error, count } = await query;

    if (error) {
      await logger.error('Failed to fetch entries:', error);
      return res.status(500).json({ error: 'Failed to fetch entries' });
    }

    return res.json({
      entries: entries.map(e => ({
        ...e,
        created_by_user: e.users,
        users: undefined,
        embedding: undefined // Don't send embedding vectors to client
      })),
      total: count,
      limit,
      offset
    });

  } catch (error) {
    await logger.error('List entries error:', error);
    return res.status(500).json({ error: 'Failed to list entries' });
  }
});

/**
 * @swagger
 * /knowledge/entries/{id}:
 *   get:
 *     summary: Get knowledge entry
 *     tags: [Knowledge]
 *     security:
 *       - bearerAuth: []
 */
router.get('/entries/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const { data: entry, error } = await supabaseAdmin
      .from('knowledge_entries')
      .select(`
        *,
        users!knowledge_entries_created_by_fkey (id, name, email),
        knowledge_stores (id, scope, scope_id)
      `)
      .eq('id', id)
      .single();

    if (error || !entry) {
      return res.status(404).json({ error: 'Entry not found' });
    }

    const hasAccess = await canAccessStore(entry.store_id, userId);
    if (!hasAccess) {
      return res.status(403).json({ error: 'Access denied' });
    }

    return res.json({
      ...entry,
      created_by_user: entry.users,
      store: entry.knowledge_stores,
      users: undefined,
      knowledge_stores: undefined,
      embedding: undefined
    });

  } catch (error) {
    await logger.error('Get entry error:', error);
    return res.status(500).json({ error: 'Failed to get entry' });
  }
});

/**
 * @swagger
 * /knowledge/entries:
 *   post:
 *     summary: Create knowledge entry
 *     tags: [Knowledge]
 *     security:
 *       - bearerAuth: []
 */
router.post('/entries', authenticate, async (req, res) => {
  try {
    const { store_id, scope, scope_id, entry_type, title, content, source_url, tags, metadata } = req.body;
    const userId = req.user.id;

    // Validate entry_type
    if (!entry_type || !ENTRY_TYPES.includes(entry_type)) {
      return res.status(400).json({ error: `entry_type must be one of: ${ENTRY_TYPES.join(', ')}` });
    }

    if (!title || !content) {
      return res.status(400).json({ error: 'title and content are required' });
    }

    // Get or create store
    let targetStoreId = store_id;
    if (!targetStoreId && scope && scope_id) {
      if (!SCOPES.includes(scope)) {
        return res.status(400).json({ error: 'Invalid scope' });
      }
      const hasAccess = await canAccessScope(scope, scope_id, userId, true); // writeAccess=true
      if (!hasAccess) {
        return res.status(403).json({ error: 'Access denied to scope' });
      }
      const store = await getOrCreateStore(scope, scope_id, userId);
      if (!store) {
        return res.status(500).json({ error: 'Failed to create store' });
      }
      targetStoreId = store.id;
    }

    if (!targetStoreId) {
      return res.status(400).json({ error: 'store_id or (scope + scope_id) required' });
    }

    // Check store access (write)
    const hasAccess = await canAccessStore(targetStoreId, userId, true); // writeAccess=true
    if (!hasAccess) {
      return res.status(403).json({ error: 'Access denied to store' });
    }

    // Generate embedding for semantic search
    let embedding = null;
    if (isEmbeddingConfigured()) {
      const searchableText = createSearchableText({ title, content, tags });
      embedding = await generateEmbedding(searchableText);
      if (embedding) {
        await logger.api('Generated embedding for new entry');
      }
    }

    // Create entry with embedding
    const { data: entry, error } = await supabaseAdmin
      .from('knowledge_entries')
      .insert({
        store_id: targetStoreId,
        entry_type,
        title,
        content,
        source_url: source_url || null,
        tags: tags || [],
        metadata: metadata || {},
        created_by: userId,
        embedding
      })
      .select()
      .single();

    if (error) {
      await logger.error('Failed to create entry:', error);
      return res.status(500).json({ error: 'Failed to create entry' });
    }

    await logger.api(`Knowledge entry created: ${entry.id} in store ${targetStoreId}${embedding ? ' (with embedding)' : ''}`);

    return res.status(201).json({
      ...entry,
      embedding: undefined
    });

  } catch (error) {
    await logger.error('Create entry error:', error);
    return res.status(500).json({ error: 'Failed to create entry' });
  }
});

/**
 * @swagger
 * /knowledge/entries/{id}:
 *   put:
 *     summary: Update knowledge entry
 *     tags: [Knowledge]
 *     security:
 *       - bearerAuth: []
 */
router.put('/entries/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const { entry_type, title, content, source_url, tags, metadata } = req.body;
    const userId = req.user.id;

    // Get entry
    const { data: entry } = await supabaseAdmin
      .from('knowledge_entries')
      .select('store_id, created_by')
      .eq('id', id)
      .single();

    if (!entry) {
      return res.status(404).json({ error: 'Entry not found' });
    }

    // Check if user created entry or has admin access (write)
    const hasAccess = await canAccessStore(entry.store_id, userId, true); // writeAccess=true
    if (!hasAccess) {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Only creator or admin can edit
    if (entry.created_by !== userId) {
      // Check if user is org admin (only applies to org-scoped stores)
      const { data: store } = await supabaseAdmin
        .from('knowledge_stores')
        .select('scope, scope_id')
        .eq('id', entry.store_id)
        .single();

      if (store?.scope === 'organization') {
        const { data: membership } = await supabaseAdmin
          .from('organization_members')
          .select('role')
          .eq('organization_id', store.scope_id)
          .eq('user_id', userId)
          .single();

        if (!membership || !['owner', 'admin'].includes(membership.role)) {
          return res.status(403).json({ error: 'Only entry creator or org admins can edit' });
        }
      } else {
        return res.status(403).json({ error: 'Only entry creator can edit' });
      }
    }

    const updates = { updated_at: new Date().toISOString() };
    let needsNewEmbedding = false;
    
    if (entry_type !== undefined) {
      if (!ENTRY_TYPES.includes(entry_type)) {
        return res.status(400).json({ error: 'Invalid entry_type' });
      }
      updates.entry_type = entry_type;
    }
    if (title !== undefined) {
      updates.title = title;
      needsNewEmbedding = true;
    }
    if (content !== undefined) {
      updates.content = content;
      needsNewEmbedding = true;
    }
    if (source_url !== undefined) updates.source_url = source_url;
    if (tags !== undefined) {
      updates.tags = tags;
      needsNewEmbedding = true;
    }
    if (metadata !== undefined) updates.metadata = metadata;

    // Regenerate embedding if searchable content changed
    if (needsNewEmbedding && isEmbeddingConfigured()) {
      // Get current entry to merge with updates
      const { data: currentEntry } = await supabaseAdmin
        .from('knowledge_entries')
        .select('title, content, tags')
        .eq('id', id)
        .single();
      
      const mergedEntry = {
        title: updates.title ?? currentEntry?.title,
        content: updates.content ?? currentEntry?.content,
        tags: updates.tags ?? currentEntry?.tags,
      };
      
      const searchableText = createSearchableText(mergedEntry);
      const embedding = await generateEmbedding(searchableText);
      if (embedding) {
        updates.embedding = embedding;
        await logger.api(`Regenerated embedding for entry ${id}`);
      } else {
        updates.embedding = null;
      }
    } else if (needsNewEmbedding) {
      updates.embedding = null; // Clear embedding if service not configured
    }

    const { data: updated, error } = await supabaseAdmin
      .from('knowledge_entries')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      await logger.error('Failed to update entry:', error);
      return res.status(500).json({ error: 'Failed to update entry' });
    }

    return res.json({
      ...updated,
      embedding: undefined
    });

  } catch (error) {
    await logger.error('Update entry error:', error);
    return res.status(500).json({ error: 'Failed to update entry' });
  }
});

/**
 * @swagger
 * /knowledge/entries/{id}:
 *   delete:
 *     summary: Delete knowledge entry
 *     tags: [Knowledge]
 *     security:
 *       - bearerAuth: []
 */
router.delete('/entries/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    // Get entry
    const { data: entry } = await supabaseAdmin
      .from('knowledge_entries')
      .select('store_id, created_by')
      .eq('id', id)
      .single();

    if (!entry) {
      return res.status(404).json({ error: 'Entry not found' });
    }

    // Check if user created entry or has admin access
    if (entry.created_by !== userId) {
      const { data: store } = await supabaseAdmin
        .from('knowledge_stores')
        .select('scope, scope_id')
        .eq('id', entry.store_id)
        .single();

      if (store?.scope === 'organization') {
        const { data: membership } = await supabaseAdmin
          .from('organization_members')
          .select('role')
          .eq('organization_id', store.scope_id)
          .eq('user_id', userId)
          .single();

        if (!membership || !['owner', 'admin'].includes(membership.role)) {
          return res.status(403).json({ error: 'Only entry creator or org admins can delete' });
        }
      } else {
        return res.status(403).json({ error: 'Only entry creator can delete' });
      }
    }

    const { error } = await supabaseAdmin
      .from('knowledge_entries')
      .delete()
      .eq('id', id);

    if (error) {
      await logger.error('Failed to delete entry:', error);
      return res.status(500).json({ error: 'Failed to delete entry' });
    }

    await logger.api(`Knowledge entry deleted: ${id}`);

    return res.json({ success: true, message: 'Entry deleted' });

  } catch (error) {
    await logger.error('Delete entry error:', error);
    return res.status(500).json({ error: 'Failed to delete entry' });
  }
});

/**
 * @swagger
 * /knowledge/search:
 *   post:
 *     summary: Semantic search across knowledge entries
 *     description: Search using text query (will be embedded) or provide embedding directly
 *     tags: [Knowledge]
 *     security:
 *       - bearerAuth: []
 */
router.post('/search', authenticate, async (req, res) => {
  try {
    const { query, embedding, store_ids, scope, scope_id, entry_types, threshold = 0.7, limit = 10 } = req.body;
    const userId = req.user.id;

    if (!query && !embedding) {
      return res.status(400).json({ error: 'query or embedding required' });
    }

    // Determine which stores to search
    let targetStoreIds = store_ids || [];

    if (scope && scope_id) {
      const hasAccess = await canAccessScope(scope, scope_id, userId);
      if (!hasAccess) {
        return res.status(403).json({ error: 'Access denied to scope' });
      }

      const { data: store } = await supabaseAdmin
        .from('knowledge_stores')
        .select('id')
        .eq('scope', scope)
        .eq('scope_id', scope_id)
        .single();

      if (store) {
        targetStoreIds = [store.id];
      }
    }

    // Validate store access
    for (const storeId of targetStoreIds) {
      const hasAccess = await canAccessStore(storeId, userId);
      if (!hasAccess) {
        return res.status(403).json({ error: `Access denied to store ${storeId}` });
      }
    }

    if (targetStoreIds.length === 0) {
      return res.json({ results: [], message: 'No stores to search' });
    }

    // Try semantic search if embedding provided or can be generated
    let queryEmbedding = embedding;
    
    if (!queryEmbedding && query && isEmbeddingConfigured()) {
      // Generate embedding from query text
      queryEmbedding = await generateEmbedding(query);
      if (queryEmbedding) {
        await logger.api('Generated query embedding for semantic search');
      }
    }
    
    if (queryEmbedding) {
      // Use embedding for semantic search
      const { data: results, error } = await supabaseAdmin.rpc('search_knowledge', {
        query_embedding: queryEmbedding,
        store_ids: targetStoreIds,
        match_threshold: threshold,
        match_count: limit
      });

      if (error) {
        await logger.error('Semantic search failed:', error);
        // Fall through to text search
      } else {
        return res.json({ results, search_type: 'semantic' });
      }
    }

    // Fall back to text search
    let textQuery = supabaseAdmin
      .from('knowledge_entries')
      .select(`
        id,
        store_id,
        entry_type,
        title,
        content,
        source_url,
        tags,
        created_at
      `)
      .in('store_id', targetStoreIds)
      .or(`title.ilike.%${query}%,content.ilike.%${query}%`)
      .limit(limit);

    if (entry_types && entry_types.length > 0) {
      textQuery = textQuery.in('entry_type', entry_types);
    }

    const { data: results, error } = await textQuery;

    if (error) {
      await logger.error('Text search failed:', error);
      return res.status(500).json({ error: 'Search failed' });
    }

    return res.json({ 
      results, 
      search_type: 'text',
      message: isEmbeddingConfigured() ? 'Text fallback (entries may lack embeddings)' : 'Set OPENAI_API_KEY for semantic search'
    });

  } catch (error) {
    await logger.error('Search error:', error);
    return res.status(500).json({ error: 'Search failed' });
  }
});

/**
 * @swagger
 * /knowledge/entries/{id}/embedding:
 *   put:
 *     summary: Update entry embedding
 *     description: Set the vector embedding for semantic search (typically called by embedding service)
 *     tags: [Knowledge]
 *     security:
 *       - bearerAuth: []
 */
router.put('/entries/:id/embedding', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const { embedding } = req.body;
    const userId = req.user.id;

    if (!embedding || !Array.isArray(embedding) || embedding.length !== 1536) {
      return res.status(400).json({ error: 'embedding must be array of 1536 floats' });
    }

    // Get entry and check access
    const { data: entry } = await supabaseAdmin
      .from('knowledge_entries')
      .select('store_id')
      .eq('id', id)
      .single();

    if (!entry) {
      return res.status(404).json({ error: 'Entry not found' });
    }

    const hasAccess = await canAccessStore(entry.store_id, userId, true); // writeAccess=true
    if (!hasAccess) {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Update embedding
    const { error } = await supabaseAdmin
      .from('knowledge_entries')
      .update({ 
        embedding: `[${embedding.join(',')}]`,
        updated_at: new Date().toISOString()
      })
      .eq('id', id);

    if (error) {
      await logger.error('Failed to update embedding:', error);
      return res.status(500).json({ error: 'Failed to update embedding' });
    }

    return res.json({ success: true, message: 'Embedding updated' });

  } catch (error) {
    await logger.error('Update embedding error:', error);
    return res.status(500).json({ error: 'Failed to update embedding' });
  }
});

module.exports = router;
