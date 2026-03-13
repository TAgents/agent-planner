/**
 * Agent Context Routes
 */

const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth.middleware.v2');
const { plansDal, nodesDal, goalsDal } = require('../db/dal.cjs');
const graphitiBridge = require('../services/graphitiBridge');
const logger = require('../utils/logger');
const { assembleContext, suggestNextTasks } = require('../services/contextEngine');
const { compactResearchOutput } = require('../services/compaction');

/**
 * Helper: Get node ancestry (leaf to root path)
 */
async function getAncestry(nodeId, planId) {
  const ancestry = [];
  let currentId = nodeId;

  while (currentId) {
    const node = await nodesDal.findByIdAndPlan(currentId, planId);
    if (!node) break;
    ancestry.push(node);
    currentId = node.parentId;
  }

  return ancestry;
}

router.get('/', authenticate, async (req, res) => {
  try {
    const { node_id, include_knowledge = 'true', include_siblings = 'false' } = req.query;
    const userId = req.user.id;

    if (!node_id) return res.status(400).json({ error: 'node_id is required' });

    const node = await nodesDal.findById(node_id);
    if (!node) return res.status(404).json({ error: 'Node not found' });

    const planId = node.planId;

    const { hasAccess } = await plansDal.userHasAccess(planId, userId);
    if (!hasAccess) return res.status(403).json({ error: 'Access denied to this plan' });

    const ancestry = await getAncestry(node_id, planId);
    const plan = await plansDal.findById(planId);

    // Get linked goals via goalsDal
    const linkedGoals = await goalsDal.getLinkedGoals('plan', planId);

    const response = {
      node: {
        id: node.id, node_type: node.nodeType, title: node.title,
        description: node.description, status: node.status,
        context: node.context, agent_instructions: node.agentInstructions
      },
      ancestry: ancestry.map(n => ({
        id: n.id, node_type: n.nodeType, title: n.title,
        description: n.description, status: n.status
      })),
      plan: plan ? {
        id: plan.id, title: plan.title, description: plan.description,
        status: plan.status, github_repo_url: plan.githubRepoUrl
      } : null,
      goals: linkedGoals.map(g => ({
        id: g.id, title: g.title, description: g.description, status: g.status,
        success_criteria: g.successCriteria
      })),
      organization: null
    };

    // Include knowledge if requested (via Graphiti temporal graph)
    if (include_knowledge === 'true') {
      try {
        if (graphitiBridge.isAvailable()) {
          const group_id = graphitiBridge.orgGroupId(req.user.organizationId || req.user.org_id);
          const searchQuery = [response.node.title, response.node.description].filter(Boolean).join(' ');
          const facts = await graphitiBridge.queryForContext(planId, searchQuery);
          response.knowledge = facts;
        } else {
          response.knowledge = [];
        }
      } catch (e) {
        response.knowledge = [];
      }
    }

    // Include siblings if requested
    if (include_siblings === 'true' && node.parentId) {
      const allChildren = await nodesDal.getChildren(node.parentId);
      response.siblings = allChildren.filter(n => n.id !== node_id).map(n => ({
        id: n.id, node_type: n.nodeType, title: n.title, status: n.status, order_index: n.orderIndex
      }));
    }

    return res.json(response);
  } catch (error) {
    await logger.error('Get agent context error:', error);
    return res.status(500).json({ error: 'Failed to get context' });
  }
});

router.get('/plan', authenticate, async (req, res) => {
  try {
    const { plan_id, include_knowledge = 'true' } = req.query;
    const userId = req.user.id;

    if (!plan_id) return res.status(400).json({ error: 'plan_id is required' });

    const { hasAccess } = await plansDal.userHasAccess(plan_id, userId);
    if (!hasAccess) return res.status(403).json({ error: 'Access denied to this plan' });

    const plan = await plansDal.findById(plan_id);
    if (!plan) return res.status(404).json({ error: 'Plan not found' });

    const allNodes = await nodesDal.listByPlan(plan_id);
    const phases = allNodes.filter(n => n.nodeType === 'phase');

    const phaseSummaries = phases.map(phase => {
      const children = allNodes.filter(n => n.parentId === phase.id && n.nodeType === 'task');
      return {
        id: phase.id, title: phase.title, status: phase.status,
        total_tasks: children.length,
        completed_tasks: children.filter(c => c.status === 'completed').length
      };
    });

    const linkedGoals = await goalsDal.getLinkedGoals('plan', plan_id);

    const response = {
      plan: {
        id: plan.id, title: plan.title, description: plan.description,
        status: plan.status, github_repo_url: plan.githubRepoUrl
      },
      phases: phaseSummaries,
      goals: linkedGoals,
      organization: null
    };

    if (include_knowledge === 'true') {
      try {
        if (graphitiBridge.isAvailable()) {
          const group_id = graphitiBridge.orgGroupId(req.user.organizationId || req.user.org_id);
          const facts = await graphitiBridge.queryForContext(plan_id, plan.title || '');
          response.knowledge = facts;
        } else {
          response.knowledge = [];
        }
      } catch (e) {
        response.knowledge = [];
      }
    }

    return res.json(response);
  } catch (error) {
    await logger.error('Get plan context error:', error);
    return res.status(500).json({ error: 'Failed to get plan context' });
  }
});

/**
 * @swagger
 * /context/progressive:
 *   get:
 *     tags: [Context]
 *     summary: Progressive context assembly for agent tasks
 *     description: |
 *       Assembles context in 4 progressive layers:
 *       - Layer 1 (depth=1): Task focus — node details + recent logs
 *       - Layer 2 (depth=2): Local neighborhood — parent, siblings, direct dependencies
 *       - Layer 3 (depth=3): Knowledge — plan-scoped knowledge entries
 *       - Layer 4 (depth=4): Extended — plan overview, ancestry, goals, transitive dependencies
 *     parameters:
 *       - in: query
 *         name: node_id
 *         required: true
 *         schema: { type: string }
 *       - in: query
 *         name: depth
 *         schema: { type: integer, minimum: 1, maximum: 4, default: 2 }
 *       - in: query
 *         name: token_budget
 *         schema: { type: integer, default: 0 }
 *         description: Max estimated tokens (0 = unlimited)
 *       - in: query
 *         name: log_limit
 *         schema: { type: integer, default: 10 }
 *       - in: query
 *         name: include_research
 *         schema: { type: boolean, default: true }
 *         description: Include research outputs from RPI chain siblings
 *     responses:
 *       200:
 *         description: Progressive context assembled
 */
router.get('/progressive', authenticate, async (req, res) => {
  try {
    const { node_id, depth = '2', token_budget = '0', log_limit = '10', include_research = 'true' } = req.query;
    const userId = req.user.id;

    if (!node_id) return res.status(400).json({ error: 'node_id is required' });

    const node = await nodesDal.findById(node_id);
    if (!node) return res.status(404).json({ error: 'Node not found' });

    const { hasAccess } = await plansDal.userHasAccess(node.planId, userId);
    if (!hasAccess) return res.status(403).json({ error: 'Access denied to this plan' });

    const context = await assembleContext(node_id, {
      depth: Number(depth),
      token_budget: Number(token_budget),
      log_limit: Number(log_limit),
      include_research: include_research !== 'false',
    });

    return res.json(context);
  } catch (error) {
    await logger.error('Progressive context error:', error);
    return res.status(500).json({ error: 'Failed to assemble context' });
  }
});

/**
 * @swagger
 * /context/suggest:
 *   get:
 *     tags: [Context]
 *     summary: Suggest next actionable tasks for a plan
 *     description: |
 *       Returns tasks that are ready to work on — all upstream dependencies are
 *       completed. Prioritizes RPI research tasks and high-impact tasks that
 *       unblock the most downstream work.
 *     parameters:
 *       - in: query
 *         name: plan_id
 *         required: true
 *         schema: { type: string }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 5 }
 *     responses:
 *       200:
 *         description: Suggested tasks
 */
router.get('/suggest', authenticate, async (req, res) => {
  try {
    const { plan_id, limit = '5' } = req.query;
    const userId = req.user.id;

    if (!plan_id) return res.status(400).json({ error: 'plan_id is required' });

    const { hasAccess } = await plansDal.userHasAccess(plan_id, userId);
    if (!hasAccess) return res.status(403).json({ error: 'Access denied to this plan' });

    const suggestions = await suggestNextTasks(plan_id, { limit: Number(limit) });
    return res.json({ suggestions, count: suggestions.length });
  } catch (error) {
    await logger.error('Suggest next tasks error:', error);
    return res.status(500).json({ error: 'Failed to suggest tasks' });
  }
});

/**
 * POST /context/compact
 * Trigger research output compaction for a completed research/plan node
 */
router.post('/compact', authenticate, async (req, res) => {
  try {
    const { node_id } = req.body;
    const userId = req.user.id;

    if (!node_id) return res.status(400).json({ error: 'node_id is required' });

    const node = await nodesDal.findById(node_id);
    if (!node) return res.status(404).json({ error: 'Node not found' });

    const { hasAccess } = await plansDal.userHasAccess(node.planId, userId);
    if (!hasAccess) return res.status(403).json({ error: 'Access denied' });

    const compacted = await compactResearchOutput(node_id);
    if (!compacted) {
      return res.status(400).json({ error: 'Nothing to compact (node must be research/plan mode with logs)' });
    }

    return res.json({ compacted });
  } catch (error) {
    await logger.error('Compaction error:', error);
    return res.status(500).json({ error: 'Failed to compact research output' });
  }
});

module.exports = router;
