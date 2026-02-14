import { eq, and, desc, ilike, or, sql } from 'drizzle-orm';
import { db } from '../connection.mjs';
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

  async update(id, data) {
    const [entry] = await db.update(knowledgeEntries)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(knowledgeEntries.id, id))
      .returning();
    return entry ?? null;
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

  async listByOwner(ownerId, { limit = 50 } = {}) {
    return db.select().from(knowledgeEntries)
      .where(eq(knowledgeEntries.ownerId, ownerId))
      .orderBy(desc(knowledgeEntries.createdAt))
      .limit(limit);
  },

  /**
   * Text search (trigram + ILIKE). Semantic search via pgvector comes in Phase 4.
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
};
