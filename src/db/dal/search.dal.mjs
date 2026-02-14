import { eq, or, ilike, and, sql } from 'drizzle-orm';
import { db } from '../connection.mjs';
import { planNodes, planComments, planNodeLogs } from '../schema/plans.mjs';

export const searchDal = {
  /**
   * Full-text search across a plan's nodes, comments, and logs
   */
  async searchPlan(planId, query) {
    const pattern = `%${query}%`;

    // Search nodes
    const nodes = await db.select({
      id: planNodes.id,
      type: sql`'node'`.as('type'),
      title: planNodes.title,
      content: planNodes.description,
      createdAt: planNodes.createdAt,
    })
    .from(planNodes)
    .where(and(
      eq(planNodes.planId, planId),
      or(
        ilike(planNodes.title, pattern),
        ilike(planNodes.description, pattern),
        ilike(planNodes.context, pattern),
      ),
    ));

    // Search comments
    const comments = await db.select({
      id: planComments.id,
      type: sql`'comment'`.as('type'),
      title: sql`'Comment'`.as('title'),
      content: planComments.content,
      createdAt: planComments.createdAt,
    })
    .from(planComments)
    .innerJoin(planNodes, eq(planComments.planNodeId, planNodes.id))
    .where(and(
      eq(planNodes.planId, planId),
      ilike(planComments.content, pattern),
    ));

    // Search logs
    const logs = await db.select({
      id: planNodeLogs.id,
      type: sql`'log'`.as('type'),
      title: sql`'Log'`.as('title'),
      content: planNodeLogs.content,
      createdAt: planNodeLogs.createdAt,
    })
    .from(planNodeLogs)
    .innerJoin(planNodes, eq(planNodeLogs.planNodeId, planNodes.id))
    .where(and(
      eq(planNodes.planId, planId),
      ilike(planNodeLogs.content, pattern),
    ));

    return [...nodes, ...comments, ...logs]
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  },
};
