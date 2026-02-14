import { eq, and, isNull, isNotNull, asc, sql, inArray, ilike, or, gte, lte, desc, ne } from 'drizzle-orm';
import { db } from '../connection.mjs';
import { planNodes } from '../schema/plans.mjs';

export const nodesDal = {
  async findById(id) {
    const [node] = await db.select().from(planNodes).where(eq(planNodes.id, id)).limit(1);
    return node ?? null;
  },

  async create(data) {
    const [node] = await db.insert(planNodes).values(data).returning();
    return node;
  },

  async update(id, data) {
    const [node] = await db.update(planNodes)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(planNodes.id, id))
      .returning();
    return node ?? null;
  },

  async delete(id) {
    const [node] = await db.delete(planNodes).where(eq(planNodes.id, id)).returning();
    return node ?? null;
  },

  /**
   * Get all nodes for a plan (flat list, caller builds tree)
   */
  async listByPlan(planId) {
    return db.select().from(planNodes)
      .where(eq(planNodes.planId, planId))
      .orderBy(asc(planNodes.orderIndex));
  },

  /**
   * Get direct children of a node
   */
  async getChildren(parentId) {
    return db.select().from(planNodes)
      .where(eq(planNodes.parentId, parentId))
      .orderBy(asc(planNodes.orderIndex));
  },

  /**
   * Get root node for a plan
   */
  async getRoot(planId) {
    const [root] = await db.select().from(planNodes)
      .where(and(eq(planNodes.planId, planId), eq(planNodes.nodeType, 'root')))
      .limit(1);
    return root ?? null;
  },

  /**
   * Build hierarchical tree from flat list
   */
  buildTree(nodes) {
    const map = new Map();
    const roots = [];

    for (const node of nodes) {
      map.set(node.id, { ...node, children: [] });
    }

    for (const node of nodes) {
      const item = map.get(node.id);
      if (node.parentId && map.has(node.parentId)) {
        map.get(node.parentId).children.push(item);
      } else {
        roots.push(item);
      }
    }

    return roots;
  },

  /**
   * Get nodes with tree structure
   */
  async getTree(planId) {
    const nodes = await this.listByPlan(planId);
    return this.buildTree(nodes);
  },

  /**
   * Update status with timestamp tracking
   */
  async updateStatus(id, status) {
    return this.update(id, { status });
  },

  /**
   * Set agent request on a node
   */
  async setAgentRequest(id, { type, message, requestedBy }) {
    return this.update(id, {
      agentRequested: type,
      agentRequestMessage: message,
      agentRequestedBy: requestedBy,
      agentRequestedAt: new Date(),
    });
  },

  /**
   * Clear agent request
   */
  async clearAgentRequest(id) {
    return this.update(id, {
      agentRequested: null,
      agentRequestMessage: null,
      agentRequestedBy: null,
      agentRequestedAt: null,
    });
  },

  /**
   * Assign agent to node
   */
  async assignAgent(id, { agentId, assignedBy }) {
    return this.update(id, {
      assignedAgentId: agentId,
      assignedAgentBy: assignedBy,
      assignedAgentAt: new Date(),
    });
  },

  /**
   * Get nodes with pending agent requests for a user
   */
  async getRequestedTasks(userId) {
    return db.select().from(planNodes)
      .where(and(
        eq(planNodes.assignedAgentId, userId),
        sql`${planNodes.agentRequested} IS NOT NULL`
      ));
  },

  /**
   * Reorder nodes within a parent
   */
  async reorder(nodeId, newIndex) {
    const node = await this.findById(nodeId);
    if (!node) return null;

    // Get siblings
    const siblings = node.parentId
      ? await this.getChildren(node.parentId)
      : await db.select().from(planNodes)
          .where(and(eq(planNodes.planId, node.planId), isNull(planNodes.parentId)))
          .orderBy(asc(planNodes.orderIndex));

    // Remove node from current position
    const filtered = siblings.filter(s => s.id !== nodeId);
    filtered.splice(newIndex, 0, node);

    // Update all order indexes
    for (let i = 0; i < filtered.length; i++) {
      if (filtered[i].orderIndex !== i) {
        await db.update(planNodes)
          .set({ orderIndex: i })
          .where(eq(planNodes.id, filtered[i].id));
      }
    }

    return this.findById(nodeId);
  },

  /**
   * Move node to new parent
   */
  async move(nodeId, newParentId) {
    // Get max order_index of new parent's children
    const children = await this.getChildren(newParentId);
    const maxIndex = children.length > 0
      ? Math.max(...children.map(c => c.orderIndex)) + 1
      : 0;

    return this.update(nodeId, {
      parentId: newParentId,
      orderIndex: maxIndex,
    });
  },

  /**
   * Delete a node and all its descendants (cascades via FK)
   */
  async deleteWithChildren(id) {
    return this.delete(id); // FK cascade handles children
  },

  /**
   * Get unique assigned agent IDs for a plan
   */
  /**
   * Count nodes matching filters
   */
  async countByPlan(planId, { nodeType, status, since } = {}) {
    const conditions = [eq(planNodes.planId, planId)];
    if (nodeType) conditions.push(eq(planNodes.nodeType, nodeType));
    if (status) conditions.push(eq(planNodes.status, status));
    if (since) conditions.push(gte(planNodes.updatedAt, since));

    const result = await db.select({ count: sql`count(*)::int` })
      .from(planNodes)
      .where(and(...conditions));
    return result[0]?.count ?? 0;
  },

  /**
   * Search nodes with filters
   */
  async search(planId, { query, status, nodeType, dateFrom, dateTo } = {}) {
    const conditions = [eq(planNodes.planId, planId)];
    if (query) {
      conditions.push(or(
        ilike(planNodes.title, `%${query}%`),
        ilike(planNodes.description, `%${query}%`),
        ilike(planNodes.context, `%${query}%`),
        ilike(planNodes.agentInstructions, `%${query}%`),
      ));
    }
    if (status) {
      const statuses = status.split(',');
      conditions.push(inArray(planNodes.status, statuses));
    }
    if (nodeType) {
      const types = nodeType.split(',');
      conditions.push(inArray(planNodes.nodeType, types));
    }
    if (dateFrom) conditions.push(gte(planNodes.createdAt, new Date(dateFrom)));
    if (dateTo) conditions.push(lte(planNodes.createdAt, new Date(dateTo)));

    return db.select().from(planNodes)
      .where(and(...conditions))
      .orderBy(desc(planNodes.createdAt));
  },

  /**
   * Find node by id and plan id
   */
  async findByIdAndPlan(nodeId, planId) {
    const [node] = await db.select().from(planNodes)
      .where(and(eq(planNodes.id, nodeId), eq(planNodes.planId, planId)))
      .limit(1);
    return node ?? null;
  },

  /**
   * List nodes by multiple plan IDs with optional filters
   */
  async listByPlanIds(planIds, { nodeType, status, agentRequested, agentRequestedBy, limit: lim = 50 } = {}) {
    if (planIds.length === 0) return [];
    const conditions = [inArray(planNodes.planId, planIds)];
    if (nodeType) {
      const types = Array.isArray(nodeType) ? nodeType : [nodeType];
      conditions.push(inArray(planNodes.nodeType, types));
    }
    if (status) conditions.push(eq(planNodes.status, status));
    if (agentRequested) conditions.push(isNotNull(planNodes.agentRequested));
    if (agentRequestedBy) conditions.push(eq(planNodes.agentRequestedBy, agentRequestedBy));

    return db.select().from(planNodes)
      .where(and(...conditions))
      .orderBy(desc(planNodes.updatedAt))
      .limit(lim);
  },

  async deleteByIds(ids) {
    if (ids.length === 0) return;
    return db.delete(planNodes).where(inArray(planNodes.id, ids));
  },

  /**
   * Get max order_index among siblings, excluding a specific node
   */
  async getMaxSiblingOrder(planId, parentId, excludeNodeId = null) {
    const conditions = [eq(planNodes.planId, planId), eq(planNodes.parentId, parentId)];
    if (excludeNodeId) conditions.push(ne(planNodes.id, excludeNodeId));
    const [result] = await db.select({ max: sql`coalesce(max(${planNodes.orderIndex}), -1)` })
      .from(planNodes)
      .where(and(...conditions));
    return result?.max ?? -1;
  },

  /**
   * List nodes with specific columns (for minimal/full field selection)
   */
  async listByPlanWithFields(planId, fields) {
    // Returns all columns; caller can pick what to expose
    return this.listByPlan(planId);
  },

  async getAssignedAgentIds(planId) {
    const result = await db.select({ assignedAgentId: planNodes.assignedAgentId })
      .from(planNodes)
      .where(and(
        eq(planNodes.planId, planId),
        isNotNull(planNodes.assignedAgentId)
      ));
    
    return result.map(r => r.assignedAgentId).filter(id => id !== null);
  },
};
