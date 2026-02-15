import { eq, and, or, inArray, desc, asc, sql, ilike, isNull, isNotNull, gte, lte } from 'drizzle-orm';
import { db } from '../connection.mjs';
import { plans } from '../schema/plans.mjs';
import { planCollaborators } from '../schema/plans.mjs';
import { organizationMembers } from '../schema/organizations.mjs';

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

    // Check organization membership
    if (plan.organizationId) {
      const [orgMember] = await db.select({ role: organizationMembers.role })
        .from(organizationMembers)
        .where(and(
          eq(organizationMembers.organizationId, plan.organizationId),
          eq(organizationMembers.userId, userId),
        ))
        .limit(1);
      if (orgMember) {
        return { hasAccess: true, role: 'viewer', plan };
      }
    }

    // Check if public
    if (plan.visibility === 'public' || plan.isPublic) {
      return { hasAccess: true, role: 'viewer', plan };
    }

    return { hasAccess: false, role: null, plan: null };
  },

  async count({ isPublic } = {}) {
    const conditions = [];
    if (isPublic !== undefined) conditions.push(eq(plans.isPublic, isPublic));
    const where = conditions.length > 0 ? and(...conditions) : undefined;
    const result = await db.select({ count: sql`count(*)::int` }).from(plans).where(where);
    return result[0]?.count ?? 0;
  },

  async listByOwner(userId) {
    return db.select().from(plans).where(eq(plans.ownerId, userId));
  },

  async countByIds(planIds, { status } = {}) {
    if (planIds.length === 0) return 0;
    const conditions = [inArray(plans.id, planIds)];
    if (status) {
      const statuses = Array.isArray(status) ? status : [status];
      conditions.push(inArray(plans.status, statuses));
    }
    const result = await db.select({ count: sql`count(*)::int` })
      .from(plans)
      .where(and(...conditions));
    return result[0]?.count ?? 0;
  },

  async incrementViewCount(id) {
    await db.update(plans)
      .set({
        viewCount: sql`${plans.viewCount} + 1`,
        lastViewedAt: new Date(),
      })
      .where(eq(plans.id, id));
  },

  /**
   * List public plans with filters, sorting, and pagination
   */
  async listPublicFiltered({ sortBy = 'recent', limit = 12, offset = 0, status, hasGithubLink, owner, updatedAfter, updatedBefore } = {}) {
    const conditions = [eq(plans.visibility, 'public')];

    if (status) conditions.push(eq(plans.status, status));
    if (hasGithubLink === 'true') conditions.push(isNotNull(plans.githubRepoOwner));
    else if (hasGithubLink === 'false') conditions.push(isNull(plans.githubRepoOwner));
    if (owner) conditions.push(eq(plans.ownerId, owner));
    if (updatedAfter) conditions.push(gte(plans.updatedAt, new Date(updatedAfter)));
    if (updatedBefore) conditions.push(lte(plans.updatedAt, new Date(updatedBefore)));

    let query = db.select().from(plans).where(and(...conditions));

    if (sortBy === 'recent') {
      query = query.orderBy(desc(plans.updatedAt));
    } else if (sortBy === 'alphabetical') {
      query = query.orderBy(asc(plans.title));
    } else {
      query = query.orderBy(desc(plans.updatedAt)); // default for completion (sorted in memory)
    }

    const data = await query.limit(limit).offset(offset);

    // Get total count
    const [countResult] = await db.select({ count: sql`count(*)::int` })
      .from(plans)
      .where(and(...conditions));
    const total = countResult?.count ?? 0;

    return { data, total };
  },
};
