import { eq, desc, and, inArray } from 'drizzle-orm';
import { db } from '../connection.mjs';
import { planNodeLogs } from '../schema/plans.mjs';
import { users } from '../schema/users.mjs';

export const logsDal = {
  async create(data) {
    const [log] = await db.insert(planNodeLogs).values(data).returning();
    return log;
  },

  async listByNode(nodeId, { limit = 50, offset = 0 } = {}) {
    return db.select({
      id: planNodeLogs.id,
      planNodeId: planNodeLogs.planNodeId,
      userId: planNodeLogs.userId,
      content: planNodeLogs.content,
      logType: planNodeLogs.logType,
      metadata: planNodeLogs.metadata,
      tags: planNodeLogs.tags,
      createdAt: planNodeLogs.createdAt,
      userName: users.name,
      userEmail: users.email,
    })
    .from(planNodeLogs)
    .leftJoin(users, eq(planNodeLogs.userId, users.id))
    .where(eq(planNodeLogs.planNodeId, nodeId))
    .orderBy(desc(planNodeLogs.createdAt))
    .limit(limit)
    .offset(offset);
  },

  async listByUser(userId, { limit = 50 } = {}) {
    return db.select().from(planNodeLogs)
      .where(eq(planNodeLogs.userId, userId))
      .orderBy(desc(planNodeLogs.createdAt))
      .limit(limit);
  },

  async delete(id) {
    const [log] = await db.delete(planNodeLogs).where(eq(planNodeLogs.id, id)).returning();
    return log ?? null;
  },
};
