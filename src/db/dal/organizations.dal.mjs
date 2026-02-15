import { eq, and, sql } from 'drizzle-orm';
import { db } from '../connection.mjs';
import { organizations, organizationMembers } from '../schema/organizations.mjs';
import { users } from '../schema/users.mjs';
import { plans } from '../schema/plans.mjs';

export const organizationsDal = {
  // ─── Organization CRUD ─────────────────────────────────────────

  async findById(id) {
    const [org] = await db.select().from(organizations).where(eq(organizations.id, id)).limit(1);
    return org ?? null;
  },

  async findBySlug(slug) {
    const [org] = await db.select().from(organizations).where(eq(organizations.slug, slug)).limit(1);
    return org ?? null;
  },

  async create({ name, slug, description, isPersonal = false, avatarUrl }) {
    const [org] = await db.insert(organizations)
      .values({ name, slug, description, isPersonal, avatarUrl })
      .returning();
    return org;
  },

  async update(id, data) {
    const updates = { ...data, updatedAt: new Date() };
    const [org] = await db.update(organizations)
      .set(updates)
      .where(eq(organizations.id, id))
      .returning();
    return org ?? null;
  },

  async delete(id) {
    const [org] = await db.delete(organizations)
      .where(eq(organizations.id, id))
      .returning();
    return org ?? null;
  },

  // ─── Membership ────────────────────────────────────────────────

  async listForUser(userId) {
    return db.select({
      id: organizations.id,
      name: organizations.name,
      slug: organizations.slug,
      description: organizations.description,
      isPersonal: organizations.isPersonal,
      avatarUrl: organizations.avatarUrl,
      createdAt: organizations.createdAt,
      role: organizationMembers.role,
      joinedAt: organizationMembers.joinedAt,
    })
    .from(organizationMembers)
    .innerJoin(organizations, eq(organizationMembers.organizationId, organizations.id))
    .where(eq(organizationMembers.userId, userId));
  },

  async getMembership(orgId, userId) {
    const [m] = await db.select()
      .from(organizationMembers)
      .where(and(eq(organizationMembers.organizationId, orgId), eq(organizationMembers.userId, userId)))
      .limit(1);
    return m ?? null;
  },

  async addMember(orgId, userId, role = 'member') {
    const [m] = await db.insert(organizationMembers)
      .values({ organizationId: orgId, userId, role })
      .onConflictDoUpdate({
        target: [organizationMembers.organizationId, organizationMembers.userId],
        set: { role },
      })
      .returning();
    return m;
  },

  async updateMemberRole(orgId, memberId, role) {
    const [m] = await db.update(organizationMembers)
      .set({ role })
      .where(and(eq(organizationMembers.id, memberId), eq(organizationMembers.organizationId, orgId)))
      .returning();
    return m ?? null;
  },

  async removeMember(orgId, memberId) {
    const [m] = await db.delete(organizationMembers)
      .where(and(eq(organizationMembers.id, memberId), eq(organizationMembers.organizationId, orgId)))
      .returning();
    return m ?? null;
  },

  async listMembers(orgId) {
    return db.select({
      id: organizationMembers.id,
      role: organizationMembers.role,
      joinedAt: organizationMembers.joinedAt,
      userId: users.id,
      userEmail: users.email,
      userName: users.name,
      userAvatarUrl: users.avatarUrl,
    })
    .from(organizationMembers)
    .innerJoin(users, eq(organizationMembers.userId, users.id))
    .where(eq(organizationMembers.organizationId, orgId));
  },

  async getMemberCount(orgId) {
    const [r] = await db.select({ count: sql`count(*)::int` })
      .from(organizationMembers)
      .where(eq(organizationMembers.organizationId, orgId));
    return r?.count ?? 0;
  },

  // ─── Org-scoped plans ──────────────────────────────────────────

  async getPlanCount(orgId) {
    const [r] = await db.select({ count: sql`count(*)::int` })
      .from(plans)
      .where(eq(plans.organizationId, orgId));
    return r?.count ?? 0;
  },

  async listPlans(orgId) {
    return db.select()
      .from(plans)
      .where(eq(plans.organizationId, orgId));
  },
};
