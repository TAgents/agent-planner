/**
 * Dependency Controller v2 — Manages node dependency edges
 */
const dal = require('../db/dal.cjs');
const { broadcastPlanUpdate } = require('../websocket/broadcast');

const checkPlanAccess = async (planId, userId, roles = []) => {
  const { hasAccess, role } = await dal.plansDal.userHasAccess(planId, userId);
  if (!hasAccess) return false;
  if (roles.length === 0) return true;
  return roles.includes(role);
};

const snakeDep = (d) => ({
  id: d.id,
  source_node_id: d.sourceNodeId,
  target_node_id: d.targetNodeId,
  target_goal_id: d.targetGoalId || null,
  dependency_type: d.dependencyType,
  weight: d.weight,
  metadata: d.metadata,
  created_by: d.createdBy,
  created_at: d.createdAt,
  updated_at: d.updatedAt,
});

/**
 * POST /plans/:id/dependencies
 * Create a dependency edge between two nodes in this plan
 */
const createDependency = async (req, res, next) => {
  try {
    const { id: planId } = req.params;
    const { source_node_id, target_node_id, dependency_type, weight, metadata } = req.body;
    const userId = req.user.id;

    if (!(await checkPlanAccess(planId, userId, ['owner', 'admin', 'editor']))) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }

    if (!source_node_id || !target_node_id) {
      return res.status(400).json({ error: 'source_node_id and target_node_id are required' });
    }

    // Verify both nodes belong to this plan
    const [source, target] = await Promise.all([
      dal.nodesDal.findById(source_node_id),
      dal.nodesDal.findById(target_node_id),
    ]);
    if (!source || source.planId !== planId) {
      return res.status(404).json({ error: 'Source node not found in this plan' });
    }
    if (!target || target.planId !== planId) {
      return res.status(404).json({ error: 'Target node not found in this plan' });
    }

    // Cycle detection
    const depType = dependency_type || 'blocks';
    const { hasCycle, cyclePath } = await dal.dependenciesDal.wouldCreateCycle(
      source_node_id, target_node_id, [depType]
    );
    if (hasCycle) {
      return res.status(409).json({
        error: 'Adding this dependency would create a cycle',
        cycle_path: cyclePath,
      });
    }

    const dep = await dal.dependenciesDal.create({
      sourceNodeId: source_node_id,
      targetNodeId: target_node_id,
      dependencyType: depType,
      weight: weight ?? 1,
      metadata: metadata || {},
      createdBy: userId,
    });

    res.status(201).json(snakeDep(dep));
  } catch (error) {
    // Drizzle wraps postgres-js errors; check both the error and its cause
    const pgError = error.cause || error;
    const msg = pgError.message || error.message || '';
    if (pgError.code === '23505' || msg.includes('unique') || msg.includes('duplicate')) {
      return res.status(409).json({ error: 'This dependency edge already exists' });
    }
    if (pgError.code === '23514' || msg.includes('node_deps_no_self_ref')) {
      return res.status(400).json({ error: 'A node cannot depend on itself' });
    }
    next(error);
  }
};

/**
 * DELETE /plans/:id/dependencies/:depId
 */
const deleteDependency = async (req, res, next) => {
  try {
    const { id: planId, depId } = req.params;
    const userId = req.user.id;

    if (!(await checkPlanAccess(planId, userId, ['owner', 'admin', 'editor']))) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }

    const dep = await dal.dependenciesDal.findById(depId);
    if (!dep) return res.status(404).json({ error: 'Dependency not found' });

    // Verify the dependency belongs to a node in this plan
    const sourceNode = await dal.nodesDal.findById(dep.sourceNodeId);
    if (!sourceNode || sourceNode.planId !== planId) {
      return res.status(404).json({ error: 'Dependency not found in this plan' });
    }

    await dal.dependenciesDal.delete(depId);
    res.json({ deleted: true, id: depId });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /plans/:id/dependencies
 * List all dependency edges in a plan
 */
const listPlanDependencies = async (req, res, next) => {
  try {
    const { id: planId } = req.params;
    const userId = req.user.id;

    if (!(await checkPlanAccess(planId, userId))) {
      return res.status(403).json({ error: 'No access to this plan' });
    }

    const rows = await dal.dependenciesDal.listByPlan(planId);
    const edges = rows.map(r => ({
      ...snakeDep(r.dependency),
      source_title: r.sourceNode?.title,
    }));

    res.json({ edges, count: edges.length });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /plans/:id/nodes/:nodeId/dependencies
 * List dependencies for a specific node
 */
const listNodeDependencies = async (req, res, next) => {
  try {
    const { id: planId, nodeId } = req.params;
    const { direction = 'both' } = req.query;
    const userId = req.user.id;

    if (!(await checkPlanAccess(planId, userId))) {
      return res.status(403).json({ error: 'No access to this plan' });
    }

    const node = await dal.nodesDal.findById(nodeId);
    if (!node || node.planId !== planId) {
      return res.status(404).json({ error: 'Node not found in this plan' });
    }

    const result = await dal.dependenciesDal.listByNode(nodeId, direction);

    if (direction === 'both') {
      res.json({
        upstream: result.upstream.map(r => ({ ...snakeDep(r.dependency), node_title: r.node?.title })),
        downstream: result.downstream.map(r => ({ ...snakeDep(r.dependency), node_title: r.node?.title })),
      });
    } else {
      const edges = result.map(r => ({ ...snakeDep(r.dependency), node_title: r.node?.title }));
      res.json({ edges, count: edges.length });
    }
  } catch (error) {
    next(error);
  }
};

/**
 * GET /plans/:id/nodes/:nodeId/upstream
 * Get all upstream (ancestor) nodes via recursive traversal
 */
const getUpstream = async (req, res, next) => {
  try {
    const { id: planId, nodeId } = req.params;
    const { max_depth = 10 } = req.query;
    const userId = req.user.id;

    if (!(await checkPlanAccess(planId, userId))) {
      return res.status(403).json({ error: 'No access to this plan' });
    }

    const nodes = await dal.dependenciesDal.getUpstream(nodeId, Number(max_depth));
    res.json({ nodes, count: nodes.length });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /plans/:id/nodes/:nodeId/downstream
 * Get all downstream (dependent) nodes via recursive traversal
 */
const getDownstream = async (req, res, next) => {
  try {
    const { id: planId, nodeId } = req.params;
    const { max_depth = 10 } = req.query;
    const userId = req.user.id;

    if (!(await checkPlanAccess(planId, userId))) {
      return res.status(403).json({ error: 'No access to this plan' });
    }

    const nodes = await dal.dependenciesDal.getDownstream(nodeId, Number(max_depth));
    res.json({ nodes, count: nodes.length });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /plans/:id/nodes/:nodeId/impact
 * Impact analysis — what happens if this node is delayed/blocked/removed
 */
const getImpact = async (req, res, next) => {
  try {
    const { id: planId, nodeId } = req.params;
    const { scenario = 'block' } = req.query;
    const userId = req.user.id;

    if (!(await checkPlanAccess(planId, userId))) {
      return res.status(403).json({ error: 'No access to this plan' });
    }

    const validScenarios = ['delay', 'block', 'remove'];
    if (!validScenarios.includes(scenario)) {
      return res.status(400).json({ error: `Invalid scenario. Must be one of: ${validScenarios.join(', ')}` });
    }

    const affected = await dal.dependenciesDal.getImpact(nodeId, scenario);
    const direct = affected.filter(n => n.severity === 'direct');
    const transitive = affected.filter(n => n.severity === 'transitive');

    res.json({
      scenario,
      source_node_id: nodeId,
      affected_count: affected.length,
      direct: direct.map(n => ({ node_id: n.node_id, title: n.title, status: n.status, node_type: n.node_type })),
      transitive: transitive.map(n => ({ node_id: n.node_id, title: n.title, status: n.status, node_type: n.node_type, depth: n.depth })),
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /plans/:id/critical-path
 * Find the longest dependency chain through blocks edges
 */
const getCriticalPath = async (req, res, next) => {
  try {
    const { id: planId } = req.params;
    const userId = req.user.id;

    if (!(await checkPlanAccess(planId, userId))) {
      return res.status(403).json({ error: 'No access to this plan' });
    }

    const result = await dal.dependenciesDal.getCriticalPath(planId);
    res.json(result);
  } catch (error) {
    next(error);
  }
};

module.exports = {
  createDependency,
  deleteDependency,
  listPlanDependencies,
  listNodeDependencies,
  getUpstream,
  getDownstream,
  getImpact,
  getCriticalPath,
};
