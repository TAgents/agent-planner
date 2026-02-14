/**
 * Node Controller v2 — Uses DAL instead of Supabase
 */
const { v4: uuidv4 } = require('uuid');
const dal = require('../db/dal.cjs');
const { broadcastPlanUpdate } = require('../websocket/broadcast');
const {
  createNodeCreatedMessage,
  createNodeUpdatedMessage,
  createNodeDeletedMessage,
  createNodeMovedMessage,
  createNodeStatusChangedMessage,
  createLogAddedMessage
} = require('../websocket/message-schema');
const { notifyStatusChange, notifyAgentRequested } = process.env.AUTH_VERSION === 'v2'
  ? require('../services/notifications.v2')
  : require('../services/notifications');

/**
 * Check plan access via DAL
 */
const checkPlanAccess = async (planId, userId, roles = []) => {
  const { hasAccess, role } = await dal.plansDal.userHasAccess(planId, userId);
  if (!hasAccess) return false;
  if (roles.length === 0) return true;
  return roles.includes(role);
};

/** Helper: snake_case output for API compatibility */
const snakeNode = (n) => ({
  id: n.id,
  plan_id: n.planId,
  parent_id: n.parentId,
  node_type: n.nodeType,
  title: n.title,
  description: n.description,
  status: n.status,
  order_index: n.orderIndex,
  due_date: n.dueDate,
  created_at: n.createdAt,
  updated_at: n.updatedAt,
  context: n.context,
  agent_instructions: n.agentInstructions,
  metadata: n.metadata,
  agent_requested: n.agentRequested,
  agent_requested_at: n.agentRequestedAt,
  agent_requested_by: n.agentRequestedBy,
  agent_request_message: n.agentRequestMessage,
  assigned_agent_id: n.assignedAgentId,
  assigned_agent_at: n.assignedAgentAt,
  assigned_agent_by: n.assignedAgentBy,
});

const snakeNodeMinimal = (n) => ({
  id: n.id,
  parent_id: n.parentId,
  node_type: n.nodeType,
  title: n.title,
  status: n.status,
  order_index: n.orderIndex,
});

/**
 * Get all nodes for a plan (tree structure)
 */
const getNodes = async (req, res, next) => {
  try {
    const { id: planId } = req.params;
    const { include_details } = req.query;
    const userId = req.user.id;

    if (!(await checkPlanAccess(planId, userId))) {
      return res.status(403).json({ error: 'You do not have access to this plan' });
    }

    const nodes = await dal.nodesDal.listByPlan(planId);
    const mapper = include_details === 'true' ? snakeNode : snakeNodeMinimal;
    const mapped = nodes.map(n => ({ ...mapper(n) }));

    // Build tree
    const buildTree = (parentId = null) =>
      mapped
        .filter(n => n.parent_id === parentId)
        .map(n => ({ ...n, children: buildTree(n.id) }));

    res.json(buildTree());
  } catch (error) {
    next(error);
  }
};

/**
 * Get a specific node
 */
const getNode = async (req, res, next) => {
  try {
    const { id: planId, nodeId } = req.params;
    const userId = req.user.id;

    if (!(await checkPlanAccess(planId, userId))) {
      return res.status(403).json({ error: 'You do not have access to this plan' });
    }

    const node = await dal.nodesDal.findById(nodeId);
    if (!node || node.planId !== planId) {
      return res.status(404).json({ error: 'Node not found' });
    }

    res.json(snakeNode(node));
  } catch (error) {
    next(error);
  }
};

/**
 * Create a new node in a plan
 */
const createNode = async (req, res, next) => {
  try {
    const { id: planId } = req.params;
    const {
      parent_id: parentId, node_type: nodeType, title, description,
      status, order_index: orderIndex, due_date: dueDate,
      context, agent_instructions: agentInstructions, metadata,
    } = req.body;
    const userId = req.user.id;

    if (!(await checkPlanAccess(planId, userId, ['owner', 'admin', 'editor']))) {
      return res.status(403).json({ error: 'You do not have permission to add nodes to this plan' });
    }

    if (!nodeType) return res.status(400).json({ error: 'Node type is required' });
    if (!title) return res.status(400).json({ error: 'Node title is required' });
    if (nodeType === 'root') return res.status(400).json({ error: 'Cannot create additional root nodes' });

    // Determine parent
    let parentIdToUse = parentId;
    if (parentIdToUse) {
      const parent = await dal.nodesDal.findById(parentIdToUse);
      if (!parent || parent.planId !== planId) {
        return res.status(400).json({ error: 'Parent node not found in this plan' });
      }
    } else {
      const root = await dal.nodesDal.getRoot(planId);
      if (!root) return res.status(500).json({ error: 'Plan structure is invalid (no root node)' });
      parentIdToUse = root.id;
    }

    // Determine order index
    let finalOrderIndex = orderIndex;
    if (finalOrderIndex === undefined) {
      const siblings = await dal.nodesDal.getChildren(parentIdToUse);
      finalOrderIndex = siblings.length > 0 ? Math.max(...siblings.map(s => s.orderIndex)) + 1 : 0;
    }

    const node = await dal.nodesDal.create({
      planId,
      parentId: parentIdToUse,
      nodeType,
      title,
      description: description || '',
      status: status || 'not_started',
      orderIndex: finalOrderIndex,
      dueDate: dueDate || null,
      context: context || description || '',
      agentInstructions: agentInstructions || null,
      metadata: metadata || {},
    });

    // Log creation
    await dal.logsDal.create({
      planNodeId: node.id,
      userId,
      content: `Created ${nodeType} "${title}"`,
      logType: 'progress',
    });

    // Broadcast
    const result = snakeNode(node);
    const userName = req.user.name || req.user.email;
    const message = createNodeCreatedMessage(result, userId, userName);
    await broadcastPlanUpdate(planId, message);

    res.status(201).json(result);
  } catch (error) {
    next(error);
  }
};

/**
 * Update a node
 */
const updateNode = async (req, res, next) => {
  try {
    const { id: planId, nodeId } = req.params;
    const {
      node_type: nodeType, title, description, status,
      order_index: orderIndex, due_date: dueDate,
      context, agent_instructions: agentInstructions, metadata,
    } = req.body;
    const userId = req.user.id;

    if (!(await checkPlanAccess(planId, userId, ['owner', 'admin', 'editor']))) {
      return res.status(403).json({ error: 'You do not have permission to update nodes in this plan' });
    }

    const existing = await dal.nodesDal.findById(nodeId);
    if (!existing || existing.planId !== planId) {
      return res.status(404).json({ error: 'Node not found in this plan' });
    }

    const oldStatus = existing.status;

    if (existing.nodeType === 'root' && nodeType && nodeType !== 'root') {
      return res.status(400).json({ error: 'Cannot change root node type' });
    }

    const updates = {};
    if (nodeType !== undefined) updates.nodeType = nodeType;
    if (title !== undefined) updates.title = title;
    if (description !== undefined) updates.description = description;
    if (status !== undefined) updates.status = status;
    if (orderIndex !== undefined) updates.orderIndex = orderIndex;
    if (dueDate !== undefined) updates.dueDate = dueDate;
    if (context !== undefined) updates.context = context;
    if (agentInstructions !== undefined) updates.agentInstructions = agentInstructions;
    if (metadata !== undefined) updates.metadata = metadata;

    const updated = await dal.nodesDal.update(nodeId, updates);
    const result = snakeNode(updated);

    // Log + notify on status change
    if (status !== undefined && oldStatus !== status) {
      await dal.logsDal.create({
        planNodeId: nodeId,
        userId,
        content: `Updated status to ${status}`,
        logType: 'progress',
      });

      const plan = await dal.plansDal.findById(planId);
      if (plan) {
        const actor = { name: req.user.name || req.user.email, type: 'user' };
        notifyStatusChange(result, { id: plan.id, title: plan.title, owner_id: plan.ownerId }, actor, oldStatus, status).catch(console.error);
      }
    }

    const userName = req.user.name || req.user.email;
    const message = createNodeUpdatedMessage(result, userId, userName);
    await broadcastPlanUpdate(planId, message);

    res.json(result);
  } catch (error) {
    next(error);
  }
};

/**
 * Delete a node (FK cascade handles children)
 */
const deleteNode = async (req, res, next) => {
  try {
    const { id: planId, nodeId } = req.params;
    const userId = req.user.id;

    if (!(await checkPlanAccess(planId, userId, ['owner', 'admin', 'editor']))) {
      return res.status(403).json({ error: 'You do not have permission to delete nodes in this plan' });
    }

    const node = await dal.nodesDal.findById(nodeId);
    if (!node || node.planId !== planId) {
      return res.status(404).json({ error: 'Node not found in this plan' });
    }

    if (node.nodeType === 'root') {
      return res.status(400).json({ error: 'Cannot delete root node' });
    }

    await dal.nodesDal.deleteWithChildren(nodeId);

    const userName = req.user.name || req.user.email;
    const message = createNodeDeletedMessage(nodeId, planId, userId, userName);
    await broadcastPlanUpdate(planId, message);

    res.status(204).send();
  } catch (error) {
    next(error);
  }
};

/** Deprecated */
const addComment = async (req, res) => {
  res.status(410).json({ error: 'Comments removed. Use logs endpoint.' });
};
const getComments = async (req, res) => {
  res.status(410).json({ error: 'Comments removed. Use logs endpoint.' });
};

/**
 * Get detailed context for a node
 */
const getNodeContext = async (req, res, next) => {
  try {
    const { id: planId, nodeId } = req.params;
    const userId = req.user.id;

    if (!(await checkPlanAccess(planId, userId))) {
      return res.status(403).json({ error: 'You do not have access to this plan' });
    }

    const node = await dal.nodesDal.findById(nodeId);
    if (!node || node.planId !== planId) {
      return res.status(404).json({ error: 'Node not found' });
    }

    const [logs, childNodes, plan] = await Promise.all([
      dal.logsDal.listByNode(nodeId, { limit: 10 }),
      dal.nodesDal.getChildren(nodeId),
      dal.plansDal.findById(planId),
    ]);

    res.json({
      plan: plan ? { id: plan.id, title: plan.title, description: plan.description, status: plan.status } : null,
      node: snakeNode(node),
      children: childNodes.map(c => ({
        id: c.id, node_type: c.nodeType, title: c.title,
        description: c.description, status: c.status,
      })),
      logs: logs.map(l => ({
        id: l.id, content: l.content, log_type: l.logType,
        created_at: l.createdAt, user: { id: l.userId, name: l.userName, email: l.userEmail },
      })),
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get ancestry path
 */
const getNodeAncestry = async (req, res, next) => {
  try {
    const { id: planId, nodeId } = req.params;
    const userId = req.user.id;

    if (!(await checkPlanAccess(planId, userId))) {
      return res.status(403).json({ error: 'You do not have access to this plan' });
    }

    // Build ancestry by walking up
    const ancestry = [];
    let currentId = nodeId;
    while (currentId) {
      const node = await dal.nodesDal.findById(currentId);
      if (!node || node.planId !== planId) break;
      ancestry.unshift({
        id: node.id, parent_id: node.parentId, node_type: node.nodeType,
        title: node.title, description: node.description, status: node.status,
      });
      if (node.nodeType === 'root' || !node.parentId) break;
      currentId = node.parentId;
    }

    const plan = await dal.plansDal.findById(planId);

    res.json({
      plan: plan ? { id: plan.id, title: plan.title, description: plan.description, status: plan.status } : null,
      ancestry,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Update node status
 */
const updateNodeStatus = async (req, res, next) => {
  try {
    const { id: planId, nodeId } = req.params;
    const { status } = req.body;
    const userId = req.user.id;

    if (!(await checkPlanAccess(planId, userId, ['owner', 'admin', 'editor']))) {
      return res.status(403).json({ error: 'You do not have permission to update nodes' });
    }

    if (!status) return res.status(400).json({ error: 'Status is required' });

    const validStatuses = ['not_started', 'in_progress', 'completed', 'blocked'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: `Invalid status. Valid: ${validStatuses.join(', ')}` });
    }

    const existing = await dal.nodesDal.findById(nodeId);
    if (!existing || existing.planId !== planId) {
      return res.status(404).json({ error: 'Node not found' });
    }

    const oldStatus = existing.status;
    const updated = await dal.nodesDal.updateStatus(nodeId, status);
    const result = snakeNode(updated);

    await dal.logsDal.create({
      planNodeId: nodeId, userId,
      content: `Updated status to ${status}`, logType: 'progress',
    });

    const userName = req.user.name || req.user.email;
    const message = createNodeStatusChangedMessage(nodeId, planId, oldStatus, status, userId, userName);
    await broadcastPlanUpdate(planId, message);

    res.json(result);
  } catch (error) {
    next(error);
  }
};

/**
 * Move a node
 */
const moveNode = async (req, res, next) => {
  try {
    const { id: planId, nodeId } = req.params;
    const { parent_id: newParentId, order_index: newOrderIndex } = req.body;
    const userId = req.user.id;

    if (!(await checkPlanAccess(planId, userId, ['owner', 'admin', 'editor']))) {
      return res.status(403).json({ error: 'You do not have permission to move nodes' });
    }

    const node = await dal.nodesDal.findById(nodeId);
    if (!node || node.planId !== planId) {
      return res.status(404).json({ error: 'Node not found' });
    }

    if (node.nodeType === 'root') {
      return res.status(400).json({ error: 'Cannot move root nodes' });
    }

    const oldParentId = node.parentId;
    const oldOrderIndex = node.orderIndex;

    if (newParentId && newParentId !== node.parentId) {
      const parent = await dal.nodesDal.findById(newParentId);
      if (!parent || parent.planId !== planId) {
        return res.status(404).json({ error: 'Parent node not found' });
      }
      await dal.nodesDal.move(nodeId, newParentId);
    }

    if (newOrderIndex !== undefined) {
      await dal.nodesDal.reorder(nodeId, newOrderIndex);
    }

    const updated = await dal.nodesDal.findById(nodeId);
    const result = snakeNode(updated);

    const logMsg = newParentId && newParentId !== oldParentId
      ? `Moved "${node.title}" to a different parent`
      : `Reordered "${node.title}"`;

    await dal.logsDal.create({
      planNodeId: nodeId, userId, content: logMsg, logType: 'progress',
    });

    const userName = req.user.name || req.user.email;
    const moveData = { oldParentId, newParentId: updated.parentId, oldOrderIndex, newOrderIndex: updated.orderIndex };
    const message = createNodeMovedMessage(nodeId, planId, moveData, userId, userName);
    await broadcastPlanUpdate(planId, message);

    res.json(result);
  } catch (error) {
    next(error);
  }
};

/**
 * Add a log entry
 */
const addLogEntry = async (req, res, next) => {
  try {
    const { id: planId, nodeId } = req.params;
    const { content, log_type, actor_type } = req.body;
    const userId = req.user.id;

    if (!(await checkPlanAccess(planId, userId))) {
      return res.status(403).json({ error: 'You do not have access to this plan' });
    }

    const node = await dal.nodesDal.findById(nodeId);
    if (!node || node.planId !== planId) {
      return res.status(404).json({ error: 'Node not found in this plan' });
    }

    if (!content) return res.status(400).json({ error: 'Log content is required' });

    const validLogTypes = ['progress', 'reasoning', 'challenge', 'decision'];
    const logType = log_type || 'progress';
    if (!validLogTypes.includes(logType)) {
      return res.status(400).json({ error: `Invalid log type. Valid: ${validLogTypes.join(', ')}` });
    }

    const metadata = actor_type ? { actor_type } : {};

    const log = await dal.logsDal.create({
      planNodeId: nodeId, userId, content,
      logType, metadata,
    });

    const result = {
      id: log.id, content: log.content, log_type: log.logType,
      created_at: log.createdAt, plan_node_id: log.planNodeId,
      user_id: log.userId, metadata: log.metadata,
    };

    const userName = req.user.name || req.user.email;
    const message = createLogAddedMessage(result, planId, userName);
    await broadcastPlanUpdate(planId, message);

    res.status(201).json(result);
  } catch (error) {
    next(error);
  }
};

/**
 * Get logs for a node
 */
const getNodeLogs = async (req, res, next) => {
  try {
    const { id: planId, nodeId } = req.params;
    const userId = req.user.id;

    if (!(await checkPlanAccess(planId, userId))) {
      return res.status(403).json({ error: 'You do not have access to this plan' });
    }

    const node = await dal.nodesDal.findById(nodeId);
    if (!node || node.planId !== planId) {
      return res.status(404).json({ error: 'Node not found in this plan' });
    }

    const logs = await dal.logsDal.listByNode(nodeId);

    res.json(logs.map(l => ({
      id: l.id, content: l.content, log_type: l.logType,
      created_at: l.createdAt, user_id: l.userId,
      actor_type: l.metadata?.actor_type || 'human',
      user: { id: l.userId, name: l.userName, email: l.userEmail },
    })));
  } catch (error) {
    next(error);
  }
};

/**
 * Request agent assistance
 */
const requestAgent = async (req, res, next) => {
  try {
    const { id: planId, nodeId } = req.params;
    const { request_type, message } = req.body;
    const userId = req.user.id;

    const validTypes = ['start', 'review', 'help', 'continue'];
    if (!request_type || !validTypes.includes(request_type)) {
      return res.status(400).json({ error: `Invalid request_type. Must be: ${validTypes.join(', ')}` });
    }

    if (!(await checkPlanAccess(planId, userId))) {
      return res.status(403).json({ error: 'You do not have access to this plan' });
    }

    const node = await dal.nodesDal.findById(nodeId);
    if (!node || node.planId !== planId) {
      return res.status(404).json({ error: 'Node not found in this plan' });
    }

    const updated = await dal.nodesDal.setAgentRequest(nodeId, {
      type: request_type, message: message || null, requestedBy: userId,
    });

    const userName = req.user.name || req.user.email;
    await dal.logsDal.create({
      planNodeId: nodeId, userId,
      content: `Requested agent to ${request_type}${message ? `: "${message}"` : ''}`,
      logType: 'progress',
    });

    // Notify async
    (async () => {
      try {
        const plan = await dal.plansDal.findById(planId);
        if (plan) {
          await notifyAgentRequested(
            snakeNode(updated),
            { id: plan.id, title: plan.title, owner_id: plan.ownerId },
            { name: userName },
            plan.ownerId,
          );
        }
      } catch (e) { console.error('Agent request notification error:', e); }
    })();

    res.json(snakeNode(updated));
  } catch (error) {
    next(error);
  }
};

const clearAgentRequest = async (req, res, next) => {
  try {
    const { id: planId, nodeId } = req.params;
    const userId = req.user.id;

    if (!(await checkPlanAccess(planId, userId))) {
      return res.status(403).json({ error: 'You do not have access to this plan' });
    }

    const updated = await dal.nodesDal.clearAgentRequest(nodeId);
    if (!updated || updated.planId !== planId) {
      return res.status(404).json({ error: 'Node not found in this plan' });
    }

    res.json(snakeNode(updated));
  } catch (error) {
    next(error);
  }
};

const assignAgent = async (req, res, next) => {
  try {
    const { id: planId, nodeId } = req.params;
    const { agent_id } = req.body;
    const userId = req.user.id;

    if (!agent_id) return res.status(400).json({ error: 'agent_id is required' });

    if (!(await checkPlanAccess(planId, userId, ['owner', 'admin', 'editor']))) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }

    const node = await dal.nodesDal.findById(nodeId);
    if (!node || node.planId !== planId) {
      return res.status(404).json({ error: 'Node not found in this plan' });
    }

    const agent = await dal.usersDal.findById(agent_id);
    if (!agent) return res.status(404).json({ error: 'Agent not found' });

    const updated = await dal.nodesDal.assignAgent(nodeId, { agentId: agent_id, assignedBy: userId });

    res.json({
      ...snakeNode(updated),
      agent: { id: agent.id, name: agent.name, email: agent.email, capability_tags: agent.capabilityTags },
    });
  } catch (error) {
    next(error);
  }
};

const unassignAgent = async (req, res, next) => {
  try {
    const { id: planId, nodeId } = req.params;
    const userId = req.user.id;

    if (!(await checkPlanAccess(planId, userId, ['owner', 'admin', 'editor']))) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }

    await dal.nodesDal.update(nodeId, {
      assignedAgentId: null, assignedAgentAt: null, assignedAgentBy: null,
    });

    res.status(204).send();
  } catch (error) {
    next(error);
  }
};

const getSuggestedAgents = async (req, res, next) => {
  try {
    // Simple implementation — list users with capability tags
    const users = await dal.usersDal.list({ limit: 20 });
    const agents = users.filter(u => u.capabilityTags && u.capabilityTags.length > 0);
    res.json({ agents: agents.map(a => ({
      id: a.id, name: a.name, email: a.email,
      avatar_url: a.avatarUrl, capability_tags: a.capabilityTags,
    })) });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getNodes, getNode, createNode, updateNode, deleteNode,
  addComment, getComments, getNodeContext, getNodeAncestry,
  updateNodeStatus, moveNode, addLogEntry, getNodeLogs,
  requestAgent, clearAgentRequest, assignAgent, unassignAgent, getSuggestedAgents,
};
