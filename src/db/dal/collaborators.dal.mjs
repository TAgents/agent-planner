import { eq, and } from 'drizzle-orm';
import { db } from '../connection.mjs';
import { planCollaborators } from '../schema/plans.mjs';
import { users } from '../schema/users.mjs';

export const collaboratorsDal = {
  async listByPlan(planId) {
    return db.select({
      id: planCollaborators.id,
      planId: planCollaborators.planId,
      userId: planCollaborators.userId,
      role: planCollaborators.role,
      createdAt: planCollaborators.createdAt,
      userName: users.name,
      userEmail: users.email,
    })
    .from(planCollaborators)
    .innerJoin(users, eq(planCollaborators.userId, users.id))
    .where(eq(planCollaborators.planId, planId));
  },

  async add(planId, userId, role = 'viewer') {
    const [collab] = await db.insert(planCollaborators)
      .values({ planId, userId, role })
      .onConflictDoUpdate({
        target: [planCollaborators.planId, planCollaborators.userId],
        set: { role },
      })
      .returning();
    return collab;
  },

  async updateRole(planId, userId, role) {
    const [collab] = await db.update(planCollaborators)
      .set({ role })
      .where(and(eq(planCollaborators.planId, planId), eq(planCollaborators.userId, userId)))
      .returning();
    return collab ?? null;
  },

  async remove(planId, userId) {
    const [collab] = await db.delete(planCollaborators)
      .where(and(eq(planCollaborators.planId, planId), eq(planCollaborators.userId, userId)))
      .returning();
    return collab ?? null;
  },

  async listPlanIdsForUser(userId) {
    const rows = await db.select({ planId: planCollaborators.planId })
      .from(planCollaborators)
      .where(eq(planCollaborators.userId, userId));
    return rows.map(r => r.planId);
  },

  async isCollaborator(planId, userId) {
    const [c] = await db.select({ role: planCollaborators.role })
      .from(planCollaborators)
      .where(and(eq(planCollaborators.planId, planId), eq(planCollaborators.userId, userId)))
      .limit(1);
    return c ?? null;
  },

  async findByPlanAndUser(planId, userId) {
    const [c] = await db.select()
      .from(planCollaborators)
      .where(and(eq(planCollaborators.planId, planId), eq(planCollaborators.userId, userId)))
      .limit(1);
    return c ?? null;
  },

  async create(data) {
    const [c] = await db.insert(planCollaborators).values(data).returning();
    return c;
  },

  async update(id, data) {
    const [c] = await db.update(planCollaborators)
      .set(data)
      .where(eq(planCollaborators.id, id))
      .returning();
    return c ?? null;
  },

  async deleteByPlan(planId) {
    return db.delete(planCollaborators)
      .where(eq(planCollaborators.planId, planId));
  },

  async deleteByPlanAndUser(planId, userId) {
    const [c] = await db.delete(planCollaborators)
      .where(and(eq(planCollaborators.planId, planId), eq(planCollaborators.userId, userId)))
      .returning();
    return c ?? null;
  },
};
