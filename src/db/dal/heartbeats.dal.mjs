import { eq, inArray, and, not, isNull } from 'drizzle-orm';
import { db } from '../connection.mjs';
import { agentHeartbeats } from '../schema/agents.mjs';

export const heartbeatsDal = {
  async findByUserId(userId) {
    const [heartbeat] = await db.select().from(agentHeartbeats).where(eq(agentHeartbeats.userId, userId)).limit(1);
    return heartbeat ?? null;
  },

  async upsert(data) {
    const [heartbeat] = await db.insert(agentHeartbeats)
      .values(data)
      .onConflictDoUpdate({
        target: agentHeartbeats.userId,
        set: {
          lastSeenAt: data.lastSeenAt,
          status: data.status,
          currentPlanId: data.currentPlanId,
          currentTaskId: data.currentTaskId,
          metadata: data.metadata,
        }
      })
      .returning();
    return heartbeat;
  },

  async findByPlanId(planId) {
    return db.select().from(agentHeartbeats).where(eq(agentHeartbeats.currentPlanId, planId));
  },

  async findByUserIds(userIds) {
    if (userIds.length === 0) return [];
    return db.select().from(agentHeartbeats).where(inArray(agentHeartbeats.userId, userIds));
  },

  async delete(userId) {
    const [heartbeat] = await db.delete(agentHeartbeats).where(eq(agentHeartbeats.userId, userId)).returning();
    return heartbeat ?? null;
  },

  async updateStatus(userId, status) {
    const [heartbeat] = await db.update(agentHeartbeats)
      .set({ status, lastSeenAt: new Date() })
      .where(eq(agentHeartbeats.userId, userId))
      .returning();
    return heartbeat ?? null;
  },
};