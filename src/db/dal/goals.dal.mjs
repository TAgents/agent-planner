import { eq, and, desc, inArray, isNull } from 'drizzle-orm';
import { db } from '../connection.mjs';
import { goals, goalLinks, goalEvaluations } from '../schema/goals.mjs';

export const goalsDal = {
  // ─── Core CRUD ─────────────────────────────────────────────────

  async findAll(ownerId, filters = {}) {
    let query = db.select().from(goals).where(eq(goals.ownerId, ownerId));
    // Filters applied post-query for simplicity (drizzle dynamic where is verbose)
    const rows = await query.orderBy(desc(goals.priority), desc(goals.createdAt));
    return rows.filter(r => {
      if (filters.status && r.status !== filters.status) return false;
      if (filters.type && r.type !== filters.type) return false;
      return true;
    });
  },

  async findById(id) {
    const [goal] = await db.select().from(goals).where(eq(goals.id, id)).limit(1);
    if (!goal) return null;

    const links = await db.select().from(goalLinks).where(eq(goalLinks.goalId, id));
    const evals = await db.select().from(goalEvaluations)
      .where(eq(goalEvaluations.goalId, id))
      .orderBy(desc(goalEvaluations.evaluatedAt))
      .limit(10);

    return { ...goal, links, evaluations: evals };
  },

  async create(data) {
    const [goal] = await db.insert(goals).values(data).returning();
    return goal;
  },

  async update(id, data) {
    const [goal] = await db.update(goals)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(goals.id, id))
      .returning();
    return goal ?? null;
  },

  async softDelete(id) {
    return this.update(id, { status: 'abandoned' });
  },

  // ─── Hierarchy ─────────────────────────────────────────────────

  async getTree(ownerId) {
    const all = await db.select().from(goals)
      .where(eq(goals.ownerId, ownerId))
      .orderBy(desc(goals.priority));

    // Build tree in memory
    const map = new Map();
    all.forEach(g => map.set(g.id, { ...g, children: [] }));

    const roots = [];
    all.forEach(g => {
      const node = map.get(g.id);
      if (g.parentGoalId && map.has(g.parentGoalId)) {
        map.get(g.parentGoalId).children.push(node);
      } else {
        roots.push(node);
      }
    });

    return roots;
  },

  // ─── Links ─────────────────────────────────────────────────────

  async addLink(goalId, linkedType, linkedId) {
    const [link] = await db.insert(goalLinks)
      .values({ goalId, linkedType, linkedId })
      .onConflictDoNothing()
      .returning();
    return link;
  },

  async removeLink(linkId) {
    const [link] = await db.delete(goalLinks)
      .where(eq(goalLinks.id, linkId))
      .returning();
    return link ?? null;
  },

  async getLinkedGoals(linkedType, linkedId) {
    const links = await db.select({ goalId: goalLinks.goalId })
      .from(goalLinks)
      .where(and(eq(goalLinks.linkedType, linkedType), eq(goalLinks.linkedId, linkedId)));

    if (links.length === 0) return [];
    const goalIds = links.map(l => l.goalId);
    return db.select().from(goals).where(inArray(goals.id, goalIds));
  },

  // ─── Evaluations ──────────────────────────────────────────────

  async addEvaluation(goalId, data) {
    const [evaluation] = await db.insert(goalEvaluations)
      .values({ goalId, ...data })
      .returning();
    return evaluation;
  },

  async getEvaluations(goalId) {
    return db.select().from(goalEvaluations)
      .where(eq(goalEvaluations.goalId, goalId))
      .orderBy(desc(goalEvaluations.evaluatedAt));
  },

  // ─── Helpers for agent injection ──────────────────────────────

  async getActiveGoalsForOwner(ownerId) {
    return db.select().from(goals)
      .where(and(eq(goals.ownerId, ownerId), eq(goals.status, 'active')))
      .orderBy(desc(goals.priority));
  },
};
