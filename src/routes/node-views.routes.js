/**
 * Node View Routes
 *
 * Endpoints scoped to /nodes/:nodeId that provide read-only views
 * of node data for human consumption.
 */

const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth.middleware.v2');
const { plansDal, nodesDal } = require('../db/dal.cjs');
const graphitiBridge = require('../services/graphitiBridge');
const logger = require('../utils/logger');
const { assembleContext, estimateTokens } = require('../services/contextEngine');

/**
 * @swagger
 * /nodes/{nodeId}/agent-view:
 *   get:
 *     tags: [Context]
 *     summary: Human-readable view of the progressive context an agent receives
 *     description: |
 *       Returns the same progressive context that an agent receives via the
 *       context engine, but formatted for human reading with explicit layer
 *       labels and no token budgeting. Useful for understanding exactly what
 *       information an agent had when it made a decision.
 *
 *       Layers:
 *       - Layer 1 (task_focus): Node details, recent logs, RPI research
 *       - Layer 2 (neighborhood): Parent, siblings, direct dependencies
 *       - Layer 3 (knowledge): Facts and contradictions from Graphiti
 *       - Layer 4 (extended): Plan overview, ancestry, goals, transitive dependencies
 *     parameters:
 *       - in: path
 *         name: nodeId
 *         required: true
 *         schema: { type: string, format: uuid }
 *         description: The node ID to get agent context for
 *       - in: query
 *         name: depth
 *         schema: { type: integer, minimum: 1, maximum: 4, default: 4 }
 *         description: Number of context layers to include (1-4)
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Layered agent context for human review
 *       400:
 *         description: Invalid parameters
 *       403:
 *         description: Access denied to the plan containing this node
 *       404:
 *         description: Node not found
 */
/**
 * @swagger
 * /nodes/{nodeId}:
 *   get:
 *     tags: [Nodes]
 *     summary: Look up a node by id (returns plan_id + basic node fields)
 *     description: |
 *       Plan-agnostic node lookup. Used by MCP tools and other clients that
 *       have a node_id but not a plan_id (e.g., resolving plan context for
 *       link_intentions, move_node, etc.). Returns the node with snake_case
 *       fields including plan_id; full structural traversal still requires
 *       the plan-scoped routes.
 *     parameters:
 *       - in: path
 *         name: nodeId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Node found
 *       403:
 *         description: Access denied to the plan containing this node
 *       404:
 *         description: Node not found
 */
router.get('/:nodeId', authenticate, async (req, res) => {
  try {
    const { nodeId } = req.params;
    const userId = req.user.id;

    const node = await nodesDal.findById(nodeId);
    if (!node) return res.status(404).json({ error: 'Node not found' });

    const { hasAccess } = await plansDal.userHasAccess(node.planId, userId);
    if (!hasAccess) return res.status(403).json({ error: 'Access denied to this plan' });

    return res.json({
      id: node.id,
      plan_id: node.planId,
      parent_id: node.parentId,
      node_type: node.nodeType,
      title: node.title,
      description: node.description,
      status: node.status,
      task_mode: node.taskMode,
      order_index: node.orderIndex,
      created_at: node.createdAt,
      updated_at: node.updatedAt,
    });
  } catch (err) {
    await logger.error('Get node by id error:', err);
    return res.status(500).json({ error: 'Failed to fetch node' });
  }
});

router.get('/:nodeId/agent-view', authenticate, async (req, res) => {
  try {
    const { nodeId } = req.params;
    const depth = Math.min(Math.max(Number(req.query.depth) || 4, 1), 4);
    const userId = req.user.id;

    // Verify node exists
    const node = await nodesDal.findById(nodeId);
    if (!node) return res.status(404).json({ error: 'Node not found' });

    // Verify user has access to the plan
    const { hasAccess } = await plansDal.userHasAccess(node.planId, userId);
    if (!hasAccess) return res.status(403).json({ error: 'Access denied to this plan' });

    // Assemble full context without token budgeting
    const context = await assembleContext(nodeId, {
      depth,
      token_budget: 0,
      log_limit: 20,
      include_research: true,
      orgId: req.user.organizationId,
    });

    if (!context) {
      return res.status(404).json({ error: 'Node not found' });
    }

    // Restructure flat context into explicit layers
    const layers = {};

    // Layer 1: Task Focus
    layers.task_focus = {
      node: context.task || null,
      logs: context.logs || [],
      rpi_research: context.rpi_research || [],
    };

    // Layer 2: Neighborhood (only if depth >= 2)
    if (depth >= 2) {
      layers.neighborhood = {
        parent: context.parent || null,
        siblings: context.siblings || [],
        dependencies: context.dependencies || { upstream: [], downstream: [] },
      };
    }

    // Layer 3: Knowledge (only if depth >= 3)
    if (depth >= 3) {
      const knowledgeFacts = context.knowledge || [];

      // Also fetch contradictions for human review
      let contradictions = [];
      if (graphitiBridge.isAvailable()) {
        try {
          const searchQuery = [node.title, node.description].filter(Boolean).join(' ');
          const group_id = graphitiBridge.getGroupId(req.user);
          const result = await graphitiBridge.detectContradictions({ query: searchQuery, group_id });
          if (result.contradictions_found) {
            contradictions = result.superseded;
          }
        } catch {
          // Non-fatal — contradictions are supplementary
        }
      }

      layers.knowledge = {
        facts: knowledgeFacts,
        contradictions,
      };
    }

    // Layer 4: Extended (only if depth >= 4)
    if (depth >= 4) {
      layers.extended = {
        plan: context.plan || null,
        ancestry: context.ancestry || [],
        goals: context.goals || [],
        transitive_dependencies: context.transitive_dependencies || { upstream: [], downstream: [] },
      };
    }

    // Build layers_included list
    const layerNames = ['task_focus', 'neighborhood', 'knowledge', 'extended'];
    const layersIncluded = layerNames.slice(0, depth);

    const response = {
      node_id: nodeId,
      layers,
      meta: {
        layers_included: layersIncluded,
        estimated_tokens: estimateTokens(layers),
      },
    };

    return res.json(response);
  } catch (error) {
    await logger.error('Agent view error:', error);
    return res.status(500).json({ error: 'Failed to build agent view' });
  }
});

module.exports = router;
