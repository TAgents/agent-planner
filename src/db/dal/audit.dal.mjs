import { eq, and, desc, gte, lte, sql } from 'drizzle-orm';
import { db } from '../connection.mjs';
import { auditLogs } from '../schema/audit.mjs';

export const auditDal = {
  async log(action, resourceType, resourceId, { userId, details } = {}) {
    const [entry] = await db.insert(auditLogs)
      .values({ userId, action, resourceType, resourceId, details })
      .returning();
    return entry;
  },

  async listByResource(resourceType, resourceId, { limit = 50 } = {}) {
    return db.select().from(auditLogs)
      .where(and(eq(auditLogs.resourceType, resourceType), eq(auditLogs.resourceId, resourceId)))
      .orderBy(desc(auditLogs.createdAt))
      .limit(limit);
  },

  async listByUser(userId, { limit = 50 } = {}) {
    return db.select().from(auditLogs)
      .where(eq(auditLogs.userId, userId))
      .orderBy(desc(auditLogs.createdAt))
      .limit(limit);
  },

  /**
   * Most recent audit-log entries system-wide, with optional filters +
   * pagination. Backs the admin activity feed (superadmin oversight only).
   * Returns { entries, total } where total ignores limit/offset.
   *
   * @param {object} opts
   * @param {number} [opts.limit=50]
   * @param {number} [opts.offset=0]
   * @param {string} [opts.action]  exact match on the action column
   * @param {string|Date} [opts.since]  createdAt >= since
   * @param {string|Date} [opts.until]  createdAt <= until
   */
  async listRecent({ limit = 50, offset = 0, action, since, until } = {}) {
    const conds = [];
    if (action) conds.push(eq(auditLogs.action, action));
    if (since) conds.push(gte(auditLogs.createdAt, new Date(since)));
    if (until) conds.push(lte(auditLogs.createdAt, new Date(until)));
    const where = conds.length ? and(...conds) : undefined;

    const entries = await db.select().from(auditLogs)
      .where(where)
      .orderBy(desc(auditLogs.createdAt))
      .limit(limit)
      .offset(offset);

    const [{ count }] = await db.select({ count: sql`count(*)::int` })
      .from(auditLogs)
      .where(where);

    return { entries, total: count };
  },
};
