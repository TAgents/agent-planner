import { eq, and, isNull, isNotNull, inArray, sql } from 'drizzle-orm';
import { db } from '../connection.mjs';
import { nodeDependencies } from '../schema/dependencies.mjs';
import { planNodes } from '../schema/plans.mjs';
import { goals } from '../schema/goals.mjs';

/**
 * Build a Postgres array literal for use in ANY() clauses.
 * Sanitizes values to prevent SQL injection.
 */
function pgArray(values) {
  const safe = values.map(v => v.replace(/'/g, "''"));
  return sql.raw(`ARRAY['${safe.join("','")}']::text[]`);
}

export const dependenciesDal = {
  async findById(id) {
    const [dep] = await db.select().from(nodeDependencies).where(eq(nodeDependencies.id, id)).limit(1);
    return dep ?? null;
  },

  async create(data) {
    const [dep] = await db.insert(nodeDependencies).values(data).returning();
    return dep;
  },

  async update(id, data) {
    const [dep] = await db.update(nodeDependencies)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(nodeDependencies.id, id))
      .returning();
    return dep ?? null;
  },

  async delete(id) {
    const [dep] = await db.delete(nodeDependencies).where(eq(nodeDependencies.id, id)).returning();
    return dep ?? null;
  },

  /**
   * List all dependencies for a node (both directions)
   * @param {string} nodeId
   * @param {'upstream'|'downstream'|'both'} direction
   */
  async listByNode(nodeId, direction = 'both') {
    if (direction === 'upstream') {
      // Edges where this node is the TARGET (what blocks me)
      return db.select({
        dependency: nodeDependencies,
        node: planNodes,
      })
        .from(nodeDependencies)
        .innerJoin(planNodes, eq(nodeDependencies.sourceNodeId, planNodes.id))
        .where(eq(nodeDependencies.targetNodeId, nodeId));
    }
    if (direction === 'downstream') {
      // Edges where this node is the SOURCE (what I block)
      return db.select({
        dependency: nodeDependencies,
        node: planNodes,
      })
        .from(nodeDependencies)
        .innerJoin(planNodes, eq(nodeDependencies.targetNodeId, planNodes.id))
        .where(eq(nodeDependencies.sourceNodeId, nodeId));
    }
    // Both directions
    const [upstream, downstream] = await Promise.all([
      this.listByNode(nodeId, 'upstream'),
      this.listByNode(nodeId, 'downstream'),
    ]);
    return { upstream, downstream };
  },

  /**
   * List all dependency edges in a plan
   */
  async listByPlan(planId) {
    return db.select({
      dependency: nodeDependencies,
      sourceNode: planNodes,
    })
      .from(nodeDependencies)
      .innerJoin(planNodes, eq(nodeDependencies.sourceNodeId, planNodes.id))
      .where(eq(planNodes.planId, planId));
  },

  /**
   * Cycle detection via recursive CTE.
   * Returns true if adding an edge from sourceId→targetId would create a cycle.
   */
  async wouldCreateCycle(sourceId, targetId, types = ['blocks', 'requires']) {
    const typesArr = pgArray(types);
    const result = await db.execute(sql`
      WITH RECURSIVE reachable AS (
        SELECT target_node_id AS node_id, ARRAY[${targetId}::uuid, target_node_id] AS path
        FROM node_dependencies
        WHERE source_node_id = ${targetId}
          AND dependency_type = ANY(${typesArr})
        UNION
        SELECT nd.target_node_id, r.path || nd.target_node_id
        FROM node_dependencies nd
        JOIN reachable r ON nd.source_node_id = r.node_id
        WHERE nd.dependency_type = ANY(${typesArr})
          AND NOT nd.target_node_id = ANY(r.path)
      )
      SELECT path FROM reachable WHERE node_id = ${sourceId} LIMIT 1
    `);
    if (result.length > 0) {
      return { hasCycle: true, cyclePath: result[0].path };
    }
    return { hasCycle: false, cyclePath: null };
  },

  /**
   * Get all upstream (ancestor) nodes via recursive CTE.
   * @param {string} nodeId - Starting node
   * @param {number} maxDepth - Max traversal depth
   * @param {string[]} types - Edge types to follow
   */
  async getUpstream(nodeId, maxDepth = 10, types = ['blocks', 'requires']) {
    const typesArr = pgArray(types);
    const result = await db.execute(sql`
      WITH RECURSIVE upstream AS (
        SELECT
          nd.source_node_id AS node_id,
          nd.dependency_type,
          nd.weight,
          1 AS depth
        FROM node_dependencies nd
        WHERE nd.target_node_id = ${nodeId}
          AND nd.dependency_type = ANY(${typesArr})
        UNION
        SELECT
          nd.source_node_id,
          nd.dependency_type,
          nd.weight,
          u.depth + 1
        FROM node_dependencies nd
        JOIN upstream u ON nd.target_node_id = u.node_id
        WHERE u.depth < ${maxDepth}
          AND nd.dependency_type = ANY(${typesArr})
      )
      SELECT
        u.node_id, u.dependency_type, u.weight, u.depth,
        pn.title, pn.status, pn.node_type, pn.task_mode, pn.plan_id
      FROM upstream u
      JOIN plan_nodes pn ON pn.id = u.node_id
      ORDER BY u.depth ASC
    `);
    return result;
  },

  /**
   * Get all downstream (dependent) nodes via recursive CTE.
   */
  async getDownstream(nodeId, maxDepth = 10, types = ['blocks', 'requires']) {
    const typesArr = pgArray(types);
    const result = await db.execute(sql`
      WITH RECURSIVE downstream AS (
        SELECT
          nd.target_node_id AS node_id,
          nd.dependency_type,
          nd.weight,
          1 AS depth
        FROM node_dependencies nd
        WHERE nd.source_node_id = ${nodeId}
          AND nd.dependency_type = ANY(${typesArr})
        UNION
        SELECT
          nd.target_node_id,
          nd.dependency_type,
          nd.weight,
          d.depth + 1
        FROM node_dependencies nd
        JOIN downstream d ON nd.source_node_id = d.node_id
        WHERE d.depth < ${maxDepth}
          AND nd.dependency_type = ANY(${typesArr})
      )
      SELECT
        d.node_id, d.dependency_type, d.weight, d.depth,
        pn.title, pn.status, pn.node_type, pn.task_mode, pn.plan_id
      FROM downstream d
      JOIN plan_nodes pn ON pn.id = d.node_id
      ORDER BY d.depth ASC
    `);
    return result;
  },

  /**
   * Create multiple edges atomically with cycle detection.
   */
  async bulkCreate(edges) {
    return db.transaction(async (tx) => {
      const created = [];
      for (const edge of edges) {
        // Check cycle for each edge sequentially (order matters)
        const { hasCycle, cyclePath } = await this.wouldCreateCycle(edge.sourceNodeId, edge.targetNodeId);
        if (hasCycle) {
          throw new Error(`Cycle detected: ${cyclePath.join(' → ')}`);
        }
        const [dep] = await tx.insert(nodeDependencies).values(edge).returning();
        created.push(dep);
      }
      return created;
    });
  },

  /**
   * Impact analysis — given a node, find all downstream nodes that would be
   * affected if this node is delayed/blocked/removed.
   * Returns nodes grouped by impact severity (direct = depth 1, transitive = depth > 1).
   */
  async getImpact(nodeId, scenario = 'block', maxDepth = 20) {
    const types = scenario === 'remove'
      ? ['blocks', 'requires', 'relates_to']
      : ['blocks', 'requires'];
    const typesArr = pgArray(types);

    const result = await db.execute(sql`
      WITH RECURSIVE impact AS (
        SELECT
          nd.target_node_id AS node_id,
          nd.dependency_type,
          nd.weight,
          1 AS depth,
          ARRAY[${nodeId}::uuid, nd.target_node_id] AS path
        FROM node_dependencies nd
        WHERE nd.source_node_id = ${nodeId}
          AND nd.dependency_type = ANY(${typesArr})
        UNION
        SELECT
          nd.target_node_id,
          nd.dependency_type,
          nd.weight,
          i.depth + 1,
          i.path || nd.target_node_id
        FROM node_dependencies nd
        JOIN impact i ON nd.source_node_id = i.node_id
        WHERE i.depth < ${maxDepth}
          AND nd.dependency_type = ANY(${typesArr})
          AND NOT nd.target_node_id = ANY(i.path)
      )
      SELECT DISTINCT ON (i.node_id)
        i.node_id, i.dependency_type, i.weight, i.depth,
        pn.title, pn.status, pn.node_type, pn.task_mode, pn.plan_id,
        CASE WHEN i.depth = 1 THEN 'direct' ELSE 'transitive' END AS severity
      FROM impact i
      JOIN plan_nodes pn ON pn.id = i.node_id
      WHERE pn.status NOT IN ('completed')
      ORDER BY i.node_id, i.depth ASC
    `);
    return result;
  },

  /**
   * Critical path — find the longest chain of 'blocks' edges
   * through incomplete nodes in a plan.
   * Uses topological ordering + longest path via recursive CTE.
   */
  async getCriticalPath(planId) {
    const result = await db.execute(sql`
      WITH RECURSIVE plan_deps AS (
        SELECT nd.*
        FROM node_dependencies nd
        JOIN plan_nodes pn ON pn.id = nd.source_node_id
        WHERE pn.plan_id = ${planId}
          AND nd.dependency_type = 'blocks'
          AND pn.status != 'completed'
      ),
      -- Find all source nodes in plan that have no upstream blockers (roots of the DAG)
      roots AS (
        SELECT DISTINCT pn.id AS node_id
        FROM plan_nodes pn
        LEFT JOIN plan_deps pd ON pd.target_node_id = pn.id
        WHERE pn.plan_id = ${planId}
          AND pn.status != 'completed'
          AND pn.node_type != 'root'
          AND pd.id IS NULL
          AND EXISTS (SELECT 1 FROM plan_deps pd2 WHERE pd2.source_node_id = pn.id)
      ),
      longest AS (
        SELECT
          r.node_id,
          pd.weight AS total_weight,
          ARRAY[r.node_id] AS path
        FROM roots r
        JOIN plan_deps pd ON pd.source_node_id = r.node_id
        UNION ALL
        SELECT
          pd.target_node_id,
          l.total_weight + pd.weight,
          l.path || pd.target_node_id
        FROM longest l
        JOIN plan_deps pd ON pd.source_node_id = l.node_id
        WHERE NOT pd.target_node_id = ANY(l.path)
      )
      SELECT
        l.path,
        l.total_weight,
        array_length(l.path, 1) AS chain_length
      FROM longest l
      ORDER BY l.total_weight DESC, chain_length DESC
      LIMIT 1
    `);

    if (!result.length) return { path: [], total_weight: 0, nodes: [] };

    const { path: nodePath, total_weight } = result[0];

    // Fetch node details for the critical path
    if (!nodePath || nodePath.length === 0) return { path: [], total_weight: 0, nodes: [] };

    const nodeDetails = await db.execute(sql`
      SELECT id, title, status, node_type, task_mode
      FROM plan_nodes
      WHERE id = ANY(${sql.raw(`ARRAY['${nodePath.join("','")}']::uuid[]`)})
    `);

    // Preserve path order
    const nodeMap = new Map(nodeDetails.map(n => [n.id, n]));
    const orderedNodes = nodePath.map(id => nodeMap.get(id)).filter(Boolean);

    return { path: nodePath, total_weight, nodes: orderedNodes };
  },

  /**
   * Count dependencies per node (for bottleneck detection)
   */
  async countByNode(nodeId) {
    const result = await db.execute(sql`
      SELECT
        (SELECT COUNT(*) FROM node_dependencies WHERE source_node_id = ${nodeId}) AS downstream_count,
        (SELECT COUNT(*) FROM node_dependencies WHERE target_node_id = ${nodeId}) AS upstream_count
    `);
    return result[0];
  },

  // ─── Goal-targeted dependencies (achieves edges) ────────────────

  /**
   * List all tasks that achieve a goal (upstream contributors).
   * @param {string} goalId
   */
  async listByGoal(goalId) {
    return db.select({
      dependency: nodeDependencies,
      node: planNodes,
    })
      .from(nodeDependencies)
      .innerJoin(planNodes, eq(nodeDependencies.sourceNodeId, planNodes.id))
      .where(eq(nodeDependencies.targetGoalId, goalId));
  },

  /**
   * List all goals that a node contributes to (achieves edges from this node).
   * @param {string} nodeId
   */
  async listGoalsByNode(nodeId) {
    return db.select({
      dependency: nodeDependencies,
      goal: goals,
    })
      .from(nodeDependencies)
      .innerJoin(goals, eq(nodeDependencies.targetGoalId, goals.id))
      .where(
        and(
          eq(nodeDependencies.sourceNodeId, nodeId),
          eq(nodeDependencies.dependencyType, 'achieves'),
        )
      );
  },

  /**
   * Traverse backward from a goal through all 'achieves' edges to find
   * contributing tasks, then recursively through their 'blocks' dependencies.
   * Returns all tasks on the path with statuses, blockers, and completion stats.
   * @param {string} goalId
   * @param {number} maxDepth
   */
  async getGoalPath(goalId, maxDepth = 20) {
    const result = await db.execute(sql`
      WITH RECURSIVE goal_path AS (
        -- Layer 1: tasks directly achieving the goal
        SELECT
          nd.source_node_id AS node_id,
          nd.dependency_type,
          nd.weight,
          1 AS depth,
          ARRAY[nd.source_node_id] AS path
        FROM node_dependencies nd
        WHERE nd.target_goal_id = ${goalId}
          AND nd.dependency_type = 'achieves'
        UNION
        -- Layer 2+: upstream blockers of those tasks
        SELECT
          nd.source_node_id,
          nd.dependency_type,
          nd.weight,
          gp.depth + 1,
          gp.path || nd.source_node_id
        FROM node_dependencies nd
        JOIN goal_path gp ON nd.target_node_id = gp.node_id
        WHERE gp.depth < ${maxDepth}
          AND nd.dependency_type IN ('blocks', 'requires')
          AND nd.target_node_id IS NOT NULL
          AND NOT nd.source_node_id = ANY(gp.path)
      )
      SELECT DISTINCT ON (gp.node_id)
        gp.node_id,
        gp.dependency_type,
        gp.weight,
        gp.depth,
        pn.title,
        pn.status,
        pn.node_type,
        pn.task_mode,
        pn.plan_id
      FROM goal_path gp
      JOIN plan_nodes pn ON pn.id = gp.node_id
      ORDER BY gp.node_id, gp.depth ASC
    `);

    // Compute completion stats
    const total = result.length;
    const completed = result.filter(n => n.status === 'completed').length;
    const blocked = result.filter(n => n.status === 'blocked').length;
    const inProgress = result.filter(n => n.status === 'in_progress').length;

    return {
      nodes: result,
      stats: {
        total,
        completed,
        blocked,
        in_progress: inProgress,
        not_started: total - completed - blocked - inProgress,
        completion_percentage: total > 0 ? Math.round((completed / total) * 100) : 0,
      },
    };
  },

  /**
   * Calculate goal progress from its dependency graph.
   * Completion = percentage of achieves-path tasks completed,
   * with critical-path tasks weighted higher.
   * @param {string} goalId
   */
  async getGoalProgress(goalId) {
    const { nodes, stats } = await this.getGoalPath(goalId);

    if (nodes.length === 0) {
      return { progress: 0, stats, critical_path_progress: 0 };
    }

    // Identify direct achievers (depth=1) for weighted scoring
    const directAchievers = nodes.filter(n => n.depth === 1);
    const directCompleted = directAchievers.filter(n => n.status === 'completed').length;
    const directProgress = directAchievers.length > 0
      ? Math.round((directCompleted / directAchievers.length) * 100)
      : 0;

    return {
      progress: stats.completion_percentage,
      direct_progress: directProgress,
      stats,
    };
  },
};
