import { eq, and, desc, inArray, isNull, sql } from 'drizzle-orm';
import { db } from '../connection.mjs';
import { sql as rawSql } from '../connection.mjs';
import { goals, goalLinks, goalEvaluations } from '../schema/goals.mjs';
import { users } from '../schema/users.mjs';
import { dependenciesDal } from './dependencies.dal.mjs';

export const goalsDal = {
  // ─── Core CRUD ─────────────────────────────────────────────────

  async findAll({ organizationId, userId } = {}, filters = {}) {
    const whereClause = organizationId
      ? eq(goals.organizationId, organizationId)
      : and(eq(goals.ownerId, userId), isNull(goals.organizationId));

    const rows = await db
      .select({
        id: goals.id,
        title: goals.title,
        description: goals.description,
        ownerId: goals.ownerId,
        organizationId: goals.organizationId,
        type: goals.type,
        status: goals.status,
        goalType: goals.goalType,
        promotedAt: goals.promotedAt,
        coherenceCheckedAt: goals.coherenceCheckedAt,
        successCriteria: goals.successCriteria,
        priority: goals.priority,
        parentGoalId: goals.parentGoalId,
        createdAt: goals.createdAt,
        updatedAt: goals.updatedAt,
        ownerName: users.name,
      })
      .from(goals)
      .leftJoin(users, eq(users.id, goals.ownerId))
      .where(whereClause)
      .orderBy(desc(goals.priority), desc(goals.createdAt));

    return rows.filter(r => {
      if (filters.status && r.status !== filters.status) return false;
      if (filters.type && r.type !== filters.type) return false;
      return true;
    });
  },

  async findById(id) {
    const rows = await rawSql`
      SELECT g.*, u.name AS owner_name, u.email AS owner_email
      FROM goals g
      LEFT JOIN users u ON u.id = g.owner_id
      WHERE g.id = ${id}
      LIMIT 1
    `;
    const goal = rows[0];
    if (!goal) return null;

    // Map snake_case to camelCase
    const mapped = {
      id: goal.id,
      title: goal.title,
      description: goal.description,
      ownerId: goal.owner_id,
      organizationId: goal.organization_id,
      type: goal.type,
      status: goal.status,
      goalType: goal.goal_type,
      promotedAt: goal.promoted_at,
      coherenceCheckedAt: goal.coherence_checked_at,
      successCriteria: goal.success_criteria,
      priority: goal.priority,
      parentGoalId: goal.parent_goal_id,
      createdAt: goal.created_at,
      updatedAt: goal.updated_at,
      ownerName: goal.owner_name,
      ownerEmail: goal.owner_email,
    };

    const links = await db.select().from(goalLinks).where(eq(goalLinks.goalId, id));
    const evals = await db.select().from(goalEvaluations)
      .where(eq(goalEvaluations.goalId, id))
      .orderBy(desc(goalEvaluations.evaluatedAt))
      .limit(10);

    return { ...mapped, links, evaluations: evals };
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

  async getTree({ organizationId, userId } = {}) {
    const whereClause = organizationId
      ? eq(goals.organizationId, organizationId)
      : and(eq(goals.ownerId, userId), isNull(goals.organizationId));

    const all = await db
      .select({
        id: goals.id,
        title: goals.title,
        description: goals.description,
        ownerId: goals.ownerId,
        organizationId: goals.organizationId,
        type: goals.type,
        status: goals.status,
        goalType: goals.goalType,
        promotedAt: goals.promotedAt,
        coherenceCheckedAt: goals.coherenceCheckedAt,
        successCriteria: goals.successCriteria,
        priority: goals.priority,
        parentGoalId: goals.parentGoalId,
        createdAt: goals.createdAt,
        updatedAt: goals.updatedAt,
        ownerName: users.name,
      })
      .from(goals)
      .leftJoin(users, eq(users.id, goals.ownerId))
      .where(whereClause)
      .orderBy(desc(goals.priority));

    // Bulk-load links + evaluations + progress per goal so the UI list
    // (Goals index, Mission Control) can render plan counts, quality scores,
    // and progress bars without N+1 follow-up calls per row.
    const goalIds = all.map(g => g.id);
    const linksByGoal = new Map();
    const evalsByGoal = new Map();
    let statsByGoal = new Map();
    let densityByGoal = new Map();
    if (goalIds.length) {
      const linksRows = await db
        .select()
        .from(goalLinks)
        .where(inArray(goalLinks.goalId, goalIds));
      for (const l of linksRows) {
        const arr = linksByGoal.get(l.goalId) || [];
        arr.push(l);
        linksByGoal.set(l.goalId, arr);
      }
      const evalsRows = await db
        .select()
        .from(goalEvaluations)
        .where(inArray(goalEvaluations.goalId, goalIds))
        .orderBy(desc(goalEvaluations.evaluatedAt));
      for (const e of evalsRows) {
        const arr = evalsByGoal.get(e.goalId) || [];
        arr.push(e);
        evalsByGoal.set(e.goalId, arr);
      }
      try {
        statsByGoal = await dependenciesDal.getDirectStatsByGoalIds(goalIds);
      } catch (err) {
        // Progress aggregation is best-effort — degrade to empty stats so
        // the rest of the tree response still renders.
        statsByGoal = new Map();
      }
      try {
        densityByGoal = await dependenciesDal.getActivityDensityByGoalIds(goalIds, 10);
      } catch (err) {
        densityByGoal = new Map();
      }
    }

    // Build tree in memory
    const emptyStats = {
      total: 0,
      completed: 0,
      in_progress: 0,
      blocked: 0,
      not_started: 0,
      completion_percentage: 0,
    };
    const map = new Map();
    all.forEach(g =>
      map.set(g.id, {
        ...g,
        links: linksByGoal.get(g.id) || [],
        evaluations: evalsByGoal.get(g.id) || [],
        progress: statsByGoal.get(g.id) || { ...emptyStats },
        density: densityByGoal.get(g.id) || new Array(10).fill(0),
        children: [],
      }),
    );

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

  /**
   * List goal IDs that have a 'plan' link pointing to the given planId.
   * Used by the createNode cascade so a freshly added task in a linked
   * plan gets achiever edges for every goal already pointing at the plan.
   */
  async listGoalsLinkedToPlan(planId) {
    const rows = await db
      .select({ goalId: goalLinks.goalId })
      .from(goalLinks)
      .where(and(eq(goalLinks.linkedType, 'plan'), eq(goalLinks.linkedId, planId)));
    return rows.map(r => r.goalId);
  },

  /**
   * Bulk: for a set of plan ids, return [{plan_id, goal_id, goal_title}].
   * Powers the Plans Index "goal tether" chip — one query for the whole
   * page rather than N+1 lookups.
   */
  async listGoalTethersForPlanIds(planIds) {
    if (!Array.isArray(planIds) || planIds.length === 0) return [];
    const rows = await db
      .select({
        plan_id: goalLinks.linkedId,
        goal_id: goalLinks.goalId,
        goal_title: goals.title,
      })
      .from(goalLinks)
      .innerJoin(goals, eq(goalLinks.goalId, goals.id))
      .where(and(eq(goalLinks.linkedType, 'plan'), inArray(goalLinks.linkedId, planIds)));
    return rows;
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

  async getActiveGoals({ organizationId, userId } = {}) {
    const whereClause = organizationId
      ? and(eq(goals.organizationId, organizationId), eq(goals.status, 'active'))
      : and(eq(goals.ownerId, userId), isNull(goals.organizationId), eq(goals.status, 'active'));

    return db.select().from(goals)
      .where(whereClause)
      .orderBy(desc(goals.priority));
  },

  // Keep old name as alias for backward compatibility
  async getActiveGoalsForOwner(ownerId) {
    return this.getActiveGoals({ userId: ownerId });
  },

  // ─── Dashboard ────────────────────────────────────────────────

  /**
   * Get dashboard data for goals scoped to an organization or user.
   *
   * @param {{ organizationId?: string, userId: string }} params
   * @returns {Array} goals with plan_stats, last_activity, and owner_name
   */
  async getDashboardData({ organizationId, userId } = {}) {
    const filterClause = organizationId
      ? rawSql`g.organization_id = ${organizationId}`
      : rawSql`g.owner_id = ${userId} AND g.organization_id IS NULL`;

    const rows = await rawSql`
      WITH user_goals AS (
        SELECT g.id, g.title, g.description, g.type, g.goal_type, g.status, g.priority,
               g.created_at, g.updated_at, g.owner_id,
               u.name AS owner_name
        FROM goals g
        LEFT JOIN users u ON u.id = g.owner_id
        WHERE ${filterClause}
          AND g.status = 'active'
      ),
      linked_plans AS (
        SELECT gl.goal_id,
               gl.linked_id AS plan_id
        FROM goal_links gl
        INNER JOIN user_goals ug ON ug.id = gl.goal_id
        WHERE gl.linked_type = 'plan'
      ),
      plan_node_stats AS (
        SELECT lp.goal_id,
               lp.plan_id,
               COUNT(*) FILTER (WHERE pn.node_type IN ('task', 'milestone')) AS total_nodes,
               COUNT(*) FILTER (WHERE pn.node_type IN ('task', 'milestone') AND pn.status = 'completed') AS completed_nodes,
               COUNT(*) FILTER (WHERE pn.node_type IN ('task', 'milestone') AND pn.status = 'blocked') AS blocked_nodes,
               COUNT(*) FILTER (WHERE pn.node_type IN ('task', 'milestone') AND pn.status = 'plan_ready') AS plan_ready_nodes,
               COUNT(*) FILTER (WHERE pn.node_type IN ('task', 'milestone') AND pn.agent_requested IS NOT NULL) AS agent_request_nodes,
               COUNT(*) FILTER (WHERE pn.node_type IN ('task', 'milestone') AND pn.status = 'plan_ready'
                                  AND pn.updated_at < NOW() - INTERVAL '1 day') AS stale_plan_ready_nodes,
               COUNT(*) FILTER (WHERE pn.node_type IN ('task', 'milestone') AND pn.agent_requested IS NOT NULL
                                  AND pn.agent_requested_at < NOW() - INTERVAL '1 day') AS stale_agent_request_nodes
        FROM linked_plans lp
        INNER JOIN plan_nodes pn ON pn.plan_id = lp.plan_id
        GROUP BY lp.goal_id, lp.plan_id
      ),
      last_log_activity AS (
        SELECT lp.goal_id,
               MAX(pnl.created_at) AS last_log_at
        FROM linked_plans lp
        INNER JOIN plan_nodes pn ON pn.plan_id = lp.plan_id
        INNER JOIN plan_node_logs pnl ON pnl.plan_node_id = pn.id
        GROUP BY lp.goal_id
      ),
      goal_aggregates AS (
        SELECT pns.goal_id,
               COALESCE(SUM(pns.total_nodes), 0)::int AS total_nodes,
               COALESCE(SUM(pns.completed_nodes), 0)::int AS completed_nodes,
               COALESCE(SUM(pns.blocked_nodes), 0)::int AS blocked_nodes,
               COALESCE(SUM(pns.plan_ready_nodes), 0)::int AS plan_ready_nodes,
               COALESCE(SUM(pns.agent_request_nodes), 0)::int AS agent_request_nodes,
               COALESCE(SUM(pns.stale_plan_ready_nodes), 0)::int AS stale_plan_ready_nodes,
               COALESCE(SUM(pns.stale_agent_request_nodes), 0)::int AS stale_agent_request_nodes,
               COUNT(DISTINCT pns.plan_id)::int AS linked_plan_count,
               json_agg(DISTINCT pns.plan_id) AS plan_ids
        FROM plan_node_stats pns
        GROUP BY pns.goal_id
      )
      SELECT ug.id, ug.title, ug.description, ug.type, ug.goal_type, ug.status, ug.priority,
             ug.created_at, ug.updated_at, ug.owner_name,
             COALESCE(ga.total_nodes, 0)::int AS total_nodes,
             COALESCE(ga.completed_nodes, 0)::int AS completed_nodes,
             COALESCE(ga.blocked_nodes, 0)::int AS blocked_nodes,
             COALESCE(ga.plan_ready_nodes, 0)::int AS plan_ready_nodes,
             COALESCE(ga.agent_request_nodes, 0)::int AS agent_request_nodes,
             COALESCE(ga.stale_plan_ready_nodes, 0)::int AS stale_plan_ready_nodes,
             COALESCE(ga.stale_agent_request_nodes, 0)::int AS stale_agent_request_nodes,
             COALESCE(ga.linked_plan_count, 0)::int AS linked_plan_count,
             COALESCE(ga.plan_ids, '[]'::json) AS plan_ids,
             lla.last_log_at
      FROM user_goals ug
      LEFT JOIN goal_aggregates ga ON ga.goal_id = ug.id
      LEFT JOIN last_log_activity lla ON lla.goal_id = ug.id
      ORDER BY ug.priority DESC, ug.created_at DESC
    `;
    return rows;
  },

  // ─── BDI Desire/Intention ───────────────────────────────────────

  async promote(id) {
    return this.update(id, { goalType: 'intention', promotedAt: new Date() });
  },

  async getDescendants(goalId) {
    const rows = await rawSql`
      WITH RECURSIVE descendants AS (
        SELECT * FROM goals WHERE parent_goal_id = ${goalId}
        UNION ALL
        SELECT g.* FROM goals g
        JOIN descendants d ON g.parent_goal_id = d.id
      )
      SELECT * FROM descendants ORDER BY priority DESC, created_at DESC
    `;
    return rows.map(g => ({
      id: g.id,
      title: g.title,
      description: g.description,
      ownerId: g.owner_id,
      organizationId: g.organization_id,
      type: g.type,
      status: g.status,
      goalType: g.goal_type,
      promotedAt: g.promoted_at,
      coherenceCheckedAt: g.coherence_checked_at,
      successCriteria: g.success_criteria,
      priority: g.priority,
      parentGoalId: g.parent_goal_id,
      createdAt: g.created_at,
      updatedAt: g.updated_at,
    }));
  },
};
