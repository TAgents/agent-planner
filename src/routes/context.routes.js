/**
 * Agent Context Routes
 * 
 * Provides a single endpoint for agents to get all relevant context
 * starting from a specific task/node and traversing up the tree.
 * 
 * Design principle: Leaf-up context loading - only fetch what's relevant
 * to the specific task, not the entire plan tree.
 */

const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth.middleware');
const { supabaseAdmin } = require('../config/supabase');
const logger = require('../utils/logger');

/**
 * Helper: Check if user has access to a plan
 */
async function checkPlanAccess(planId, userId) {
  const { data: plan } = await supabaseAdmin
    .from('plans')
    .select('owner_id, visibility')
    .eq('id', planId)
    .single();

  if (!plan) return false;
  if (plan.owner_id === userId) return true;
  if (plan.visibility === 'public') return true;

  const { data: collab } = await supabaseAdmin
    .from('plan_collaborators')
    .select('role')
    .eq('plan_id', planId)
    .eq('user_id', userId)
    .single();

  return !!collab;
}

/**
 * Helper: Get node ancestry (leaf to root path)
 */
async function getAncestry(nodeId, planId) {
  const ancestry = [];
  let currentId = nodeId;

  while (currentId) {
    const { data: node } = await supabaseAdmin
      .from('plan_nodes')
      .select('id, parent_id, node_type, title, description, status, context, agent_instructions, acceptance_criteria')
      .eq('id', currentId)
      .eq('plan_id', planId)
      .single();

    if (!node) break;
    ancestry.push(node);
    currentId = node.parent_id;
  }

  return ancestry; // [task, phase, root] - leaf first
}

/**
 * Helper: Get knowledge entries for specific scopes
 */
async function getKnowledgeForScopes(scopes) {
  if (scopes.length === 0) return [];

  // Build OR conditions for each scope
  const conditions = scopes.map(s => `and(scope.eq.${s.scope},scope_id.eq.${s.scopeId})`).join(',');

  const { data: stores } = await supabaseAdmin
    .from('knowledge_stores')
    .select('id, scope, scope_id')
    .or(conditions);

  if (!stores || stores.length === 0) return [];

  const storeIds = stores.map(s => s.id);
  const storeMap = Object.fromEntries(stores.map(s => [s.id, { scope: s.scope, scope_id: s.scope_id }]));

  const { data: entries } = await supabaseAdmin
    .from('knowledge_entries')
    .select('id, store_id, entry_type, title, content, source_url, tags, created_at')
    .in('store_id', storeIds)
    .order('created_at', { ascending: false })
    .limit(50); // Cap to prevent context explosion

  return (entries || []).map(e => ({
    ...e,
    source_scope: storeMap[e.store_id]?.scope,
    source_scope_id: storeMap[e.store_id]?.scope_id,
    store_id: undefined // Remove internal ID
  }));
}

/**
 * @swagger
 * /context:
 *   get:
 *     summary: Get agent context for a specific node
 *     description: |
 *       Returns focused context for an agent working on a specific task.
 *       Traverses from the node up to root, including linked goals, org, and knowledge.
 *       
 *       Design: Leaf-up context loading - only returns what's relevant to the task,
 *       not the entire plan tree.
 *     tags: [Context]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: node_id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: The task or phase node to get context for
 *       - in: query
 *         name: include_knowledge
 *         schema:
 *           type: boolean
 *           default: true
 *         description: Include knowledge entries from relevant scopes
 *       - in: query
 *         name: include_siblings
 *         schema:
 *           type: boolean
 *           default: false
 *         description: Include sibling tasks (for understanding related work)
 *     responses:
 *       200:
 *         description: Agent context response
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 node:
 *                   type: object
 *                   description: The requested node (task/phase)
 *                 ancestry:
 *                   type: array
 *                   description: Path from node to root [node, parent, ..., root]
 *                 plan:
 *                   type: object
 *                   description: Plan details
 *                 goals:
 *                   type: array
 *                   description: Goals linked to this plan
 *                 organization:
 *                   type: object
 *                   description: Organization (if plan belongs to one)
 *                 knowledge:
 *                   type: array
 *                   description: Relevant knowledge entries tagged by source
 *                 siblings:
 *                   type: array
 *                   description: Sibling nodes (if include_siblings=true)
 */
router.get('/', authenticate, async (req, res) => {
  try {
    const { node_id, include_knowledge = 'true', include_siblings = 'false' } = req.query;
    const userId = req.user.id;

    if (!node_id) {
      return res.status(400).json({ error: 'node_id is required' });
    }

    // Get the node and its plan_id
    const { data: node, error: nodeError } = await supabaseAdmin
      .from('plan_nodes')
      .select('*, plan_id')
      .eq('id', node_id)
      .single();

    if (nodeError || !node) {
      return res.status(404).json({ error: 'Node not found' });
    }

    const planId = node.plan_id;

    // Check access
    const hasAccess = await checkPlanAccess(planId, userId);
    if (!hasAccess) {
      return res.status(403).json({ error: 'Access denied to this plan' });
    }

    // Get ancestry (leaf to root)
    const ancestry = await getAncestry(node_id, planId);

    // Get plan details
    const { data: plan } = await supabaseAdmin
      .from('plans')
      .select('id, title, description, status, visibility, github_repo_url, organization_id, created_at')
      .eq('id', planId)
      .single();

    // Get linked goals
    const { data: planGoals } = await supabaseAdmin
      .from('plan_goals')
      .select(`
        goal_id,
        goals (
          id,
          title,
          description,
          status,
          success_metrics,
          time_horizon,
          organization_id
        )
      `)
      .eq('plan_id', planId);

    const goals = planGoals?.map(pg => pg.goals).filter(Boolean) || [];

    // Get organization if plan has one
    let organization = null;
    if (plan?.organization_id) {
      const { data: org } = await supabaseAdmin
        .from('organizations')
        .select('id, name, slug, description')
        .eq('id', plan.organization_id)
        .single();
      organization = org;
    }

    // Build response
    const response = {
      node: {
        id: node.id,
        node_type: node.node_type,
        title: node.title,
        description: node.description,
        status: node.status,
        context: node.context,
        agent_instructions: node.agent_instructions,
        acceptance_criteria: node.acceptance_criteria
      },
      ancestry: ancestry.map(n => ({
        id: n.id,
        node_type: n.node_type,
        title: n.title,
        description: n.description,
        status: n.status
      })),
      plan: plan ? {
        id: plan.id,
        title: plan.title,
        description: plan.description,
        status: plan.status,
        github_repo_url: plan.github_repo_url
      } : null,
      goals: goals.map(g => ({
        id: g.id,
        title: g.title,
        description: g.description,
        status: g.status,
        success_metrics: g.success_metrics,
        time_horizon: g.time_horizon
      })),
      organization
    };

    // Include knowledge if requested
    if (include_knowledge === 'true') {
      const scopes = [];
      
      // Add plan scope
      scopes.push({ scope: 'plan', scopeId: planId });
      
      // Add goal scopes
      goals.forEach(g => {
        scopes.push({ scope: 'goal', scopeId: g.id });
      });
      
      // Add org scope
      if (organization) {
        scopes.push({ scope: 'organization', scopeId: organization.id });
      }

      response.knowledge = await getKnowledgeForScopes(scopes);
    }

    // Include siblings if requested (other tasks in same phase)
    if (include_siblings === 'true' && node.parent_id) {
      const { data: siblings } = await supabaseAdmin
        .from('plan_nodes')
        .select('id, node_type, title, status, order_index')
        .eq('parent_id', node.parent_id)
        .eq('plan_id', planId)
        .neq('id', node_id)
        .order('order_index');

      response.siblings = siblings || [];
    }

    // Log context fetch for analytics
    await logger.api(`Agent context fetched for node ${node_id} by user ${userId}`);

    return res.json(response);

  } catch (error) {
    await logger.error('Get agent context error:', error);
    return res.status(500).json({ error: 'Failed to get context' });
  }
});

/**
 * @swagger
 * /context/plan:
 *   get:
 *     summary: Get high-level plan context (without specific node focus)
 *     description: |
 *       Returns plan-level context for agents that need to understand the whole picture.
 *       Use /context?node_id=xxx for task-focused context.
 *     tags: [Context]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: plan_id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 */
router.get('/plan', authenticate, async (req, res) => {
  try {
    const { plan_id, include_knowledge = 'true' } = req.query;
    const userId = req.user.id;

    if (!plan_id) {
      return res.status(400).json({ error: 'plan_id is required' });
    }

    // Check access
    const hasAccess = await checkPlanAccess(plan_id, userId);
    if (!hasAccess) {
      return res.status(403).json({ error: 'Access denied to this plan' });
    }

    // Get plan with structure
    const { data: plan } = await supabaseAdmin
      .from('plans')
      .select('id, title, description, status, visibility, github_repo_url, organization_id, progress, created_at')
      .eq('id', plan_id)
      .single();

    if (!plan) {
      return res.status(404).json({ error: 'Plan not found' });
    }

    // Get phases with task summaries (not full tree, just phase-level)
    const { data: phases } = await supabaseAdmin
      .from('plan_nodes')
      .select('id, title, status, node_type')
      .eq('plan_id', plan_id)
      .eq('node_type', 'phase')
      .order('order_index');

    // Get task counts per phase
    const phaseSummaries = await Promise.all((phases || []).map(async (phase) => {
      const { count: totalTasks } = await supabaseAdmin
        .from('plan_nodes')
        .select('id', { count: 'exact', head: true })
        .eq('parent_id', phase.id)
        .eq('node_type', 'task');

      const { count: completedTasks } = await supabaseAdmin
        .from('plan_nodes')
        .select('id', { count: 'exact', head: true })
        .eq('parent_id', phase.id)
        .eq('node_type', 'task')
        .eq('status', 'completed');

      return {
        id: phase.id,
        title: phase.title,
        status: phase.status,
        total_tasks: totalTasks || 0,
        completed_tasks: completedTasks || 0
      };
    }));

    // Get linked goals
    const { data: planGoals } = await supabaseAdmin
      .from('plan_goals')
      .select(`goals (id, title, status, success_metrics)`)
      .eq('plan_id', plan_id);

    const goals = planGoals?.map(pg => pg.goals).filter(Boolean) || [];

    // Get organization
    let organization = null;
    if (plan.organization_id) {
      const { data: org } = await supabaseAdmin
        .from('organizations')
        .select('id, name, slug, description')
        .eq('id', plan.organization_id)
        .single();
      organization = org;
    }

    const response = {
      plan: {
        id: plan.id,
        title: plan.title,
        description: plan.description,
        status: plan.status,
        progress: plan.progress,
        github_repo_url: plan.github_repo_url
      },
      phases: phaseSummaries,
      goals,
      organization
    };

    // Include knowledge if requested
    if (include_knowledge === 'true') {
      const scopes = [{ scope: 'plan', scopeId: plan_id }];
      goals.forEach(g => scopes.push({ scope: 'goal', scopeId: g.id }));
      if (organization) scopes.push({ scope: 'organization', scopeId: organization.id });
      
      response.knowledge = await getKnowledgeForScopes(scopes);
    }

    return res.json(response);

  } catch (error) {
    await logger.error('Get plan context error:', error);
    return res.status(500).json({ error: 'Failed to get plan context' });
  }
});

module.exports = router;
