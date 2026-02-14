import { eq, desc, inArray, and, sql } from 'drizzle-orm';
import { db } from '../connection.mjs';
import { planComments } from '../schema/plans.mjs';
import { users } from '../schema/users.mjs';

export const commentsDal = {
  async create(data) {
    const [comment] = await db.insert(planComments).values(data).returning();
    return comment;
  },

  async listByNode(nodeId, { limit = 50, offset = 0 } = {}) {
    return db.select({
      id: planComments.id,
      planNodeId: planComments.planNodeId,
      userId: planComments.userId,
      content: planComments.content,
      commentType: planComments.commentType,
      createdAt: planComments.createdAt,
      updatedAt: planComments.updatedAt,
      userName: users.name,
      userEmail: users.email,
    })
    .from(planComments)
    .leftJoin(users, eq(planComments.userId, users.id))
    .where(eq(planComments.planNodeId, nodeId))
    .orderBy(desc(planComments.createdAt))
    .limit(limit)
    .offset(offset);
  },

  async update(id, data) {
    const [comment] = await db.update(planComments)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(planComments.id, id))
      .returning();
    return comment ?? null;
  },

  async delete(id) {
    const [comment] = await db.delete(planComments).where(eq(planComments.id, id)).returning();
    return comment ?? null;
  },

  async listByNodes(nodeIds, { limit = 50, offset = 0 } = {}) {
    if (nodeIds.length === 0) return [];
    return db.select({
      id: planComments.id,
      planNodeId: planComments.planNodeId,
      userId: planComments.userId,
      content: planComments.content,
      commentType: planComments.commentType,
      createdAt: planComments.createdAt,
      updatedAt: planComments.updatedAt,
      userName: users.name,
      userEmail: users.email,
    })
    .from(planComments)
    .leftJoin(users, eq(planComments.userId, users.id))
    .where(inArray(planComments.planNodeId, nodeIds))
    .orderBy(desc(planComments.createdAt))
    .limit(limit)
    .offset(offset);
  },

  async countByNodes(nodeIds) {
    if (nodeIds.length === 0) return 0;
    const result = await db.select({ count: sql`count(*)::int` })
      .from(planComments)
      .where(inArray(planComments.planNodeId, nodeIds));
    return result[0]?.count ?? 0;
  },
};
