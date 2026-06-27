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
    // Decorate each row with goal + plan counts AND a progress/health rollup in
    // a single round trip via correlated subqueries — keeps the list endpoint
    // useful for the Workspaces Index without an N+1 fan-out from the UI. The
    // node aggregates count task+milestone (leaf work) nodes across the
    // workspace's NON-ARCHIVED plans — the same definition the plan page and
    // goal rollup use — so the Progress column stops reading a hardcoded 0%.
    const workNodeFilter = drizzleSql`pn.node_type IN ('task','milestone')`;
    const rows = await db
      .select({
        id: workspaces.id,
        organizationId: workspaces.organizationId,
        ownerId: workspaces.ownerId,
        title: workspaces.title,
        slug: workspaces.slug,
        description: workspaces.description,
        icon: workspaces.icon,
        isDefault: workspaces.isDefault,
        archivedAt: workspaces.archivedAt,
        forkedFromBlueprintId: workspaces.forkedFromBlueprintId,
        forkedAt: workspaces.forkedAt,
        metadata: workspaces.metadata,
        createdAt: workspaces.createdAt,
        updatedAt: workspaces.updatedAt,
        goalCount: drizzleSql`(SELECT COUNT(*)::int FROM goals g WHERE g.workspace_id = workspaces.id)`.as('goal_count'),
        planCount: drizzleSql`(SELECT COUNT(*)::int FROM plans p WHERE p.workspace_id = workspaces.id)`.as('plan_count'),
        totalNodes: drizzleSql`(SELECT COUNT(*)::int FROM plan_nodes pn JOIN plans p ON p.id = pn.plan_id WHERE p.workspace_id = workspaces.id AND p.status <> 'archived' AND ${workNodeFilter})`.as('total_nodes'),
        completedNodes: drizzleSql`(SELECT COUNT(*)::int FROM plan_nodes pn JOIN plans p ON p.id = pn.plan_id WHERE p.workspace_id = workspaces.id AND p.status <> 'archived' AND ${workNodeFilter} AND pn.status = 'completed')`.as('completed_nodes'),
        blockedNodes: drizzleSql`(SELECT COUNT(*)::int FROM plan_nodes pn JOIN plans p ON p.id = pn.plan_id WHERE p.workspace_id = workspaces.id AND p.status <> 'archived' AND ${workNodeFilter} AND pn.status = 'blocked')`.as('blocked_nodes'),
        lastActivityAt: drizzleSql`(SELECT MAX(pnl.created_at) FROM plan_node_logs pnl JOIN plan_nodes pn ON pn.id = pnl.plan_node_id JOIN plans p ON p.id = pn.plan_id WHERE p.workspace_id = workspaces.id)`.as('last_activity_at'),
      })
      .from(workspaces)
      .where(where)
      .orderBy(asc(workspaces.createdAt));

    return rows.map((r) => {
      const total = Number(r.totalNodes ?? 0);
      const completed = Number(r.completedNodes ?? 0);
      const blocked = Number(r.blockedNodes ?? 0);
      return {
        ...r,
        totalNodes: total,
        completedNodes: completed,
        blockedNodes: blocked,
        progressPct: total > 0 ? Math.round((completed / total) * 100) : 0,
      };
    });
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
