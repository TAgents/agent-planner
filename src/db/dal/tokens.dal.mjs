import { eq, and } from 'drizzle-orm';
import { db } from '../connection.mjs';
import { apiTokens } from '../schema/auth.mjs';

export const tokensDal = {
  async findByHash(tokenHash) {
    const [token] = await db.select().from(apiTokens)
      .where(and(eq(apiTokens.tokenHash, tokenHash), eq(apiTokens.revoked, false)))
      .limit(1);
    return token ?? null;
  },

  async create(data) {
    const [token] = await db.insert(apiTokens).values(data).returning();
    return token;
  },

  async listByUser(userId) {
    return db.select({
      id: apiTokens.id,
      name: apiTokens.name,
      permissions: apiTokens.permissions,
      createdAt: apiTokens.createdAt,
      lastUsed: apiTokens.lastUsed,
      revoked: apiTokens.revoked,
    })
    .from(apiTokens)
    .where(eq(apiTokens.userId, userId));
  },

  async revoke(id) {
    const [token] = await db.update(apiTokens)
      .set({ revoked: true })
      .where(eq(apiTokens.id, id))
      .returning();
    return token ?? null;
  },

  async updateLastUsed(id) {
    await db.update(apiTokens)
      .set({ lastUsed: new Date() })
      .where(eq(apiTokens.id, id));
  },

  async findByUserAndId(userId, id) {
    const [token] = await db.select().from(apiTokens)
      .where(and(eq(apiTokens.id, id), eq(apiTokens.userId, userId)))
      .limit(1);
    return token ?? null;
  },

  async listActiveByUser(userId) {
    return db.select({
      id: apiTokens.id,
      name: apiTokens.name,
      permissions: apiTokens.permissions,
      createdAt: apiTokens.createdAt,
      lastUsed: apiTokens.lastUsed,
    })
    .from(apiTokens)
    .where(and(eq(apiTokens.userId, userId), eq(apiTokens.revoked, false)));
  },
};
