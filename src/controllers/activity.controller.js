const { v4: uuidv4 } = require('uuid');
const { plansDal, nodesDal, logsDal, commentsDal, decisionsDal, knowledgeDal } = require('../db/dal.cjs');

/**
 * Get all activity logs for a plan
 */
const getPlanActivity = async (req, res, next) => {
  try {
    const { id: planId } = req.params;
    const userId = req.user.id;
    const { page = 1, limit = 20, type } = req.query;

    const pageNum = parseInt(page, 10);
    const limitNum = parseInt(limit, 10);

    if (isNaN(pageNum) || pageNum < 1) {
      return res.status(400).json({ error: 'Page must be a positive number' });
    }
    if (isNaN(limitNum) || limitNum < 1 || limitNum > 100) {
      return res.status(400).json({ error: 'Limit must be between 1 and 100' });
    }

    const { hasAccess } = await plansDal.userHasAccess(planId, userId);
    if (!hasAccess) {
      return res.status(403).json({ error: 'You do not have access to this plan' });
    }

    const nodes = await nodesDal.listByPlan(planId);
    const nodeIds = nodes.map(n => n.id);
    const nodesMap = Object.fromEntries(nodes.map(n => [n.id, n]));

    const offset = (pageNum - 1) * limitNum;

    const logs = await logsDal.listByNodes(nodeIds, { limit: limitNum, offset, logType: type || undefined });
    const count = await logsDal.countByNodes(nodeIds);

    const enhancedLogs = logs.map(log => ({
      ...log,
      node: nodesMap[log.planNodeId]
    }));

    res.json({
      logs: enhancedLogs,
      pagination: { page: pageNum, limit: limitNum, total: count, pages: Math.ceil(count / limitNum) }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get activity feed for a user across all plans they have access to
 */
const getUserActivityFeed = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { page = 1, limit = 20 } = req.query;

    const pageNum = parseInt(page, 10);
    const limitNum = parseInt(limit, 10);

    if (isNaN(pageNum) || pageNum < 1) {
      return res.status(400).json({ error: 'Page must be a positive number' });
    }
    if (isNaN(limitNum) || limitNum < 1 || limitNum > 100) {
      return res.status(400).json({ error: 'Limit must be between 1 and 100' });
    }

    const offset = (pageNum - 1) * limitNum;

    // Get all plans the user has access to
    const { owned, shared } = await plansDal.listForUser(userId);
    const allPlans = [...owned, ...shared];
    const planIds = allPlans.map(p => p.id);
    const plansMap = Object.fromEntries(allPlans.map(p => [p.id, p]));

    if (planIds.length === 0) {
      return res.json({
        activities: [],
        pagination: { page: pageNum, limit: limitNum, total: 0, pages: 0 }
      });
    }

    // Get all nodes for these plans
    const allNodes = [];
    for (const planId of planIds) {
      const nodes = await nodesDal.listByPlan(planId);
      allNodes.push(...nodes);
    }
    const nodeIds = allNodes.map(n => n.id);
    const nodesMap = Object.fromEntries(allNodes.map(n => [n.id, n]));

    // Get recent logs and comments
    const logs = await logsDal.listByNodes(nodeIds, { limit: limitNum, offset });
    const comments = await commentsDal.listByNodes(nodeIds, { limit: limitNum, offset });

    const logsCount = await logsDal.countByNodes(nodeIds);
    const commentsCount = await commentsDal.countByNodes(nodeIds);
    const totalCount = logsCount + commentsCount;

    const logActivities = logs.map(log => ({
      id: log.id,
      type: 'log',
      content: log.content,
      activity_type: log.logType,
      created_at: log.createdAt,
      user: { id: log.userId, name: log.userName, email: log.userEmail },
      node: nodesMap[log.planNodeId],
      plan: nodesMap[log.planNodeId] ? plansMap[nodesMap[log.planNodeId].planId] : null
    }));

    const commentActivities = comments.map(comment => ({
      id: comment.id,
      type: 'comment',
      content: comment.content,
      activity_type: comment.commentType,
      created_at: comment.createdAt,
      user: { id: comment.userId, name: comment.userName, email: comment.userEmail },
      node: nodesMap[comment.planNodeId],
      plan: nodesMap[comment.planNodeId] ? plansMap[nodesMap[comment.planNodeId].planId] : null
    }));

    const allActivities = [...logActivities, ...commentActivities]
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
      .slice(0, limitNum);

    res.json({
      activities: allActivities,
      pagination: { page: pageNum, limit: limitNum, total: totalCount, pages: Math.ceil(totalCount / limitNum) }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get recent activity for a specific node
 */
const getNodeActivity = async (req, res, next) => {
  try {
    const { id: planId, nodeId } = req.params;
    const userId = req.user.id;
    const { limit = 10 } = req.query;
    const limitNum = parseInt(limit, 10);

    if (isNaN(limitNum) || limitNum < 1 || limitNum > 100) {
      return res.status(400).json({ error: 'Limit must be between 1 and 100' });
    }

    const { hasAccess } = await plansDal.userHasAccess(planId, userId);
    if (!hasAccess) {
      return res.status(403).json({ error: 'You do not have access to this plan' });
    }

    const node = await nodesDal.findByIdAndPlan(nodeId, planId);
    if (!node) {
      return res.status(404).json({ error: 'Node not found in this plan' });
    }

    const logs = await logsDal.listByNode(nodeId, { limit: limitNum });
    const comments = await commentsDal.listByNode(nodeId, { limit: limitNum });

    const logActivities = logs.map(log => ({
      id: log.id, type: 'log', content: log.content, activity_type: log.logType,
      created_at: log.createdAt, user: { id: log.userId, name: log.userName, email: log.userEmail }
    }));

    const commentActivities = comments.map(c => ({
      id: c.id, type: 'comment', content: c.content, activity_type: c.commentType,
      created_at: c.createdAt, user: { id: c.userId, name: c.userName, email: c.userEmail }
    }));

    const allActivities = [...logActivities, ...commentActivities]
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
      .slice(0, limitNum);

    res.json({ node, activities: allActivities });
  } catch (error) {
    next(error);
  }
};

/**
 * Add a detailed log entry
 */
const addDetailedLog = async (req, res, next) => {
  try {
    const { id: planId, nodeId } = req.params;
    const { content, log_type, metadata, tags } = req.body;
    const userId = req.user.id;

    const { hasAccess } = await plansDal.userHasAccess(planId, userId);
    if (!hasAccess) {
      return res.status(403).json({ error: 'You do not have access to this plan' });
    }

    const node = await nodesDal.findByIdAndPlan(nodeId, planId);
    if (!node) {
      return res.status(404).json({ error: 'Node not found in this plan' });
    }

    if (!content) {
      return res.status(400).json({ error: 'Log content is required' });
    }

    const validLogTypes = ['progress', 'reasoning', 'challenge', 'decision'];
    const finalLogType = log_type || 'progress';
    if (!validLogTypes.includes(finalLogType)) {
      return res.status(400).json({ error: `Invalid log type. Valid values are: ${validLogTypes.join(', ')}` });
    }

    const log = await logsDal.create({
      id: uuidv4(),
      planNodeId: nodeId,
      userId,
      content,
      logType: finalLogType,
      metadata: metadata || {},
      tags: tags || [],
    });

    res.status(201).json(log);
  } catch (error) {
    next(error);
  }
};

/**
 * Get the activity timeline for a plan
 */
const getPlanTimeline = async (req, res, next) => {
  try {
    const { id: planId } = req.params;
    const userId = req.user.id;

    const { hasAccess } = await plansDal.userHasAccess(planId, userId);
    if (!hasAccess) {
      return res.status(403).json({ error: 'You do not have access to this plan' });
    }

    const plan = await plansDal.findById(planId);
    if (!plan) {
      return res.status(404).json({ error: 'Plan not found' });
    }

    const nodes = await nodesDal.listByPlan(planId);
    const nodeIds = nodes.map(n => n.id);
    const nodesMap = Object.fromEntries(nodes.map(n => [n.id, n]));

    const logs = await logsDal.listByNodes(nodeIds, { limit: 10000 });

    const timeline = [
      // Plan creation
      {
        id: `plan-creation-${planId}`,
        type: 'plan_created',
        date: plan.createdAt,
        title: `Plan "${plan.title}" created`,
        description: plan.description || '',
        entity_id: planId,
        entity_type: 'plan'
      },
      // Node creation events
      ...nodes.map(node => ({
        id: `node-creation-${node.id}`,
        type: 'node_created',
        date: node.createdAt,
        title: `${node.nodeType.charAt(0).toUpperCase() + node.nodeType.slice(1)} "${node.title}" created`,
        description: '',
        entity_id: node.id,
        entity_type: 'node',
        node_type: node.nodeType,
        status: node.status
      })),
      // Significant logs
      ...logs
        .filter(log =>
          log.content.includes('Updated status to') ||
          log.logType === 'decision' ||
          log.content.includes('Moved "')
        )
        .map(log => ({
          id: log.id,
          type: 'log',
          date: log.createdAt,
          title: log.content,
          description: '',
          entity_id: log.planNodeId,
          entity_type: 'node',
          node_title: nodesMap[log.planNodeId]?.title || '',
          node_type: nodesMap[log.planNodeId]?.nodeType || '',
          user: { id: log.userId, name: log.userName, email: log.userEmail }
        }))
    ];

    // Get decisions
    try {
      const decisions = await decisionsDal.listByPlan(planId);
      decisions.forEach(dec => {
        timeline.push({
          id: `decision-requested-${dec.id}`,
          type: 'decision_requested',
          date: dec.createdAt,
          title: `Decision requested: "${dec.title}"`,
          description: dec.context?.substring(0, 200) + (dec.context?.length > 200 ? '...' : ''),
          entity_id: dec.id,
          entity_type: 'decision',
          urgency: dec.urgency,
          actor_type: dec.requestedByAgentName ? 'agent' : 'human',
          actor_name: dec.requestedByAgentName,
          node_id: dec.nodeId
        });

        if (dec.status === 'decided' && dec.decidedAt) {
          timeline.push({
            id: `decision-resolved-${dec.id}`,
            type: 'decision_resolved',
            date: dec.decidedAt,
            title: `Decision made: "${dec.title}"`,
            description: dec.decision,
            entity_id: dec.id,
            entity_type: 'decision',
            rationale: dec.rationale
          });
        }
      });
    } catch (e) {
      // Decisions query may fail if table doesn't exist
    }

    // Sort timeline by date
    timeline.sort((a, b) => new Date(a.date) - new Date(b.date));

    res.json({ plan, timeline });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getPlanActivity,
  getUserActivityFeed,
  getNodeActivity,
  addDetailedLog,
  getPlanTimeline
};
