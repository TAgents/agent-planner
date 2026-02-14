import { eq, and, desc } from 'drizzle-orm';
import { db } from '../connection.mjs';
import { goals, planGoals } from '../schema/goals.mjs';

export const goalsDal = {
  async findById(id) {
    const [goal] = await db.select().from(goals).where(eq(goals.id, id)).limit(1);
    return goal ?? null;
  },

  async create(data) {
    const [goal] = await db.insert(goals).values(data).returning();
    return goal;
  },

  async update(id, data) {
    const [goal] = await db.update(goals)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(goals.id, id))
      .returning();
    return goal ?? null;
  },

  async delete(id) {
    const [goal] = await db.delete(goals).where(eq(goals.id, id)).returning();
    return goal ?? null;
  },

  async listByOwner(ownerId) {
    return db.select().from(goals)
      .where(eq(goals.ownerId, ownerId))
      .orderBy(desc(goals.createdAt));
  },

  // Plan-Goal links
  async linkPlan(goalId, planId, linkedBy) {
    const [link] = await db.insert(planGoals)
      .values({ goalId, planId, linkedBy })
      .onConflictDoNothing()
      .returning();
    return link;
  },

  async unlinkPlan(goalId, planId) {
    const [link] = await db.delete(planGoals)
      .where(and(eq(planGoals.goalId, goalId), eq(planGoals.planId, planId)))
      .returning();
    return link ?? null;
  },

  async getLinkedPlans(goalId) {
    return db.select({ planId: planGoals.planId, linkedAt: planGoals.linkedAt })
      .from(planGoals)
      .where(eq(planGoals.goalId, goalId));
  },

  async getGoalsForPlan(planId) {
    const links = await db.select({ goalId: planGoals.goalId })
      .from(planGoals)
      .where(eq(planGoals.planId, planId));

    if (links.length === 0) return [];

    const goalIds = links.map(l => l.goalId);
    const { inArray } = await import('drizzle-orm');
    return db.select().from(goals).where(inArray(goals.id, goalIds));
  },
};
