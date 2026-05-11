import { eq, and, or, desc, inArray, sql as drizzleSql } from 'drizzle-orm';
import { db } from '../connection.mjs';
import { blueprints } from '../schema/blueprints.mjs';
import { plans, planNodes } from '../schema/plans.mjs';
import { nodeDependencies } from '../schema/dependencies.mjs';
import { workspaces } from '../schema/workspaces.mjs';

const PAYLOAD_VERSION = 1;

export const blueprintsDal = {
  async findById(id) {
    const [row] = await db.select().from(blueprints).where(eq(blueprints.id, id)).limit(1);
    return row ?? null;
  },

  async listForUser(userId, { scope, visibility, ownerOnly = false } = {}) {
    const conditions = [];
    if (ownerOnly) {
      conditions.push(eq(blueprints.ownerId, userId));
    } else {
      conditions.push(or(
        eq(blueprints.ownerId, userId),
        inArray(blueprints.visibility, ['public', 'unlisted']),
      ));
    }
    if (scope) conditions.push(eq(blueprints.scope, scope));
    if (visibility) conditions.push(eq(blueprints.visibility, visibility));

    return db.select()
      .from(blueprints)
      .where(and(...conditions))
      .orderBy(desc(blueprints.createdAt));
  },

  async create(data) {
    const [row] = await db.insert(blueprints).values({
      ownerId: data.ownerId,
      organizationId: data.organizationId ?? null,
      title: data.title,
      description: data.description ?? null,
      scope: data.scope,
      visibility: data.visibility ?? 'private',
      version: data.version ?? 1,
      payload: data.payload,
      sourceWorkspaceId: data.sourceWorkspaceId ?? null,
      sourcePlanId: data.sourcePlanId ?? null,
      tags: data.tags ?? [],
      publishedAt: data.visibility && data.visibility !== 'private' ? new Date() : null,
    }).returning();
    return row;
  },

  async update(id, data) {
    const updates = { ...data, updatedAt: new Date() };
    delete updates.ownerId;
    delete updates.organizationId;
    delete updates.scope;          // scope is immutable post-create
    delete updates.payload;        // payload is rewritten only via re-snapshot
    delete updates.sourceWorkspaceId;
    delete updates.sourcePlanId;
    delete updates.forkCount;
    if (updates.visibility && updates.visibility !== 'private') {
      updates.publishedAt = new Date();
    }
    const [row] = await db.update(blueprints)
      .set(updates)
      .where(eq(blueprints.id, id))
      .returning();
    return row ?? null;
  },

  async delete(id) {
    const [row] = await db.delete(blueprints).where(eq(blueprints.id, id)).returning();
    return row ?? null;
  },

  async incrementForkCount(id) {
    await db.update(blueprints)
      .set({ forkCount: drizzleSql`${blueprints.forkCount} + 1` })
      .where(eq(blueprints.id, id));
  },

  /**
   * List plans (and their workspace) forked from a given blueprint.
   * Used by the Blueprint Detail page's "Derived Workspaces" panel
   * and any "where has this been used?" feature.
   */
  async listForks(blueprintId, { limit = 50 } = {}) {
    const rows = await db.select({
      id: plans.id,
      title: plans.title,
      status: plans.status,
      visibility: plans.visibility,
      ownerId: plans.ownerId,
      organizationId: plans.organizationId,
      workspaceId: plans.workspaceId,
      forkedAt: plans.forkedAt,
      createdAt: plans.createdAt,
      updatedAt: plans.updatedAt,
    })
    .from(plans)
    .where(eq(plans.forkedFromBlueprintId, blueprintId))
    .orderBy(desc(plans.forkedAt))
    .limit(limit);

    if (rows.length === 0) return [];

    // Decorate each row with its workspace title (if any)
    const wsIds = Array.from(new Set(rows.map((r) => r.workspaceId).filter(Boolean)));
    let wsMap = new Map();
    if (wsIds.length > 0) {
      const wsRows = await db.select({ id: workspaces.id, title: workspaces.title, slug: workspaces.slug })
        .from(workspaces)
        .where(inArray(workspaces.id, wsIds));
      wsMap = new Map(wsRows.map((w) => [w.id, w]));
    }

    return rows.map((r) => ({
      ...r,
      workspace: r.workspaceId ? (wsMap.get(r.workspaceId) || null) : null,
    }));
  },

  // ─── Snapshot a live plan → blueprint payload ───────────────────
  /**
   * Reads a plan + its node tree + dependencies and returns a
   * dehydrated payload. Excludes run-state per
   * docs/WORKSPACE_BLUEPRINT_SKETCH.md: claims, knowledge, logs,
   * decisions, statuses, agent assignments, quality.
   */
  async snapshotPlan(planId) {
    const [plan] = await db.select().from(plans).where(eq(plans.id, planId)).limit(1);
    if (!plan) return null;

    const nodes = await db.select().from(planNodes).where(eq(planNodes.planId, planId));
    // node_dependencies has no plan_id column — filter by membership in this plan's node set
    const nodeIds = nodes.map((n) => n.id);
    const deps = nodeIds.length === 0
      ? []
      : await db.select().from(nodeDependencies).where(inArray(nodeDependencies.sourceNodeId, nodeIds));

    // Map UUIDs to opaque keys local to the payload so consumers don't think
    // they're meaningful database IDs.
    const keyOf = new Map();
    nodes.forEach((n, i) => keyOf.set(n.id, `n${i}`));

    return {
      version: PAYLOAD_VERSION,
      scope: 'plan',
      plan: {
        title: plan.title,
        description: plan.description,
      },
      nodes: nodes.map((n) => ({
        key: keyOf.get(n.id),
        parent_key: n.parentId ? (keyOf.get(n.parentId) ?? null) : null,
        node_type: n.nodeType,
        title: n.title,
        description: n.description,
        order_index: n.orderIndex,
        task_mode: n.taskMode,
        context: n.context,
        agent_instructions: n.agentInstructions,
        // due_date intentionally excluded — it's run-state-ish
      })),
      dependencies: deps
        .filter((d) => keyOf.has(d.sourceNodeId) && keyOf.has(d.targetNodeId))
        .map((d) => ({
          source_key: keyOf.get(d.sourceNodeId),
          target_key: keyOf.get(d.targetNodeId),
          dependency_type: d.dependencyType,
        })),
    };
  },

  // ─── Save a plan as a new Blueprint ─────────────────────────────
  async savePlanAsBlueprint({ planId, ownerId, title, description, visibility = 'private', tags = [] }) {
    const [plan] = await db.select().from(plans).where(eq(plans.id, planId)).limit(1);
    if (!plan) throw new Error(`Plan ${planId} not found`);

    const payload = await this.snapshotPlan(planId);
    if (!payload) throw new Error(`Failed to snapshot plan ${planId}`);

    return this.create({
      ownerId,
      organizationId: plan.organizationId,
      title: title || plan.title,
      description: description ?? plan.description ?? null,
      scope: 'plan',
      visibility,
      payload,
      sourcePlanId: planId,
      tags,
    });
  },

  // ─── Fork a Blueprint into a new Plan in a Workspace ────────────
  /**
   * Plan-scope fork: instantiates the blueprint payload as a new plan
   * inside `workspaceId`. Reuses the same two-pass node insert pattern
   * as plansDal.fork. Returns the new plan row.
   */
  async forkPlanScope({ blueprintId, workspaceId, ownerId, title = null }) {
    const blueprint = await this.findById(blueprintId);
    if (!blueprint) throw new Error(`Blueprint ${blueprintId} not found`);
    if (blueprint.scope !== 'plan') {
      throw new Error(`forkPlanScope: blueprint scope is '${blueprint.scope}', expected 'plan'`);
    }

    const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, workspaceId)).limit(1);
    if (!ws) throw new Error(`Workspace ${workspaceId} not found`);

    const payload = blueprint.payload || {};
    const planMeta = payload.plan || {};
    const nodes = Array.isArray(payload.nodes) ? payload.nodes : [];
    const dependencies = Array.isArray(payload.dependencies) ? payload.dependencies : [];

    // Create the plan in the target workspace
    const [newPlan] = await db.insert(plans).values({
      title: title || planMeta.title || blueprint.title,
      description: planMeta.description ?? blueprint.description ?? null,
      ownerId,
      organizationId: ws.organizationId,
      workspaceId: ws.id,
      status: 'draft',
      visibility: 'private',
      forkedFromBlueprintId: blueprintId,
      forkedAt: new Date(),
      metadata: {
        forked_from_blueprint: blueprintId,
        blueprint_title: blueprint.title,
        forked_at: new Date().toISOString(),
      },
    }).returning();

    if (nodes.length === 0) {
      await this.incrementForkCount(blueprintId);
      return newPlan;
    }

    // Two-pass insert so parent_key references resolve regardless of order
    const keyToId = new Map();

    // Pass 1: insert with null parent_id, build key→id map
    for (const n of nodes) {
      const [created] = await db.insert(planNodes).values({
        planId: newPlan.id,
        parentId: null,
        nodeType: n.node_type || 'task',
        title: n.title,
        description: n.description ?? null,
        status: 'not_started',
        orderIndex: n.order_index ?? 0,
        context: n.context ?? null,
        agentInstructions: n.agent_instructions ?? null,
        taskMode: n.task_mode ?? 'free',
        metadata: { forked_from_blueprint: blueprintId, blueprint_node_key: n.key },
      }).returning();
      keyToId.set(n.key, created.id);
    }

    // Pass 2: patch parent_id from parent_key
    for (const n of nodes) {
      if (!n.parent_key) continue;
      const childId = keyToId.get(n.key);
      const parentId = keyToId.get(n.parent_key);
      if (childId && parentId) {
        await db.update(planNodes)
          .set({ parentId })
          .where(eq(planNodes.id, childId));
      }
    }

    // Dependencies
    for (const d of dependencies) {
      const sourceId = keyToId.get(d.source_key);
      const targetId = keyToId.get(d.target_key);
      if (!sourceId || !targetId) continue;
      try {
        await db.insert(nodeDependencies).values({
          // node_dependencies has no plan_id column; the plan is implied by source_node_id
          sourceNodeId: sourceId,
          targetNodeId: targetId,
          dependencyType: d.dependency_type || 'blocks',
        });
      } catch {
        // skip individual edge errors; don't tank the whole fork
      }
    }

    await this.incrementForkCount(blueprintId);
    return newPlan;
  },
};
