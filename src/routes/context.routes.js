/**
 * Agent Context Routes
 */

const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth.middleware');
const { plansDal, nodesDal, knowledgeDal, goalsDal } = require('../db/dal.cjs');
const logger = require('../utils/logger');

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

    // Include knowledge if requested
    if (include_knowledge === 'true') {
      try {
        const knowledge = await knowledgeDal.listByScope('plan', planId, { limit: 50 });
        response.knowledge = knowledge;
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
        response.knowledge = await knowledgeDal.listByScope('plan', plan_id, { limit: 50 });
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

module.exports = router;
