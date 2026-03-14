/**
 * Cross-Plan & External Dependency Routes
 *
 * Top-level dependency operations that span multiple plans or represent
 * external blockers outside the system.
 * Mounted at /dependencies
 */
const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth.middleware');
const dal = require('../db/dal.cjs');
const {
  createCrossPlanDependency,
  listCrossPlanDependencies,
} = require('../controllers/dependency.controller.v2');

// POST /dependencies/cross-plan — create edge between nodes in different plans
router.post('/cross-plan', authenticate, createCrossPlanDependency);

// GET /dependencies/cross-plan?plan_ids=id1,id2 — list cross-plan edges
router.get('/cross-plan', authenticate, listCrossPlanDependencies);

/**
 * POST /dependencies/external
 * Create an external dependency node in a plan and optionally block a target node.
 * External nodes represent blockers outside the system (vendor APIs, approvals, etc.)
 */
router.post('/external', authenticate, async (req, res, next) => {
  try {
    const { plan_id, title, description, url, blocks_node_id } = req.body;
    const userId = req.user.id;

    if (!plan_id || !title) {
      return res.status(400).json({ error: 'plan_id and title are required' });
    }

    const { hasAccess, role } = await dal.plansDal.userHasAccess(plan_id, userId);
    if (!hasAccess || !['owner', 'admin', 'editor'].includes(role)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }

    // Find the plan root to parent the external node under
    const root = await dal.nodesDal.getRoot(plan_id);
    if (!root) return res.status(404).json({ error: 'Plan root node not found' });

    // Create the external node
    const extNode = await dal.nodesDal.create({
      planId: plan_id,
      parentId: root.id,
      nodeType: 'external',
      title,
      description: description || null,
      status: 'blocked', // external deps start as blocked (waiting)
      metadata: {
        external: true,
        url: url || null,
      },
    });

    let dep = null;
    if (blocks_node_id) {
      // Verify target node exists in this plan
      const target = await dal.nodesDal.findById(blocks_node_id);
      if (!target || target.planId !== plan_id) {
        return res.status(404).json({ error: 'Target node not found in this plan' });
      }

      dep = await dal.dependenciesDal.create({
        sourceNodeId: extNode.id,
        targetNodeId: blocks_node_id,
        dependencyType: 'blocks',
        weight: 1,
        metadata: { external: true },
        createdBy: userId,
      });
    }

    res.status(201).json({
      node: {
        id: extNode.id,
        plan_id: extNode.planId,
        node_type: 'external',
        title: extNode.title,
        description: extNode.description,
        status: extNode.status,
        url: url || null,
      },
      dependency: dep ? {
        id: dep.id,
        source_node_id: dep.sourceNodeId,
        target_node_id: dep.targetNodeId,
        dependency_type: dep.dependencyType,
      } : null,
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
