import { eq, and, desc } from 'drizzle-orm';
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
};
