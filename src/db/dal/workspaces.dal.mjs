import { eq, and, asc, isNull, sql as drizzleSql } from 'drizzle-orm';
import { db } from '../connection.mjs';
import { workspaces } from '../schema/workspaces.mjs';
import { goals } from '../schema/goals.mjs';
import { plans } from '../schema/plans.mjs';

// Slug helper — same conventions as organizations.routes
function slugify(input) {
  return String(input || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, 50) || 'workspace';
}

export const workspacesDal = {
  async findById(id) {
    const [row] = await db.select().from(workspaces).where(eq(workspaces.id, id)).limit(1);
    return row ?? null;
  },

  async findBySlug(organizationId, slug) {
    const [row] = await db.select()
      .from(workspaces)
      .where(and(eq(workspaces.organizationId, organizationId), eq(workspaces.slug, slug)))
      .limit(1);
    return row ?? null;
  },

  async listForOrganization(organizationId, { includeArchived = false } = {}) {
    const where = includeArchived
      ? eq(workspaces.organizationId, organizationId)
      : and(eq(workspaces.organizationId, organizationId), isNull(workspaces.archivedAt));
    return db.select().from(workspaces).where(where).orderBy(asc(workspaces.createdAt));
  },

  async findDefault(organizationId) {
    const [row] = await db.select()
      .from(workspaces)
      .where(and(
        eq(workspaces.organizationId, organizationId),
        eq(workspaces.isDefault, true),
      ))
      .limit(1);
    return row ?? null;
  },

  async create({
    organizationId,
    ownerId,
    title,
    slug,
    description,
    icon,
    isDefault = false,
    forkedFromBlueprintId,
    metadata,
  }) {
    const finalSlug = await this.uniqueSlug(organizationId, slug ?? slugify(title));
    const [row] = await db.insert(workspaces)
      .values({
        organizationId,
        ownerId,
        title,
        slug: finalSlug,
        description,
        icon,
        isDefault,
        forkedFromBlueprintId: forkedFromBlueprintId ?? null,
        forkedAt: forkedFromBlueprintId ? new Date() : null,
        metadata: metadata ?? {},
      })
      .returning();
    return row;
  },

  async update(id, data) {
    const updates = { ...data, updatedAt: new Date() };
    // Don't allow direct mutation of organization, owner, or fork provenance via update.
    delete updates.organizationId;
    delete updates.ownerId;
    delete updates.forkedFromBlueprintId;
    delete updates.forkedAt;
    const [row] = await db.update(workspaces)
      .set(updates)
      .where(eq(workspaces.id, id))
      .returning();
    return row ?? null;
  },

  async archive(id) {
    const [row] = await db.update(workspaces)
      .set({ archivedAt: new Date(), updatedAt: new Date() })
      .where(eq(workspaces.id, id))
      .returning();
    return row ?? null;
  },

  async unarchive(id) {
    const [row] = await db.update(workspaces)
      .set({ archivedAt: null, updatedAt: new Date() })
      .where(eq(workspaces.id, id))
      .returning();
    return row ?? null;
  },

  async delete(id) {
    const [row] = await db.delete(workspaces).where(eq(workspaces.id, id)).returning();
    return row ?? null;
  },

  async uniqueSlug(organizationId, base) {
    const baseSlug = slugify(base);
    let candidate = baseSlug;
    let suffix = 2;
    while (await this.findBySlug(organizationId, candidate)) {
      candidate = `${baseSlug}-${suffix++}`;
      if (suffix > 100) {
        candidate = `${baseSlug}-${Date.now().toString(36)}`;
        break;
      }
    }
    return candidate;
  },

  // ─── Counts for listing UIs ─────────────────────────────────────

  async getCounts(workspaceId) {
    const [{ goalCount, planCount }] = await db
      .select({
        goalCount: drizzleSql`(SELECT COUNT(*)::int FROM goals WHERE workspace_id = ${workspaceId})`,
        planCount: drizzleSql`(SELECT COUNT(*)::int FROM plans WHERE workspace_id = ${workspaceId})`,
      })
      .from(workspaces)
      .where(eq(workspaces.id, workspaceId))
      .limit(1);
    return { goalCount: Number(goalCount ?? 0), planCount: Number(planCount ?? 0) };
  },

  // ─── Membership check via organization ──────────────────────────
  // Uses raw join through organization_members for v1; later we may add
  // workspace_collaborators for sub-org scoping (see sketch open question 2).
  async userHasAccess(workspaceId, userId) {
    const rows = await db.execute(drizzleSql`
      SELECT 1
      FROM workspaces w
      JOIN organization_members om ON om.organization_id = w.organization_id
      WHERE w.id = ${workspaceId} AND om.user_id = ${userId}
      LIMIT 1
    `);
    return rows.length > 0;
  },
};
