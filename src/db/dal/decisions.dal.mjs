import { eq, and, desc } from 'drizzle-orm';
import { db } from '../connection.mjs';
import { decisionRequests } from '../schema/decisions.mjs';

export const decisionsDal = {
  async findById(id) {
    const [d] = await db.select().from(decisionRequests).where(eq(decisionRequests.id, id)).limit(1);
    return d ?? null;
  },

  async create(data) {
    const [d] = await db.insert(decisionRequests).values(data).returning();
    return d;
  },

  async resolve(id, { decidedByUserId, decision, rationale, selectedOption }) {
    const [d] = await db.update(decisionRequests)
      .set({
        status: 'decided',
        decidedByUserId,
        decision,
        rationale,
        decidedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(decisionRequests.id, id))
      .returning();
    return d ?? null;
  },

  async listByPlan(planId, { status } = {}) {
    const conditions = [eq(decisionRequests.planId, planId)];
    if (status) conditions.push(eq(decisionRequests.status, status));

    return db.select().from(decisionRequests)
      .where(and(...conditions))
      .orderBy(desc(decisionRequests.createdAt));
  },

  async listPending(planId) {
    return this.listByPlan(planId, { status: 'pending' });
  },
};
