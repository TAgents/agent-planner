import { eq, desc } from 'drizzle-orm';
import { db } from '../connection.mjs';
import { agentHeartbeats, handoffs } from '../schema/agents.mjs';

export const agentsDal = {
  // Heartbeats
  async upsertHeartbeat(userId, data = {}) {
    const [hb] = await db.insert(agentHeartbeats)
      .values({ userId, lastSeenAt: new Date(), ...data })
      .onConflictDoUpdate({
        target: agentHeartbeats.userId,
        set: { lastSeenAt: new Date(), ...data },
      })
      .returning();
    return hb;
  },

  async getHeartbeat(userId) {
    const [hb] = await db.select().from(agentHeartbeats)
      .where(eq(agentHeartbeats.userId, userId)).limit(1);
    return hb ?? null;
  },

  async listOnlineAgents() {
    return db.select().from(agentHeartbeats)
      .where(eq(agentHeartbeats.status, 'online'));
  },

  // Handoffs
  async createHandoff(data) {
    const [h] = await db.insert(handoffs).values(data).returning();
    return h;
  },

  async resolveHandoff(id, status) {
    const [h] = await db.update(handoffs)
      .set({ status, resolvedAt: new Date() })
      .where(eq(handoffs.id, id))
      .returning();
    return h ?? null;
  },

  async listHandoffsForAgent(agentId) {
    return db.select().from(handoffs)
      .where(eq(handoffs.toAgentId, agentId))
      .orderBy(desc(handoffs.createdAt));
  },
};
