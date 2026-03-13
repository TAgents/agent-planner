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
const graphitiBridge = require('../../services/graphitiBridge');

const VALID_TYPES = ['outcome', 'constraint', 'metric', 'principle'];
const VALID_STATUSES = ['active', 'achieved', 'paused', 'abandoned'];
const VALID_LINK_TYPES = ['plan', 'task', 'agent'];

// Max concurrent Graphiti queries to avoid overwhelming the sidecar
const KNOWLEDGE_QUERY_CONCURRENCY = 10;

/**
 * Fetch goal and verify ownership. Returns goal or sends error response.
 */
async function requireGoalAccess(req, res) {
  const goal = await goalsDal.findById(req.params.id);
  if (!goal) { res.status(404).json({ error: 'Goal not found' }); return null; }
  if (goal.ownerId !== req.user.id) { res.status(403).json({ error: 'Access denied' }); return null; }
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

// GET /api/goals/tree — must be before /:id
router.get('/tree', authenticate, async (req, res) => {
  try {
    const dal = goalsDal;
    const tree = await dal.getTree(req.user.id);
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
    const goals = await dal.findAll(req.user.id, { status, type });
    res.json({ goals });
  } catch (err) {
    await logger.error('List goals error:', err);
    res.status(500).json({ error: 'Failed to list goals' });
  }
});

// POST /api/goals
router.post('/', authenticate, async (req, res) => {
  try {
    const { title, description, type, successCriteria, priority, parentGoalId } = req.body;
    if (!title || !type) {
      return res.status(400).json({ error: 'title and type are required' });
    }
    if (!VALID_TYPES.includes(type)) {
      return res.status(400).json({ error: `type must be one of: ${VALID_TYPES.join(', ')}` });
    }

    const dal = goalsDal;
    const goal = await dal.create({
      title,
      description: description || null,
      ownerId: req.user.id,
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

    const [goal, node] = await Promise.all([
      goalsDal.findById(req.params.id),
      nodesDal.findById(source_node_id),
    ]);
    if (!goal) return res.status(404).json({ error: 'Goal not found' });
    if (goal.ownerId !== req.user.id) return res.status(403).json({ error: 'Access denied' });
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

module.exports = router;
