import { eq, desc, and, inArray, sql, ilike } from 'drizzle-orm';
import { db } from '../connection.mjs';
import { planNodeLogs } from '../schema/plans.mjs';
import { users } from '../schema/users.mjs';

export const logsDal = {
  async create(data) {
    const [log] = await db.insert(planNodeLogs).values(data).returning();
    return log;
  },

  async listByNode(nodeId, { limit = 50, offset = 0, logType } = {}) {
    const conditions = [eq(planNodeLogs.planNodeId, nodeId)];
    if (logType) conditions.push(eq(planNodeLogs.logType, logType));

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
    .where(and(...conditions))
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

  async listByNodes(nodeIds, { limit = 50, offset = 0, logType } = {}) {
    if (nodeIds.length === 0) return [];
    const conditions = [inArray(planNodeLogs.planNodeId, nodeIds)];
    if (logType) conditions.push(eq(planNodeLogs.logType, logType));

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
    .where(and(...conditions))
    .orderBy(desc(planNodeLogs.createdAt))
    .limit(limit)
    .offset(offset);
  },

  async countByNodes(nodeIds) {
    if (nodeIds.length === 0) return 0;
    const result = await db.select({ count: sql`count(*)::int` })
      .from(planNodeLogs)
      .where(inArray(planNodeLogs.planNodeId, nodeIds));
    return result[0]?.count ?? 0;
  },

  async listStatusChanges(nodeId, { limit = 10 } = {}) {
    return db.select()
      .from(planNodeLogs)
      .where(and(
        eq(planNodeLogs.planNodeId, nodeId),
        eq(planNodeLogs.logType, 'progress'),
        ilike(planNodeLogs.content, 'Updated status%')
      ))
      .orderBy(desc(planNodeLogs.createdAt))
      .limit(limit);
  },
};
