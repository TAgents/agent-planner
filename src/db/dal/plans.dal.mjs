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

  /**
   * Deep-clone a plan into a new owner / org. Copies the plan row, all
   * plan_nodes (with translated parent_id mappings), and all dependency
   * edges (with translated source/target node ids). Lineage is recorded
   * on the new plan's metadata.forked_from + .forked_at so future
   * sessions can trace ancestry without a new column.
   *
   * Returns the newly-created plan row. Throws on missing source.
   */
  async fork(sourcePlanId, { ownerId, organizationId = null, title = null }) {
    const { planNodes } = await import('../schema/plans.mjs');
    const { nodeDependencies } = await import('../schema/dependencies.mjs');

    const [source] = await db.select().from(plans).where(eq(plans.id, sourcePlanId)).limit(1);
    if (!source) throw new Error(`fork: source plan ${sourcePlanId} not found`);

    const [forked] = await db.insert(plans).values({
      title: title || `${source.title} (fork)`,
      description: source.description,
      ownerId,
      organizationId,
      status: 'draft',
      visibility: 'private',
      metadata: {
        ...(source.metadata || {}),
        forked_from: source.id,
        forked_at: new Date().toISOString(),
      },
    }).returning();

    // Pull all nodes for the source plan in one shot.
    const srcNodes = await db.select().from(planNodes).where(eq(planNodes.planId, sourcePlanId));
    if (srcNodes.length === 0) return forked;

    // Stable id-mapping: oldNodeId → newNodeId. Two-pass insert lets us
    // translate parent_id without ordering nodes by depth.
    const idMap = new Map();
    const inserts = srcNodes.map((n) => ({
      planId: forked.id,
      parentId: null,
      nodeType: n.nodeType,
      title: n.title,
      description: n.description,
      // Reset progress: a fork is a starting point, not a snapshot of
      // execution state. Quality + coherence bake in from re-running.
      status: n.nodeType === 'root' ? n.status : 'not_started',
      orderIndex: n.orderIndex,
      dueDate: n.dueDate,
      context: n.context,
      agentInstructions: n.agentInstructions,
      taskMode: n.taskMode,
      metadata: { ...(n.metadata || {}), forked_from_node: n.id },
      _sourceId: n.id,
      _sourceParentId: n.parentId,
    }));

    // Pass 1: insert with null parent_id, capture id mapping.
    for (const row of inserts) {
      const { _sourceId, _sourceParentId, ...payload } = row;
      const [created] = await db.insert(planNodes).values(payload).returning();
      idMap.set(_sourceId, created.id);
    }
    // Pass 2: patch parent_id where source had a parent.
    for (const row of inserts) {
      if (!row._sourceParentId) continue;
      const newId = idMap.get(row._sourceId);
      const newParent = idMap.get(row._sourceParentId);
      if (newId && newParent) {
        await db.update(planNodes).set({ parentId: newParent }).where(eq(planNodes.id, newId));
      }
    }

    // Re-create dependency edges with translated node ids.
    const srcEdges = await db.select().from(nodeDependencies)
      .where(eq(nodeDependencies.planId, sourcePlanId));
    for (const e of srcEdges) {
      const newSource = idMap.get(e.sourceNodeId);
      const newTarget = idMap.get(e.targetNodeId);
      if (!newSource || !newTarget) continue;
      try {
        await db.insert(nodeDependencies).values({
          planId: forked.id,
          sourceNodeId: newSource,
          targetNodeId: newTarget,
          dependencyType: e.dependencyType,
        });
      } catch {
        // swallow per-edge errors so a single bad edge doesn't tank the fork
      }
    }

    return forked;
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
   * List plans owned by user + plans they collaborate on + org plans
   */
  async listForUser(userId, { organizationId, status } = {}) {
    // Build status filter conditions
    const statusConditions = status
      ? [inArray(plans.status, Array.isArray(status) ? status : [status])]
      : [];

    // Owned plans
    const owned = await db.select().from(plans)
      .where(and(eq(plans.ownerId, userId), ...statusConditions));
    const ownedIds = new Set(owned.map(p => p.id));

    // Collaborated plans
    const collabs = await db.select({ planId: planCollaborators.planId, role: planCollaborators.role })
      .from(planCollaborators)
      .where(eq(planCollaborators.userId, userId));

    let shared = [];
    if (collabs.length > 0) {
      const sharedIds = collabs.map(c => c.planId).filter(id => !ownedIds.has(id));
      if (sharedIds.length > 0) {
        shared = await db.select().from(plans)
          .where(and(inArray(plans.id, sharedIds), ...statusConditions));
        shared = shared.map(p => {
          const c = collabs.find(col => col.planId === p.id);
          return { ...p, role: c?.role ?? null };
        });
      }
    }
    const sharedIds = new Set(shared.map(p => p.id));

    // Organization plans (visible to all org members, like goals)
    let organization = [];
    if (organizationId) {
      const orgPlans = await db.select().from(plans)
        .where(and(eq(plans.organizationId, organizationId), ...statusConditions));
      // Exclude plans already in owned or shared
      organization = orgPlans
        .filter(p => !ownedIds.has(p.id) && !sharedIds.has(p.id))
        .map(p => ({ ...p, role: 'member' }));
    }

    return { owned, shared, organization };
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

    const roleRank = { viewer: 0, editor: 1, admin: 2, owner: 3 };

    const [collab] = await db.select()
      .from(planCollaborators)
      .where(and(eq(planCollaborators.planId, planId), eq(planCollaborators.userId, userId)))
      .limit(1);

    let bestRole = collab ? collab.role : null;

    // Check organization membership — use the higher of collab vs org role
    if (plan.organizationId) {
      const [orgMember] = await db.select({ role: organizationMembers.role })
        .from(organizationMembers)
        .where(and(
          eq(organizationMembers.organizationId, plan.organizationId),
          eq(organizationMembers.userId, userId),
        ))
        .limit(1);
      if (orgMember) {
        const orgPlanRole = (orgMember.role === 'owner' || orgMember.role === 'admin') ? 'admin' : 'editor';
        if (!bestRole || (roleRank[orgPlanRole] || 0) > (roleRank[bestRole] || 0)) {
          bestRole = orgPlanRole;
        }
      }
    }

    if (bestRole) {
      return { hasAccess: true, role: bestRole, plan };
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

  async listByOrganization(organizationId, { status } = {}) {
    const conditions = [eq(plans.organizationId, organizationId)];
    if (status) {
      const statuses = Array.isArray(status) ? status : [status];
      conditions.push(inArray(plans.status, statuses));
    }
    return db.select().from(plans).where(and(...conditions));
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
