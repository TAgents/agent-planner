import { eq, or, ilike, and, sql } from 'drizzle-orm';
import { db } from '../connection.mjs';
import { planNodes, planComments, planNodeLogs } from '../schema/plans.mjs';

// Tokenized match builder. A row matches when EVERY token (whitespace-split,
// ≥2 chars) appears in at least one of the given columns — AND across tokens,
// OR across columns. Falls back to a whole-string match when the query has no
// usable tokens. Previously search did a single ILIKE on the ENTIRE query
// string, so any multi-word query (exactly what agents pass) matched nothing.
function tokenMatch(query, columns) {
  const tokens = String(query || '').trim().split(/\s+/).filter((t) => t.length >= 2);
  if (tokens.length === 0) {
    const pattern = `%${String(query || '').trim()}%`;
    return or(...columns.map((c) => ilike(c, pattern)));
  }
  return and(...tokens.map((tok) => or(...columns.map((c) => ilike(c, `%${tok}%`)))));
}

export const searchDal = {
  /**
   * Full-text search across a plan's nodes, comments, and logs.
   * Matching is tokenized: all query words must appear (in any searchable field).
   */
  async searchPlan(planId, query) {
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
      tokenMatch(query, [planNodes.title, planNodes.description, planNodes.context]),
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
      tokenMatch(query, [planComments.content]),
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
      tokenMatch(query, [planNodeLogs.content]),
    ));

    return [...nodes, ...comments, ...logs]
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  },
};
