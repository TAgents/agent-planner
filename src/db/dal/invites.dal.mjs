import { eq, and, gt, desc } from 'drizzle-orm';
import { db } from '../connection.mjs';
import { pendingInvites } from '../schema/auth.mjs';

export const invitesDal = {
  async findByToken(token) {
    const [invite] = await db.select().from(pendingInvites)
      .where(eq(pendingInvites.id, token)) // token is the id
      .limit(1);
    return invite ?? null;
  },

  async findByPlanAndEmail(planId, email) {
    const [invite] = await db.select().from(pendingInvites)
      .where(and(
        eq(pendingInvites.planId, planId),
        eq(pendingInvites.email, email.toLowerCase())
      ))
      .limit(1);
    return invite ?? null;
  },

  async findPendingByEmail(email) {
    return db.select().from(pendingInvites)
      .where(and(
        eq(pendingInvites.email, email.toLowerCase()),
        gt(pendingInvites.expiresAt, new Date())
      ));
  },

  async listByPlan(planId) {
    return db.select().from(pendingInvites)
      .where(and(
        eq(pendingInvites.planId, planId),
        gt(pendingInvites.expiresAt, new Date())
      ))
      .orderBy(desc(pendingInvites.createdAt));
  },

  async create(data) {
    const [invite] = await db.insert(pendingInvites).values(data).returning();
    return invite;
  },

  async delete(id) {
    const [invite] = await db.delete(pendingInvites)
      .where(eq(pendingInvites.id, id))
      .returning();
    return invite ?? null;
  },

  async deleteByPlanAndId(planId, inviteId) {
    const [invite] = await db.delete(pendingInvites)
      .where(and(eq(pendingInvites.id, inviteId), eq(pendingInvites.planId, planId)))
      .returning();
    return invite ?? null;
  },

  async deleteExpired() {
    const deleted = await db.delete(pendingInvites)
      .where(gt(new Date(), pendingInvites.expiresAt))
      .returning();
    return deleted.length;
  },
};
