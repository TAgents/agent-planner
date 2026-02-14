import { eq, and, or, inArray, desc, sql } from 'drizzle-orm';
import { db } from '../connection.mjs';
import { plans } from '../schema/plans.mjs';
import { planCollaborators } from '../schema/plans.mjs';

export const plansDal = {
  async findById(id) {
    const [plan] = await db.select().from(plans).where(eq(plans.id, id)).limit(1);
    return plan ?? null;
  },

  async create(data) {
    const [plan] = await db.insert(plans).values(data).returning();
    return plan;
  },

  async update(id, data) {
    const [plan] = await db.update(plans)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(plans.id, id))
      .returning();
    return plan ?? null;
  },

  async delete(id) {
    const [plan] = await db.delete(plans).where(eq(plans.id, id)).returning();
    return plan ?? null;
  },

  /**
   * List plans owned by user + plans they collaborate on
   */
  async listForUser(userId) {
    // Owned plans
    const owned = await db.select().from(plans).where(eq(plans.ownerId, userId));

    // Collaborated plans
    const collabs = await db.select({ planId: planCollaborators.planId, role: planCollaborators.role })
      .from(planCollaborators)
      .where(eq(planCollaborators.userId, userId));

    let shared = [];
    if (collabs.length > 0) {
      const sharedIds = collabs.map(c => c.planId);
      shared = await db.select().from(plans).where(inArray(plans.id, sharedIds));
      shared = shared.map(p => {
        const c = collabs.find(col => col.planId === p.id);
        return { ...p, role: c?.role ?? null };
      });
    }

    return { owned, shared };
  },

  /**
   * List public/unlisted plans
   */
  async listPublic({ limit = 50, offset = 0 } = {}) {
    return db.select().from(plans)
      .where(or(eq(plans.visibility, 'public'), eq(plans.isPublic, true)))
      .orderBy(desc(plans.updatedAt))
      .limit(limit)
      .offset(offset);
  },

  /**
   * Check if user has access to plan (owner or collaborator)
   */
  async userHasAccess(planId, userId) {
    const plan = await this.findById(planId);
    if (!plan) return { hasAccess: false, role: null, plan: null };

    if (plan.ownerId === userId) {
      return { hasAccess: true, role: 'owner', plan };
    }

    const [collab] = await db.select()
      .from(planCollaborators)
      .where(and(eq(planCollaborators.planId, planId), eq(planCollaborators.userId, userId)))
      .limit(1);

    if (collab) {
      return { hasAccess: true, role: collab.role, plan };
    }

    // Check if public
    if (plan.visibility === 'public' || plan.isPublic) {
      return { hasAccess: true, role: 'viewer', plan };
    }

    return { hasAccess: false, role: null, plan: null };
  },

  async incrementViewCount(id) {
    await db.update(plans)
      .set({
        viewCount: sql`${plans.viewCount} + 1`,
        lastViewedAt: new Date(),
      })
      .where(eq(plans.id, id));
  },
};
