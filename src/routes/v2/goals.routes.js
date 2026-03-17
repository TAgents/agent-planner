/**
 * Goals v2 Routes
 * 
 * Full goals system with types, hierarchy, generic links, and evaluations.
 */
const express = require('express');
const router = express.Router();
const { authenticate } = require('../../middleware/auth.middleware');
const logger = require('../../utils/logger');

// DAL (via CJS bridge) — access methods directly via proxy
const goalsDal = require('../../db/dal.cjs').goalsDal;
const dependenciesDal = require('../../db/dal.cjs').dependenciesDal;
const nodesDal = require('../../db/dal.cjs').nodesDal;
const plansDal = require('../../db/dal.cjs').plansDal;
const logsDal = require('../../db/dal.cjs').logsDal;
const graphitiBridge = require('../../services/graphitiBridge');
const reasoning = require('../../services/reasoning');

const VALID_TYPES = ['outcome', 'constraint', 'metric', 'principle'];
const VALID_STATUSES = ['active', 'achieved', 'paused', 'abandoned'];
const VALID_LINK_TYPES = ['plan', 'task', 'agent'];

// Max concurrent Graphiti queries to avoid overwhelming the sidecar
const KNOWLEDGE_QUERY_CONCURRENCY = 10;

/**
 * Fetch goal and verify access. Org goals: any org member. Personal goals: owner only.
 */
async function requireGoalAccess(req, res) {
  const goal = await goalsDal.findById(req.params.id || req.params.goalId);
  if (!goal) { res.status(404).json({ error: 'Goal not found' }); return null; }

  if (goal.organizationId) {
    // Org goal: any org member has access
    if (!req.user.organizations?.some(o => o.id === goal.organizationId)) {
      res.status(403).json({ error: 'Access denied' }); return null;
    }
  } else {
    // Personal goal: owner only
    if (goal.ownerId !== req.user.id) {
      res.status(403).json({ error: 'Access denied' }); return null;
    }
  }
  return goal;
}

/**
 * Classify Postgres constraint violations into user-friendly responses.
 */
function classifyPgError(err) {
  const pgError = err.cause || err;
  const msg = pgError.message || err.message || '';
  if (pgError.code === '23505' || msg.includes('unique') || msg.includes('duplicate')) return 'duplicate';
  if (pgError.code === '23514' || msg.includes('node_deps_no_self_ref')) return 'self_ref';
  return null;
}

/**
 * @swagger
 * /goals/dashboard:
 *   get:
 *     summary: Get health dashboard for all user goals
 *     description: |
 *       Returns health status for all goals the authenticated user owns,
 *       including linked plan progress, bottleneck summaries, pending decisions,
 *       and last agent activity timestamps.
 *
 *       Health heuristics:
 *       - **stale** — no log activity on any linked plan in 3+ days
 *       - **at_risk** — has bottlenecks OR blocked tasks > 30% OR pending decisions older than 1 day
 *       - **on_track** — everything else
 *     tags: [Goals]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Goal dashboard
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 goals:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id:
 *                         type: string
 *                         format: uuid
 *                       title:
 *                         type: string
 *                       description:
 *                         type: string
 *                       type:
 *                         type: string
 *                         enum: [outcome, constraint, metric, principle]
 *                       status:
 *                         type: string
 *                         enum: [active, achieved, paused, abandoned]
 *                       health:
 *                         type: string
 *                         enum: [on_track, at_risk, stale]
 *                       bottleneck_summary:
 *                         type: array
 *                         items:
 *                           type: object
 *                           properties:
 *                             node_id:
 *                               type: string
 *                             title:
 *                               type: string
 *                             status:
 *                               type: string
 *                             direct_downstream_count:
 *                               type: integer
 *                       knowledge_gap_count:
 *                         type: integer
 *                       last_activity:
 *                         type: string
 *                         format: date-time
 *                         nullable: true
 *                       linked_plan_progress:
 *                         type: object
 *                         properties:
 *                           total_nodes:
 *                             type: integer
 *                           completed_nodes:
 *                             type: integer
 *                           blocked_nodes:
 *                             type: integer
 *                           percent_completed:
 *                             type: number
 *                           percent_blocked:
 *                             type: number
 *                           linked_plan_count:
 *                             type: integer
 *                       pending_decision_count:
 *                         type: integer
 *       401:
 *         description: Not authenticated
 *       500:
 *         description: Internal server error
 */
router.get('/dashboard', authenticate, async (req, res, next) => {
  try {
    const userId = req.user.id;

    // 1. Get all goal data with plan stats in a single SQL query
    const dashboardRows = await goalsDal.getDashboardData({
      organizationId: req.user.organizationId,
      userId,
    });

    // 2. For each goal with linked plans, detect bottlenecks (parallel, capped)
    const goalResults = await Promise.all(dashboardRows.map(async (row) => {
      const totalNodes = row.total_nodes;
      const completedNodes = row.completed_nodes;
      const blockedNodes = row.blocked_nodes;
      const planReadyNodes = row.plan_ready_nodes;
      const agentRequestNodes = row.agent_request_nodes;
      const stalePlanReady = row.stale_plan_ready_nodes;
      const staleAgentRequest = row.stale_agent_request_nodes;
      const linkedPlanCount = row.linked_plan_count;
      const lastLogAt = row.last_log_at;

      // Calculate progress percentages
      const percentCompleted = totalNodes > 0
        ? Math.round((completedNodes / totalNodes) * 100)
        : 0;
      const percentBlocked = totalNodes > 0
        ? Math.round((blockedNodes / totalNodes) * 100)
        : 0;

      // Pending decisions = plan_ready + agent_request nodes
      const pendingDecisionCount = planReadyNodes + agentRequestNodes;

      // Stale pending decisions (older than 1 day)
      const stalePendingDecisions = stalePlanReady + staleAgentRequest;

      // Detect bottlenecks across linked plans (cap at 5 plans)
      let bottleneckSummary = [];
      const planIds = Array.isArray(row.plan_ids) ? row.plan_ids.filter(Boolean) : [];
      if (planIds.length > 0) {
        const allBottlenecks = [];
        for (const planId of planIds.slice(0, 5)) {
          try {
            const bottlenecks = await reasoning.detectBottlenecks(planId, { limit: 3, incomplete_only: true });
            allBottlenecks.push(...bottlenecks);
          } catch { /* skip plan on error */ }
        }
        bottleneckSummary = allBottlenecks
          .sort((a, b) => b.direct_downstream_count - a.direct_downstream_count)
          .slice(0, 3);
      }

      // Determine health status
      const now = Date.now();
      const threeDaysMs = 3 * 24 * 60 * 60 * 1000;
      const lastActivityTs = lastLogAt ? new Date(lastLogAt).getTime() : null;
      const hasLinkedPlans = linkedPlanCount > 0;

      let health = 'on_track';

      if (hasLinkedPlans && (!lastActivityTs || (now - lastActivityTs) > threeDaysMs)) {
        health = 'stale';
      } else if (
        bottleneckSummary.length > 0 ||
        percentBlocked > 30 ||
        stalePendingDecisions > 0
      ) {
        health = 'at_risk';
      }

      return {
        id: row.id,
        title: row.title,
        description: row.description,
        type: row.type,
        status: row.status,
        health,
        owner_name: row.owner_name || null,
        bottleneck_summary: bottleneckSummary,
        knowledge_gap_count: 0, // Requires Graphiti — returned as 0 when unavailable
        last_activity: lastLogAt || null,
        linked_plan_progress: {
          total_nodes: totalNodes,
          completed_nodes: completedNodes,
          blocked_nodes: blockedNodes,
          percent_completed: percentCompleted,
          percent_blocked: percentBlocked,
          linked_plan_count: linkedPlanCount,
        },
        pending_decision_count: pendingDecisionCount,
      };
    }));

    res.json({ goals: goalResults });
  } catch (err) {
    await logger.error('Goals dashboard error:', err);
    next(err);
  }
});

// GET /api/goals/tree — must be before /:id
router.get('/tree', authenticate, async (req, res) => {
  try {
    const dal = goalsDal;
    const tree = await dal.getTree({
      organizationId: req.user.organizationId,
      userId: req.user.id,
    });
    res.json({ tree });
  } catch (err) {
    await logger.error('Goals tree error:', err);
    res.status(500).json({ error: 'Failed to fetch goals tree' });
  }
});

// GET /api/goals
router.get('/', authenticate, async (req, res) => {
  try {
    const dal = goalsDal;
    const { status, type } = req.query;
    const goals = await dal.findAll({
      organizationId: req.user.organizationId,
      userId: req.user.id,
    }, { status, type });
    res.json({ goals });
  } catch (err) {
    await logger.error('List goals error:', err);
    res.status(500).json({ error: 'Failed to list goals' });
  }
});

// POST /api/goals
router.post('/', authenticate, async (req, res) => {
  try {
    const { title, description, type = 'outcome', successCriteria, priority, parentGoalId } = req.body;
    if (!title) {
      return res.status(400).json({ error: 'title is required' });
    }
    if (!VALID_TYPES.includes(type)) {
      return res.status(400).json({ error: `type must be one of: ${VALID_TYPES.join(', ')}` });
    }

    const dal = goalsDal;
    const goal = await dal.create({
      title,
      description: description || null,
      ownerId: req.user.id,
      organizationId: req.body.organizationId || req.user.organizationId || null,
      type,
      successCriteria: successCriteria || null,
      priority: priority || 0,
      parentGoalId: parentGoalId || null,
    });
    res.status(201).json(goal);
  } catch (err) {
    await logger.error('Create goal error:', err);
    res.status(500).json({ error: 'Failed to create goal' });
  }
});

// GET /api/goals/:id
router.get('/:id', authenticate, async (req, res) => {
  try {
    const goal = await requireGoalAccess(req, res);
    if (!goal) return;
    res.json(goal);
  } catch (err) {
    await logger.error('Get goal error:', err);
    res.status(500).json({ error: 'Failed to get goal' });
  }
});

// PUT /api/goals/:id
router.put('/:id', authenticate, async (req, res) => {
  try {
    const existing = await requireGoalAccess(req, res);
    if (!existing) return;

    const { title, description, type, status, successCriteria, priority, parentGoalId } = req.body;
    const updates = {};
    if (title !== undefined) updates.title = title;
    if (description !== undefined) updates.description = description;
    if (type !== undefined) {
      if (!VALID_TYPES.includes(type)) return res.status(400).json({ error: 'Invalid type' });
      updates.type = type;
    }
    if (status !== undefined) {
      if (!VALID_STATUSES.includes(status)) return res.status(400).json({ error: 'Invalid status' });
      updates.status = status;
    }
    if (successCriteria !== undefined) updates.successCriteria = successCriteria;
    if (priority !== undefined) updates.priority = priority;
    if (parentGoalId !== undefined) updates.parentGoalId = parentGoalId;

    const goal = await goalsDal.update(req.params.id, updates);
    res.json(goal);
  } catch (err) {
    await logger.error('Update goal error:', err);
    res.status(500).json({ error: 'Failed to update goal' });
  }
});

// DELETE /api/goals/:id (soft delete)
router.delete('/:id', authenticate, async (req, res) => {
  try {
    const existing = await requireGoalAccess(req, res);
    if (!existing) return;

    const goal = await goalsDal.softDelete(req.params.id);
    res.json({ success: true, goal });
  } catch (err) {
    await logger.error('Delete goal error:', err);
    res.status(500).json({ error: 'Failed to delete goal' });
  }
});

// POST /api/goals/:id/links
router.post('/:id/links', authenticate, async (req, res) => {
  try {
    const { linkedType, linkedId } = req.body;
    if (!linkedType || !linkedId) {
      return res.status(400).json({ error: 'linkedType and linkedId are required' });
    }
    if (!VALID_LINK_TYPES.includes(linkedType)) {
      return res.status(400).json({ error: `linkedType must be one of: ${VALID_LINK_TYPES.join(', ')}` });
    }

    const dal = goalsDal;
    const link = await dal.addLink(req.params.id, linkedType, linkedId);
    res.status(201).json(link);
  } catch (err) {
    await logger.error('Add link error:', err);
    res.status(500).json({ error: 'Failed to add link' });
  }
});

// DELETE /api/goals/:id/links/:linkId
router.delete('/:id/links/:linkId', authenticate, async (req, res) => {
  try {
    const dal = goalsDal;
    const link = await dal.removeLink(req.params.linkId);
    if (!link) return res.status(404).json({ error: 'Link not found' });
    res.json({ success: true });
  } catch (err) {
    await logger.error('Remove link error:', err);
    res.status(500).json({ error: 'Failed to remove link' });
  }
});

// POST /api/goals/:id/evaluations
router.post('/:id/evaluations', authenticate, async (req, res) => {
  try {
    const { evaluatedBy, score, reasoning, suggestedActions } = req.body;
    if (!evaluatedBy) {
      return res.status(400).json({ error: 'evaluatedBy is required' });
    }
    if (score !== undefined && (score < 0 || score > 100)) {
      return res.status(400).json({ error: 'score must be between 0 and 100' });
    }

    const dal = goalsDal;
    const evaluation = await dal.addEvaluation(req.params.id, {
      evaluatedBy,
      score: score ?? null,
      reasoning: reasoning || null,
      suggestedActions: suggestedActions || null,
    });
    res.status(201).json(evaluation);
  } catch (err) {
    await logger.error('Add evaluation error:', err);
    res.status(500).json({ error: 'Failed to add evaluation' });
  }
});

// GET /api/goals/:id/evaluations
router.get('/:id/evaluations', authenticate, async (req, res) => {
  try {
    const dal = goalsDal;
    const evaluations = await dal.getEvaluations(req.params.id);
    res.json({ evaluations });
  } catch (err) {
    await logger.error('Get evaluations error:', err);
    res.status(500).json({ error: 'Failed to get evaluations' });
  }
});

// ─── Goal dependency traversal ────────────────────────────────

// GET /api/goals/:id/path — traverse backward from goal through achieves→blocks edges
router.get('/:id/path', authenticate, async (req, res) => {
  try {
    const goal = await requireGoalAccess(req, res);
    if (!goal) return;

    const maxDepth = Number(req.query.max_depth) || 20;
    const result = await dependenciesDal.getGoalPath(req.params.id, maxDepth);
    res.json(result);
  } catch (err) {
    await logger.error('Goal path error:', err);
    res.status(500).json({ error: 'Failed to get goal path' });
  }
});

// GET /api/goals/:id/progress — calculate goal progress from dependency graph
router.get('/:id/progress', authenticate, async (req, res) => {
  try {
    const goal = await requireGoalAccess(req, res);
    if (!goal) return;

    const { nodes, stats } = await dependenciesDal.getGoalPath(req.params.id);
    const directAchievers = nodes.filter(n => n.depth === 1);
    const directCompleted = directAchievers.filter(n => n.status === 'completed').length;
    const directProgress = directAchievers.length > 0
      ? Math.round((directCompleted / directAchievers.length) * 100)
      : 0;

    res.json({
      goal_id: req.params.id,
      progress: stats.completion_percentage,
      direct_progress: directProgress,
      stats,
    });
  } catch (err) {
    await logger.error('Goal progress error:', err);
    res.status(500).json({ error: 'Failed to get goal progress' });
  }
});

// GET /api/goals/:id/achievers — list tasks that achieve this goal
router.get('/:id/achievers', authenticate, async (req, res) => {
  try {
    const goal = await requireGoalAccess(req, res);
    if (!goal) return;

    const rows = await dependenciesDal.listByGoal(req.params.id);
    const tasks = rows.map(r => ({
      dependency_id: r.dependency.id,
      node_id: r.node.id,
      title: r.node.title,
      status: r.node.status,
      node_type: r.node.nodeType,
      dependency_type: r.dependency.dependencyType,
      weight: r.dependency.weight,
    }));
    res.json({ tasks, count: tasks.length });
  } catch (err) {
    await logger.error('Goal achievers error:', err);
    res.status(500).json({ error: 'Failed to list goal achievers' });
  }
});

// POST /api/goals/:id/achievers — create an achieves edge from a node to this goal
router.post('/:id/achievers', authenticate, async (req, res) => {
  try {
    const { source_node_id, weight, metadata } = req.body;
    if (!source_node_id) {
      return res.status(400).json({ error: 'source_node_id is required' });
    }

    const goal = await requireGoalAccess(req, res);
    if (!goal) return;
    const node = await nodesDal.findById(source_node_id);
    if (!node) return res.status(404).json({ error: 'Source node not found' });

    const dep = await dependenciesDal.create({
      sourceNodeId: source_node_id,
      targetGoalId: req.params.id,
      dependencyType: 'achieves',
      weight: weight ?? 1,
      metadata: metadata || {},
      createdBy: req.user.id,
    });

    res.status(201).json({
      id: dep.id,
      source_node_id: dep.sourceNodeId,
      target_goal_id: dep.targetGoalId,
      dependency_type: dep.dependencyType,
      weight: dep.weight,
    });
  } catch (err) {
    const pgErrType = classifyPgError(err);
    if (pgErrType === 'duplicate') {
      return res.status(409).json({ error: 'This achieves edge already exists' });
    }
    await logger.error('Create achieves edge error:', err);
    res.status(500).json({ error: 'Failed to create achieves edge' });
  }
});

// DELETE /api/goals/:id/achievers/:depId — remove an achieves edge
router.delete('/:id/achievers/:depId', authenticate, async (req, res) => {
  try {
    const goal = await requireGoalAccess(req, res);
    if (!goal) return;

    const dep = await dependenciesDal.findById(req.params.depId);
    if (!dep || dep.targetGoalId !== req.params.id) {
      return res.status(404).json({ error: 'Achieves edge not found for this goal' });
    }

    await dependenciesDal.delete(req.params.depId);
    res.json({ deleted: true, id: req.params.depId });
  } catch (err) {
    await logger.error('Delete achieves edge error:', err);
    res.status(500).json({ error: 'Failed to delete achieves edge' });
  }
});

// GET /api/goals/:id/knowledge-gaps — detect knowledge gaps across goal path tasks
router.get('/:id/knowledge-gaps', authenticate, async (req, res) => {
  try {
    const goal = await requireGoalAccess(req, res);
    if (!goal) return;

    if (!graphitiBridge.isAvailable()) {
      return res.json({
        available: false,
        message: 'Knowledge graph not available',
        tasks: [],
        gaps: [],
        coverage: { total: 0, covered: 0, percentage: 0 },
      });
    }

    // Get all tasks on the goal path
    const { nodes } = await dependenciesDal.getGoalPath(req.params.id);
    if (nodes.length === 0) {
      return res.json({
        available: true,
        tasks: [],
        gaps: [],
        coverage: { total: 0, covered: 0, percentage: 100 },
      });
    }

    // Query Graphiti for incomplete tasks — cap concurrency to avoid overwhelming sidecar
    const orgId = req.user.organizationId;
    const incompleteTasks = nodes.filter(n => n.status !== 'completed').slice(0, KNOWLEDGE_QUERY_CONCURRENCY);

    async function queryTaskKnowledge(task) {
      const query = [task.title, task.description].filter(Boolean).join(' ');
      try {
        const facts = await graphitiBridge.queryForContext(task.plan_id, query, orgId, 3);
        return {
          node_id: task.node_id, title: task.title, status: task.status, depth: task.depth,
          fact_count: facts.length, has_knowledge: facts.length > 0,
          top_facts: facts.slice(0, 2).map(f => f.content),
        };
      } catch {
        return {
          node_id: task.node_id, title: task.title, status: task.status, depth: task.depth,
          fact_count: 0, has_knowledge: false, top_facts: [],
        };
      }
    }

    const results = await Promise.all(incompleteTasks.map(queryTaskKnowledge));
    const gaps = results.filter(r => !r.has_knowledge);
    const covered = results.filter(r => r.has_knowledge).length;

    // Check goal-level knowledge (success criteria) — batch with tasks
    let goalKnowledge;
    if (goal.successCriteria && Array.isArray(goal.successCriteria)) {
      goalKnowledge = await Promise.all(
        goal.successCriteria.slice(0, 5).map(async (criterion) => {
          const query = typeof criterion === 'string' ? criterion : JSON.stringify(criterion);
          try {
            const facts = await graphitiBridge.queryForContext(null, query, orgId, 2);
            return { criterion: query, has_knowledge: facts.length > 0, fact_count: facts.length };
          } catch {
            return { criterion: query, has_knowledge: false, fact_count: 0 };
          }
        })
      );
    }

    res.json({
      available: true,
      tasks: results,
      gaps,
      coverage: {
        total: results.length,
        covered,
        percentage: results.length > 0 ? Math.round((covered / results.length) * 100) : 100,
      },
      success_criteria_coverage: goalKnowledge?.length > 0 ? goalKnowledge : undefined,
    });
  } catch (err) {
    await logger.error('Knowledge gaps error:', err);
    res.status(500).json({ error: 'Failed to detect knowledge gaps' });
  }
});

// ─── Goal Briefing ───────────────────────────────────────────
// Single-call endpoint that composes multiple services into a comprehensive goal briefing.

/**
 * @swagger
 * /goals/{goalId}/briefing:
 *   get:
 *     summary: Get a comprehensive goal briefing
 *     description: >
 *       Composes goal metadata, progress across linked plans, bottlenecks,
 *       critical path, knowledge status, recent activity, and pending decisions
 *       into a single response.
 *     tags: [Goals]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: goalId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Goal briefing
 *       404:
 *         description: Goal not found
 *       403:
 *         description: Access denied
 */
router.get('/:goalId/briefing', authenticate, async (req, res) => {
  try {
    // 1. Load goal and verify access (org-aware)
    const goal = await requireGoalAccess(req, res);
    if (!goal) return;

    // 2. Get linked plans from goal_links
    const planLinks = (goal.links || []).filter(l => l.linkedType === 'plan');
    const planIds = planLinks.map(l => l.linkedId);

    // 3. Batch-load plan metadata and nodes for all linked plans in parallel
    const [planRows, allNodes] = await Promise.all([
      planIds.length > 0
        ? Promise.all(planIds.map(id => plansDal.findById(id)))
        : Promise.resolve([]),
      planIds.length > 0
        ? Promise.all(planIds.map(id => nodesDal.listByPlan(id)))
        : Promise.resolve([]),
    ]);

    // Build plan lookup (filter out deleted/missing plans)
    const plansMap = new Map();
    for (const p of planRows) {
      if (p) plansMap.set(p.id, p);
    }
    const validPlanIds = [...plansMap.keys()];

    // Flatten all nodes across plans, excluding root nodes
    const flatNodes = allNodes.flat().filter(n => n.nodeType !== 'root');

    // 4. Aggregate progress stats
    const progress = { total_tasks: 0, completed: 0, in_progress: 0, blocked: 0 };
    for (const n of flatNodes) {
      if (n.nodeType === 'task' || n.nodeType === 'milestone') {
        progress.total_tasks++;
        if (n.status === 'completed') progress.completed++;
        else if (n.status === 'in_progress') progress.in_progress++;
        else if (n.status === 'blocked') progress.blocked++;
      }
    }
    progress.completion_pct = progress.total_tasks > 0
      ? Math.round((progress.completed / progress.total_tasks) * 100)
      : 0;

    // 5. Bottlenecks, deps, logs, pending decisions — all in parallel
    const [bottleneckResults, depsResults, recentLogs, pendingNodes] = await Promise.all([
      // Bottlenecks for each plan
      Promise.all(validPlanIds.map(id => reasoning.detectBottlenecks(id, { limit: 3 }))),

      // Dependencies for each plan (needed for critical path)
      Promise.all(validPlanIds.map(id =>
        dependenciesDal.listByPlan(id).catch(() => [])
      )),

      // Recent activity: logs from nodes in linked plans
      (async () => {
        const nodeIds = flatNodes.map(n => n.id);
        if (nodeIds.length === 0) return [];
        return logsDal.listByNodes(nodeIds, { limit: 10 });
      })(),

      // Pending decisions: plan_ready nodes or nodes with agent requests
      (async () => {
        if (validPlanIds.length === 0) return [];
        const [planReadyNodes, agentRequestNodes] = await Promise.all([
          nodesDal.listByPlanIds(validPlanIds, { status: 'plan_ready', limit: 20 }),
          nodesDal.listByPlanIds(validPlanIds, { agentRequested: true, limit: 20 }),
        ]);
        // Deduplicate by node ID
        const seen = new Set();
        const combined = [];
        for (const n of [...planReadyNodes, ...agentRequestNodes]) {
          if (!seen.has(n.id)) {
            seen.add(n.id);
            combined.push(n);
          }
        }
        return combined;
      })(),
    ]);

    // 6. Merge bottlenecks across plans, keep top 5 by downstream count
    const allBottlenecks = bottleneckResults.flat()
      .sort((a, b) => b.direct_downstream_count - a.direct_downstream_count)
      .slice(0, 5)
      .map(b => ({
        node_id: b.node_id,
        title: b.title,
        downstream_count: b.direct_downstream_count,
      }));

    // 7. Compute critical path (longest chain of blocks edges through incomplete nodes)
    const criticalPath = computeCriticalPath(flatNodes, depsResults.flat(), plansMap);

    // 8. Knowledge status (Graphiti) — graceful degradation
    const knowledge = await getKnowledgeStatus(flatNodes, req.user.organizationId);

    // 9. Format recent activity with plan titles
    const nodeIdToPlan = new Map();
    for (const n of flatNodes) {
      nodeIdToPlan.set(n.id, plansMap.get(n.planId));
    }
    const recent_activity = recentLogs.map(log => ({
      type: log.logType || 'log',
      message: log.content,
      timestamp: log.createdAt,
      plan_title: nodeIdToPlan.get(log.planNodeId)?.title || null,
    }));

    // 10. Format pending decisions
    const pending_decisions = pendingNodes.map(n => ({
      node_id: n.id,
      title: n.title,
      type: n.status === 'plan_ready' ? 'plan_ready' : 'agent_request',
    }));

    // 11. Linked plans with per-plan progress
    const linked_plans = validPlanIds.map(pid => {
      const plan = plansMap.get(pid);
      const planNodesList = flatNodes.filter(n => n.planId === pid && (n.nodeType === 'task' || n.nodeType === 'milestone'));
      const total = planNodesList.length;
      const done = planNodesList.filter(n => n.status === 'completed').length;
      return {
        plan_id: pid,
        title: plan?.title || null,
        progress_pct: total > 0 ? Math.round((done / total) * 100) : 0,
      };
    });

    // 12. Calculate health
    const health = calculateHealth(progress, allBottlenecks, flatNodes);

    res.json({
      goal: {
        id: goal.id,
        title: goal.title,
        type: goal.type,
        status: goal.status,
      },
      health,
      progress,
      critical_path: criticalPath,
      bottlenecks: allBottlenecks,
      knowledge,
      recent_activity,
      pending_decisions,
      linked_plans,
    });
  } catch (err) {
    await logger.error('Goal briefing error:', err);
    res.status(500).json({ error: 'Failed to generate goal briefing' });
  }
});

/**
 * Compute the critical path: longest chain of 'blocks' edges through incomplete nodes.
 * Uses dynamic programming on the DAG to find the longest path.
 */
function computeCriticalPath(nodes, depsResults, plansMap) {
  const incompleteNodes = new Map();
  for (const n of nodes) {
    if ((n.nodeType === 'task' || n.nodeType === 'milestone') && n.status !== 'completed') {
      incompleteNodes.set(n.id, n);
    }
  }

  if (incompleteNodes.size === 0) return [];

  // Build adjacency list from blocks edges (source → target)
  const adj = new Map();        // sourceId → [targetId, ...]
  const inDegree = new Map();   // nodeId → number of incoming blocks edges
  for (const id of incompleteNodes.keys()) {
    adj.set(id, []);
    inDegree.set(id, 0);
  }

  for (const row of depsResults) {
    const dep = row.dependency || row;
    if (dep.dependencyType !== 'blocks') continue;
    if (!incompleteNodes.has(dep.sourceNodeId) || !incompleteNodes.has(dep.targetNodeId)) continue;
    adj.get(dep.sourceNodeId).push(dep.targetNodeId);
    inDegree.set(dep.targetNodeId, (inDegree.get(dep.targetNodeId) || 0) + 1);
  }

  // Topological sort (Kahn's algorithm) + longest path via DP
  const queue = [];
  const dist = new Map();   // nodeId → longest path length ending here
  const prev = new Map();   // nodeId → predecessor on longest path

  for (const [id, deg] of inDegree) {
    if (deg === 0) queue.push(id);
    dist.set(id, 1);
    prev.set(id, null);
  }

  const topoOrder = [];
  while (queue.length > 0) {
    const nodeId = queue.shift();
    topoOrder.push(nodeId);
    for (const neighbor of (adj.get(nodeId) || [])) {
      const newDist = (dist.get(nodeId) || 1) + 1;
      if (newDist > (dist.get(neighbor) || 1)) {
        dist.set(neighbor, newDist);
        prev.set(neighbor, nodeId);
      }
      inDegree.set(neighbor, (inDegree.get(neighbor) || 1) - 1);
      if (inDegree.get(neighbor) === 0) queue.push(neighbor);
    }
  }

  // Find the node with the longest path
  let maxDist = 0;
  let endNode = null;
  for (const [id, d] of dist) {
    if (d > maxDist) {
      maxDist = d;
      endNode = id;
    }
  }

  if (!endNode || maxDist <= 1) return [];

  // Trace back the path
  const path = [];
  let current = endNode;
  while (current) {
    const n = incompleteNodes.get(current);
    if (n) {
      path.unshift({
        node_id: n.id,
        title: n.title,
        status: n.status,
        plan_title: plansMap.get(n.planId)?.title || null,
      });
    }
    current = prev.get(current);
  }

  return path;
}

/**
 * Query Graphiti for knowledge status related to the goal's tasks.
 * Gracefully degrades if Graphiti is unavailable.
 */
async function getKnowledgeStatus(nodes, orgId) {
  const defaultResult = {
    facts_count: 0,
    contradictions: [],
    gaps: [],
  };

  if (!graphitiBridge.isAvailable()) return defaultResult;

  const incompleteTasks = nodes
    .filter(n => (n.nodeType === 'task' || n.nodeType === 'milestone') && n.status !== 'completed')
    .slice(0, KNOWLEDGE_QUERY_CONCURRENCY);

  if (incompleteTasks.length === 0) return defaultResult;

  try {
    // Build a combined query from task titles for a single broad search
    const combinedQuery = incompleteTasks.map(t => t.title).join('. ');
    const groupId = graphitiBridge.orgGroupId(orgId);

    const [facts, contradictions] = await Promise.all([
      graphitiBridge.searchMemory({ query: combinedQuery, group_id: groupId, max_results: 20 }),
      graphitiBridge.detectContradictions({ query: combinedQuery, group_id: groupId, max_results: 10 }),
    ]);

    // Count facts
    let factsCount = 0;
    if (Array.isArray(facts)) factsCount = facts.length;
    else if (facts?.facts) factsCount = facts.facts.length;
    else if (facts?.results) factsCount = facts.results.length;

    // Format contradictions
    const formattedContradictions = (contradictions?.superseded || []).map(s => ({
      fact_a: s.fact,
      fact_b: (contradictions.current || []).find(c => c.name === s.name)?.fact || null,
      discovered_at: s.expired_at,
    }));

    // Knowledge gaps: tasks with no relevant facts (quick per-task check)
    const gapResults = await Promise.all(
      incompleteTasks.map(async (task) => {
        const query = task.title;
        try {
          const taskFacts = await graphitiBridge.queryForContext(task.planId, query, orgId, 1);
          return { node_id: task.id, title: task.title, has_knowledge: taskFacts.length > 0 };
        } catch {
          return { node_id: task.id, title: task.title, has_knowledge: false };
        }
      })
    );
    const gaps = gapResults.filter(r => !r.has_knowledge);

    return {
      facts_count: factsCount,
      contradictions: formattedContradictions,
      gaps,
    };
  } catch {
    return defaultResult;
  }
}

/**
 * Calculate goal health based on progress and signals.
 *  - on_track: good completion rate, few blockers
 *  - at_risk: high blocked ratio or bottleneck-heavy
 *  - stale: no recent activity on incomplete tasks
 */
function calculateHealth(progress, bottlenecks, nodes) {
  if (progress.total_tasks === 0) return 'on_track';

  // Stale: check if any incomplete task was updated in the last 7 days
  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const incompleteTasks = nodes.filter(n =>
    (n.nodeType === 'task' || n.nodeType === 'milestone') && n.status !== 'completed'
  );
  if (incompleteTasks.length > 0) {
    const anyRecentActivity = incompleteTasks.some(n =>
      n.updatedAt && new Date(n.updatedAt).getTime() > sevenDaysAgo
    );
    if (!anyRecentActivity) return 'stale';
  }

  // At risk: >25% blocked or significant bottlenecks
  const blockedRatio = progress.blocked / progress.total_tasks;
  if (blockedRatio > 0.25) return 'at_risk';
  if (bottlenecks.length >= 3 && bottlenecks[0]?.downstream_count >= 5) return 'at_risk';

  return 'on_track';
}

module.exports = router;
