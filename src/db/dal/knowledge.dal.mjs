import { eq, and, desc, ilike, or, sql as dsql } from 'drizzle-orm';
import { db, sql as rawSql } from '../connection.mjs';
import { knowledgeEntries } from '../schema/knowledge.mjs';

export const knowledgeDal = {
  async findById(id) {
    const [entry] = await db.select().from(knowledgeEntries).where(eq(knowledgeEntries.id, id)).limit(1);
    return entry ?? null;
  },

  async create(data) {
    const [entry] = await db.insert(knowledgeEntries).values(data).returning();
    return entry;
  },

  /**
   * Create a knowledge entry and store its embedding via raw SQL
   * (Drizzle doesn't natively support the vector type).
   */
  async createWithEmbedding(data, embedding) {
    const entry = await this.create(data);
    if (embedding) {
      const vecStr = `[${embedding.join(',')}]`;
      await rawSql`UPDATE knowledge_entries SET embedding = ${vecStr}::vector WHERE id = ${entry.id}`;
    }
    return entry;
  },

  async update(id, data) {
    const [entry] = await db.update(knowledgeEntries)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(knowledgeEntries.id, id))
      .returning();
    return entry ?? null;
  },

  /**
   * Update a knowledge entry and re-embed.
   */
  async updateWithEmbedding(id, data, embedding) {
    const entry = await this.update(id, data);
    if (entry && embedding) {
      const vecStr = `[${embedding.join(',')}]`;
      await rawSql`UPDATE knowledge_entries SET embedding = ${vecStr}::vector WHERE id = ${id}`;
    }
    return entry;
  },

  async delete(id) {
    const [entry] = await db.delete(knowledgeEntries).where(eq(knowledgeEntries.id, id)).returning();
    return entry ?? null;
  },

  async listByScope(scope, scopeId, { limit = 50 } = {}) {
    return db.select().from(knowledgeEntries)
      .where(and(eq(knowledgeEntries.scope, scope), eq(knowledgeEntries.scopeId, scopeId)))
      .orderBy(desc(knowledgeEntries.createdAt))
      .limit(limit);
  },

  async listByOwner(ownerId, { limit = 50, offset = 0, entryType, tags } = {}) {
    const conditions = [eq(knowledgeEntries.ownerId, ownerId)];
    if (entryType) conditions.push(eq(knowledgeEntries.entryType, entryType));

    let query = db.select().from(knowledgeEntries)
      .where(and(...conditions))
      .orderBy(desc(knowledgeEntries.createdAt))
      .limit(limit)
      .offset(offset);

    return query;
  },

  /**
   * Text search (trigram + ILIKE fallback).
   */
  async search(query, { ownerId, limit = 20 } = {}) {
    const conditions = [
      or(
        ilike(knowledgeEntries.title, `%${query}%`),
        ilike(knowledgeEntries.content, `%${query}%`),
      ),
    ];
    if (ownerId) conditions.push(eq(knowledgeEntries.ownerId, ownerId));

    return db.select().from(knowledgeEntries)
      .where(and(...conditions))
      .orderBy(desc(knowledgeEntries.createdAt))
      .limit(limit);
  },

  /**
   * Semantic search using pgvector cosine distance.
   * @param {number[]} embedding - Query embedding (1536 dims)
   * @param {object} opts - Filter options
   * @returns {Promise<Array<{id, title, content, tags, scope, entryType, similarity, createdAt}>>}
   */
  async semanticSearch(embedding, { ownerId, scope, scopeId, entryType, source, limit = 20, threshold = 0.0 } = {}) {
    const vecStr = `[${embedding.join(',')}]`;

    // Build WHERE clauses
    const whereParts = [`embedding IS NOT NULL`];
    const params = [];
    let paramIdx = 0;

    // We use raw SQL since Drizzle can't handle vector operators
    let query = `
      SELECT
        id, title, content, tags, scope, scope_id, entry_type, source, metadata,
        created_by, created_at, updated_at, owner_id,
        1 - (embedding <=> '${vecStr}'::vector) AS similarity
      FROM knowledge_entries
      WHERE embedding IS NOT NULL
    `;

    if (ownerId) query += ` AND owner_id = '${ownerId}'`;
    if (scope) query += ` AND scope = '${scope}'`;
    if (scopeId) query += ` AND scope_id = '${scopeId}'`;
    if (entryType) query += ` AND entry_type = '${entryType}'`;
    if (source) query += ` AND source = '${source}'`;
    if (threshold > 0) query += ` AND 1 - (embedding <=> '${vecStr}'::vector) >= ${threshold}`;

    query += ` ORDER BY embedding <=> '${vecStr}'::vector LIMIT ${limit}`;

    const results = await rawSql.unsafe(query);
    return results.map(r => ({
      id: r.id,
      ownerId: r.owner_id,
      title: r.title,
      content: r.content,
      tags: r.tags,
      scope: r.scope,
      scopeId: r.scope_id,
      entryType: r.entry_type,
      source: r.source,
      metadata: r.metadata,
      createdBy: r.created_by,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      similarity: parseFloat(r.similarity),
    }));
  },

  /**
   * Find similar entries to a given entry.
   */
  async findSimilar(entryId, { limit = 10 } = {}) {
    const results = await rawSql.unsafe(`
      SELECT
        b.id, b.title, b.content, b.tags, b.entry_type, b.scope,
        1 - (a.embedding <=> b.embedding) AS similarity
      FROM knowledge_entries a, knowledge_entries b
      WHERE a.id = '${entryId}'
        AND b.id != a.id
        AND a.embedding IS NOT NULL
        AND b.embedding IS NOT NULL
      ORDER BY a.embedding <=> b.embedding
      LIMIT ${limit}
    `);
    return results.map(r => ({
      id: r.id,
      title: r.title,
      content: r.content,
      tags: r.tags,
      entryType: r.entry_type,
      scope: r.scope,
      similarity: parseFloat(r.similarity),
    }));
  },

  /**
   * Get graph data: all entries with their pairwise similarities above threshold.
   */
  async getGraphData({ ownerId, threshold = 0.7, limit = 100 } = {}) {
    let ownerFilter = ownerId ? `AND a.owner_id = '${ownerId}' AND b.owner_id = '${ownerId}'` : '';
    
    const edges = await rawSql.unsafe(`
      SELECT
        a.id AS source_id, a.title AS source_title,
        b.id AS target_id, b.title AS target_title,
        1 - (a.embedding <=> b.embedding) AS similarity
      FROM knowledge_entries a, knowledge_entries b
      WHERE a.id < b.id
        AND a.embedding IS NOT NULL
        AND b.embedding IS NOT NULL
        ${ownerFilter}
        AND 1 - (a.embedding <=> b.embedding) >= ${threshold}
      ORDER BY similarity DESC
      LIMIT ${limit}
    `);

    // Collect unique nodes
    const nodeMap = new Map();
    for (const e of edges) {
      if (!nodeMap.has(e.source_id)) nodeMap.set(e.source_id, { id: e.source_id, title: e.source_title });
      if (!nodeMap.has(e.target_id)) nodeMap.set(e.target_id, { id: e.target_id, title: e.target_title });
    }

    return {
      nodes: Array.from(nodeMap.values()),
      edges: edges.map(e => ({
        source: e.source_id,
        target: e.target_id,
        similarity: parseFloat(e.similarity),
      })),
    };
  },
};
