const { v4: uuidv4 } = require('uuid');
const { plansDal, nodesDal, usersDal, logsDal } = require('../db/dal.cjs');
const { broadcastPlanUpdate } = require('../websocket/broadcast');
const {
  createNodeCreatedMessage,
  createNodeUpdatedMessage,
  createNodeDeletedMessage,
  createNodeMovedMessage,
  createNodeStatusChangedMessage,
  createLogAddedMessage
} = require('../websocket/message-schema');
const { notifyStatusChange, notifyAgentRequested } = require('../services/notifications');
const logger = require('../utils/logger');

/**
 * Helper function to check if a user has access to a plan with specified roles
 */
const checkPlanAccess = async (planId, userId, roles = []) => {
  try {
    const { hasAccess, role } = await plansDal.userHasAccess(planId, userId);
    if (!hasAccess) return false;
    if (roles.length > 0) return roles.includes(role);
    return true;
  } catch (error) {
    return false;
  }
};

/**
 * Get all nodes for a plan (tree structure)
 */
const getNodes = async (req, res, next) => {
  try {
    const { id: planId } = req.params;
    const userId = req.user.id;

    const hasAccess = await checkPlanAccess(planId, userId);
    if (!hasAccess) {
      return res.status(403).json({ error: 'You do not have access to this plan' });
    }

    const nodes = await nodesDal.listByPlan(planId);

    // Build hierarchical structure
    const buildTree = (parentId = null) => {
      return nodes
        .filter(node => node.parentId === parentId)
        .map(node => ({
          ...node,
          children: buildTree(node.id),
        }));
    };

    const tree = buildTree();
    res.json(tree);
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

    const hasAccess = await checkPlanAccess(planId, userId);
    if (!hasAccess) {
      return res.status(403).json({ error: 'You do not have access to this plan' });
    }

    const node = await nodesDal.findByIdAndPlan(nodeId, planId);
    if (!node) {
      return res.status(404).json({ error: 'Node not found' });
    }

    res.json(node);
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
      parent_id: parentId,
      node_type: nodeType,
      title,
      description,
      status,
      order_index: orderIndex,
      due_date: dueDate,
      context,
      agent_instructions: agentInstructions,
      metadata,
    } = req.body;
    const userId = req.user.id;

    const hasAccess = await checkPlanAccess(planId, userId, ['owner', 'admin', 'editor']);
    if (!hasAccess) {
      return res.status(403).json({ error: 'You do not have permission to add nodes to this plan' });
    }

    if (!nodeType) return res.status(400).json({ error: 'Node type is required' });
    if (!title) return res.status(400).json({ error: 'Node title is required' });
    if (nodeType === 'root') return res.status(400).json({ error: 'Cannot create additional root nodes (only one allowed)' });

    // Determine parent
    let parentIdToUse = parentId;
    if (parentIdToUse) {
      const parentNode = await nodesDal.findByIdAndPlan(parentIdToUse, planId);
      if (!parentNode) return res.status(400).json({ error: 'Parent node not found in this plan' });
    } else {
      const rootNode = await nodesDal.getRoot(planId);
      if (!rootNode) return res.status(500).json({ error: 'Plan structure is invalid (no root node)' });
      parentIdToUse = rootNode.id;
    }

    // Determine order index
    let finalOrderIndex = orderIndex;
    if (finalOrderIndex === undefined) {
      const maxOrder = await nodesDal.getMaxSiblingOrder(planId, parentIdToUse);
      finalOrderIndex = maxOrder + 1;
    }

    const now = new Date();
    const nodeId = uuidv4();

    let newNode;
    try {
      newNode = await nodesDal.create({
        id: nodeId,
        planId,
        parentId: parentIdToUse,
        nodeType,
        title,
        description: description || '',
        status: status || 'not_started',
        orderIndex: finalOrderIndex,
        dueDate: dueDate || null,
        createdAt: now,
        updatedAt: now,
        context: context || description || '',
        agentInstructions: agentInstructions || null,
        metadata: metadata || {},
      });
    } catch (dbError) {
      // Handle unique constraint violation — return existing node (idempotent create)
      if (dbError.code === '23505' && dbError.constraint === 'plan_nodes_unique_title_per_parent') {
        const siblings = await nodesDal.getChildren(planId, parentIdToUse);
        const existing = siblings.find(s => s.title === title && s.node_type === nodeType);
        if (existing) {
          return res.status(200).json(existing);
        }
      }
      throw dbError;
    }

    // Add log entry
    await logsDal.create({
      id: uuidv4(),
      planNodeId: nodeId,
      userId,
      content: `Created ${nodeType} "${title}"`,
      logType: 'progress',
      createdAt: now,
    });

    // Broadcast
    const userName = req.user.name || req.user.email;
    const message = createNodeCreatedMessage(newNode, userId, userName);
    await broadcastPlanUpdate(planId, message);

    res.status(201).json(newNode);
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
      node_type: nodeType,
      title,
      description,
      status,
      order_index: orderIndex,
      due_date: dueDate,
      context,
      agent_instructions: agentInstructions,
      metadata,
    } = req.body;
    const userId = req.user.id;

    const hasAccess = await checkPlanAccess(planId, userId, ['owner', 'admin', 'editor']);
    if (!hasAccess) {
      return res.status(403).json({ error: 'You do not have permission to update nodes in this plan' });
    }

    const existingNode = await nodesDal.findByIdAndPlan(nodeId, planId);
    if (!existingNode) {
      return res.status(404).json({ error: 'Node not found in this plan' });
    }

    const oldStatus = existingNode.status;

    if (existingNode.nodeType === 'root' && nodeType && nodeType !== 'root') {
      return res.status(400).json({ error: 'Cannot change root node type' });
    }

    // Build updates
    const updates = { updatedAt: new Date() };
    if (nodeType !== undefined) updates.nodeType = nodeType;
    if (title !== undefined) updates.title = title;
    if (description !== undefined) updates.description = description;
    if (status !== undefined) updates.status = status;
    if (orderIndex !== undefined) updates.orderIndex = orderIndex;
    if (dueDate !== undefined) updates.dueDate = dueDate;
    if (context !== undefined) updates.context = context;
    if (agentInstructions !== undefined) updates.agentInstructions = agentInstructions;
    if (metadata !== undefined) updates.metadata = metadata;

    const updatedNode = await nodesDal.update(nodeId, updates);

    // Log status change
    if (status !== undefined) {
      await logsDal.create({
        id: uuidv4(),
        planNodeId: nodeId,
        userId,
        content: `Updated status to ${status}`,
        logType: 'progress',
        createdAt: new Date(),
      });

      if (oldStatus !== status) {
        const plan = await plansDal.findById(planId);
        if (plan) {
          const actor = { name: req.user.name || req.user.email, type: 'user' };
          notifyStatusChange(updatedNode, plan, actor, oldStatus, status).catch(err => {
            console.error('Notification error:', err);
          });
        }
      }
    }

    // Broadcast
    const userName = req.user.name || req.user.email;
    const message = createNodeUpdatedMessage(updatedNode, userId, userName);
    await broadcastPlanUpdate(planId, message);

    res.json(updatedNode);
  } catch (error) {
    next(error);
  }
};

/**
 * Delete a node
 */
const deleteNode = async (req, res, next) => {
  try {
    const { id: planId, nodeId } = req.params;
    const userId = req.user.id;

    const hasAccess = await checkPlanAccess(planId, userId, ['owner', 'admin', 'editor']);
    if (!hasAccess) {
      return res.status(403).json({ error: 'You do not have permission to delete nodes in this plan' });
    }

    const node = await nodesDal.findByIdAndPlan(nodeId, planId);
    if (!node) {
      return res.status(404).json({ error: 'Node not found in this plan' });
    }

    if (node.nodeType === 'root') {
      return res.status(400).json({ error: 'Cannot delete root node' });
    }

    // Collect all descendant IDs recursively
    const getAllChildrenIds = async (parentId) => {
      const children = await nodesDal.getChildren(parentId);
      let ids = [parentId];
      for (const child of children) {
        const childIds = await getAllChildrenIds(child.id);
        ids = [...ids, ...childIds];
      }
      return ids;
    };

    const nodeIdsToDelete = await getAllChildrenIds(nodeId);

    // Delete all nodes (FK cascades handle comments, labels, logs)
    await nodesDal.deleteByIds(nodeIdsToDelete);

    // Broadcast
    const userName = req.user.name || req.user.email;
    const message = createNodeDeletedMessage(nodeId, planId, userId, userName);
    await broadcastPlanUpdate(planId, message);

    res.status(204).send();
  } catch (error) {
    next(error);
  }
};

/**
 * Add a comment to a node - DEPRECATED
 */
const addComment = async (req, res, next) => {
  return res.status(410).json({ 
    error: 'Comments functionality has been removed. Please use logs endpoint instead.' 
  });
};

/**
 * Get comments for a node - DEPRECATED
 */
const getComments = async (req, res, next) => {
  return res.status(410).json({ 
    error: 'Comments functionality has been removed. Please use logs endpoint instead.' 
  });
};

/**
 * Get detailed context for a specific node
 */
const getNodeContext = async (req, res, next) => {
  try {
    const { id: planId, nodeId } = req.params;
    const userId = req.user.id;

    const hasAccess = await checkPlanAccess(planId, userId);
    if (!hasAccess) {
      return res.status(403).json({ error: 'You do not have access to this plan' });
    }

    const node = await nodesDal.findByIdAndPlan(nodeId, planId);
    if (!node) {
      return res.status(404).json({ error: 'Node not found' });
    }

    // Get recent logs
    const logs = await logsDal.listByNode(nodeId, { limit: 10 });

    // Get child nodes
    const children = await nodesDal.getChildren(nodeId);

    // Get the plan
    const plan = await plansDal.findById(planId);
    if (!plan) {
      return res.status(500).json({ error: 'Plan not found' });
    }

    const context = {
      plan: {
        id: plan.id,
        title: plan.title,
        description: plan.description,
        status: plan.status,
      },
      node,
      children,
      logs,
    };

    res.json(context);
  } catch (error) {
    next(error);
  }
};

/**
 * Get the path from root to this node with context
 */
const getNodeAncestry = async (req, res, next) => {
  try {
    const { id: planId, nodeId } = req.params;
    const userId = req.user.id;

    const hasAccess = await checkPlanAccess(planId, userId);
    if (!hasAccess) {
      return res.status(403).json({ error: 'You do not have access to this plan' });
    }

    const currentNode = await nodesDal.findByIdAndPlan(nodeId, planId);
    if (!currentNode) {
      return res.status(404).json({ error: 'Node not found' });
    }

    const getAncestors = async (node, ancestry = []) => {
      ancestry.unshift(node);
      if (node.nodeType === 'root' || !node.parentId) return ancestry;

      const parent = await nodesDal.findByIdAndPlan(node.parentId, planId);
      if (!parent) return ancestry;
      return getAncestors(parent, ancestry);
    };

    const ancestry = await getAncestors(currentNode);
    const plan = await plansDal.findById(planId);

    res.json({ plan, ancestry });
  } catch (error) {
    next(error);
  }
};

/**
 * Update the status of a node
 */
const updateNodeStatus = async (req, res, next) => {
  try {
    const { id: planId, nodeId } = req.params;
    const { status } = req.body;
    const userId = req.user.id;

    const hasAccess = await checkPlanAccess(planId, userId, ['owner', 'admin', 'editor']);
    if (!hasAccess) {
      return res.status(403).json({ error: 'You do not have permission to update nodes in this plan' });
    }

    if (!status) return res.status(400).json({ error: 'Status is required' });

    const validStatuses = ['not_started', 'in_progress', 'completed', 'blocked'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        error: `Invalid status. Valid values are: ${validStatuses.join(', ')}`
      });
    }

    const oldNode = await nodesDal.findByIdAndPlan(nodeId, planId);
    if (!oldNode) {
      return res.status(404).json({ error: 'Node not found' });
    }

    const oldStatus = oldNode.status;
    const updatedNode = await nodesDal.update(nodeId, { status, updatedAt: new Date() });

    if (!updatedNode) {
      return res.status(404).json({ error: 'Node not found' });
    }

    await logsDal.create({
      id: uuidv4(),
      planNodeId: nodeId,
      userId,
      content: `Updated status to ${status}`,
      logType: 'progress',
      createdAt: new Date(),
    });

    // Broadcast
    const userName = req.user.name || req.user.email;
    const message = createNodeStatusChangedMessage(nodeId, planId, oldStatus, status, userId, userName);
    await broadcastPlanUpdate(planId, message);

    res.json(updatedNode);
  } catch (error) {
    next(error);
  }
};

/**
 * Move a node to a different parent or position
 */
const moveNode = async (req, res, next) => {
  try {
    const { id: planId, nodeId } = req.params;
    const { parent_id: newParentId, order_index: newOrderIndex } = req.body;
    const userId = req.user.id;

    const hasAccess = await checkPlanAccess(planId, userId, ['owner', 'admin', 'editor']);
    if (!hasAccess) {
      return res.status(403).json({ error: 'You do not have permission to move nodes in this plan' });
    }

    const node = await nodesDal.findByIdAndPlan(nodeId, planId);
    if (!node) {
      return res.status(404).json({ error: 'Node not found' });
    }

    const oldParentId = node.parentId;
    const oldOrderIndex = node.orderIndex;

    if (node.nodeType === 'root') {
      return res.status(400).json({ error: 'Cannot move root nodes' });
    }

    let parentId = newParentId || node.parentId;

    // Verify new parent exists
    if (newParentId && newParentId !== node.parentId) {
      const parent = await nodesDal.findByIdAndPlan(newParentId, planId);
      if (!parent) return res.status(404).json({ error: 'Parent node not found' });
    }

    // Determine order index
    let orderIndex = newOrderIndex;
    if (orderIndex === undefined) {
      const maxOrder = await nodesDal.getMaxSiblingOrder(planId, parentId, nodeId);
      orderIndex = maxOrder + 1;
    }

    const updatedNode = await nodesDal.update(nodeId, {
      parentId: parentId,
      orderIndex: orderIndex,
      updatedAt: new Date(),
    });

    // Log
    const logMessage = newParentId && newParentId !== node.parentId
      ? `Moved "${node.title}" to a different parent`
      : `Reordered "${node.title}"`;

    await logsDal.create({
      id: uuidv4(),
      planNodeId: nodeId,
      userId,
      content: logMessage,
      logType: 'progress',
      createdAt: new Date(),
    });

    // Broadcast
    const userName = req.user.name || req.user.email;
    const moveData = { oldParentId, newParentId: parentId, oldOrderIndex, newOrderIndex: orderIndex };
    const message = createNodeMovedMessage(nodeId, planId, moveData, userId, userName);
    await broadcastPlanUpdate(planId, message);

    res.json(updatedNode);
  } catch (error) {
    next(error);
  }
};

/**
 * Add a progress log entry
 */
const addLogEntry = async (req, res, next) => {
  try {
    const { id: planId, nodeId } = req.params;
    const { content, log_type, actor_type } = req.body;
    const userId = req.user.id;

    const hasAccess = await checkPlanAccess(planId, userId);
    if (!hasAccess) {
      return res.status(403).json({ error: 'You do not have access to this plan' });
    }

    const node = await nodesDal.findByIdAndPlan(nodeId, planId);
    if (!node) {
      return res.status(404).json({ error: 'Node not found in this plan' });
    }

    if (!content) return res.status(400).json({ error: 'Log content is required' });

    const validLogTypes = ['progress', 'reasoning', 'challenge', 'decision'];
    const logType = log_type || 'progress';
    if (!validLogTypes.includes(logType)) {
      return res.status(400).json({ 
        error: `Invalid log type. Valid values are: ${validLogTypes.join(', ')}` 
      });
    }

    const logId = uuidv4();
    const createdAt = new Date();
    const metadata = actor_type ? { actor_type } : {};

    const newLog = await logsDal.create({
      id: logId,
      planNodeId: nodeId,
      userId,
      content,
      logType,
      createdAt,
      metadata,
    });

    // Broadcast
    const userName = req.user.name || req.user.email;
    const message = createLogAddedMessage(newLog, planId, userName);
    await broadcastPlanUpdate(planId, message);

    res.status(201).json(newLog);
  } catch (error) {
    next(error);
  }
};

/**
 * Get activity logs for a node
 */
const getNodeLogs = async (req, res, next) => {
  try {
    const { id: planId, nodeId } = req.params;
    const userId = req.user.id;

    const hasAccess = await checkPlanAccess(planId, userId);
    if (!hasAccess) {
      return res.status(403).json({ error: 'You do not have access to this plan' });
    }

    const node = await nodesDal.findByIdAndPlan(nodeId, planId);
    if (!node) {
      return res.status(404).json({ error: 'Node not found in this plan' });
    }

    const { log_type } = req.query;
    const logs = await logsDal.listByNode(nodeId, { logType: log_type });

    // Transform to include actor_type
    const logsWithUser = logs.map(log => {
      const { metadata, ...logWithoutMetadata } = log;
      return {
        ...logWithoutMetadata,
        actor_type: metadata?.actor_type || 'human',
        user: {
          id: log.userId,
          name: log.userName || null,
          email: log.userEmail || null
        }
      };
    });

    res.json(logsWithUser);
  } catch (error) {
    next(error);
  }
};

/**
 * Request agent assistance on a task
 */
const requestAgent = async (req, res, next) => {
  try {
    const { id: planId, nodeId } = req.params;
    const { request_type, message } = req.body;
    const userId = req.user.id;

    const validTypes = ['start', 'review', 'help', 'continue'];
    if (!request_type || !validTypes.includes(request_type)) {
      return res.status(400).json({ 
        error: `Invalid request_type. Must be one of: ${validTypes.join(', ')}` 
      });
    }

    const hasAccess = await checkPlanAccess(planId, userId);
    if (!hasAccess) {
      return res.status(403).json({ error: 'You do not have access to this plan' });
    }

    const node = await nodesDal.findByIdAndPlan(nodeId, planId);
    if (!node) {
      return res.status(404).json({ error: 'Node not found in this plan' });
    }

    const updated = await nodesDal.setAgentRequest(nodeId, {
      type: request_type,
      message: message || null,
      requestedBy: userId,
    });

    // Log
    const userName = req.user.name || req.user.email;
    await logsDal.create({
      id: uuidv4(),
      planNodeId: nodeId,
      userId,
      content: `Requested agent to ${request_type}${message ? `: "${message}"` : ''}`,
      logType: 'progress',
      createdAt: new Date(),
    });

    // Notify async
    (async () => {
      try {
        const plan = await plansDal.findById(planId);
        if (plan) {
          const actor = { name: userName };
          await notifyAgentRequested(updated, plan, actor, plan.ownerId);
        }
      } catch (notifyError) {
        console.error('Failed to send agent request notification:', notifyError);
      }
    })();

    res.json(updated);
  } catch (error) {
    next(error);
  }
};

/**
 * Clear agent request on a task
 */
const clearAgentRequest = async (req, res, next) => {
  try {
    const { id: planId, nodeId } = req.params;
    const userId = req.user.id;

    const hasAccess = await checkPlanAccess(planId, userId);
    if (!hasAccess) {
      return res.status(403).json({ error: 'You do not have access to this plan' });
    }

    const updated = await nodesDal.clearAgentRequest(nodeId);
    if (!updated) {
      return res.status(404).json({ error: 'Node not found in this plan' });
    }

    res.json(updated);
  } catch (error) {
    next(error);
  }
};

/**
 * Assign an agent to a task node
 */
const assignAgent = async (req, res, next) => {
  try {
    const { id: planId, nodeId } = req.params;
    const { agent_id } = req.body;
    const userId = req.user.id;

    if (!agent_id) return res.status(400).json({ error: 'agent_id is required' });

    const node = await nodesDal.findByIdAndPlan(nodeId, planId);
    if (!node) return res.status(404).json({ error: 'Node not found in this plan' });

    // Check write access
    const hasAccess = await checkPlanAccess(planId, userId, ['owner', 'admin', 'editor']);
    if (!hasAccess) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }

    // Verify agent exists
    const agent = await usersDal.findById(agent_id);
    if (!agent) return res.status(404).json({ error: 'Agent not found' });

    const updated = await nodesDal.assignAgent(nodeId, { agentId: agent_id, assignedBy: userId });

    await logger.api(`Agent ${agent_id} assigned to node ${nodeId} by ${userId}`);
    res.json({
      ...updated,
      agent: { id: agent.id, name: agent.name, email: agent.email, capability_tags: agent.capabilityTags }
    });
  } catch (error) {
    await logger.error('Unexpected error in assignAgent', error);
    next(error);
  }
};

/**
 * Unassign an agent from a task node
 */
const unassignAgent = async (req, res, next) => {
  try {
    const { id: planId, nodeId } = req.params;
    const userId = req.user.id;

    const node = await nodesDal.findByIdAndPlan(nodeId, planId);
    if (!node) return res.status(404).json({ error: 'Node not found in this plan' });

    const hasAccess = await checkPlanAccess(planId, userId, ['owner', 'admin', 'editor']);
    if (!hasAccess) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }

    await nodesDal.update(nodeId, {
      assignedAgentId: null,
      assignedAgentAt: null,
      assignedAgentBy: null,
      updatedAt: new Date(),
    });

    await logger.api(`Agent unassigned from node ${nodeId} by ${userId}`);
    res.status(204).send();
  } catch (error) {
    await logger.error('Unexpected error in unassignAgent', error);
    next(error);
  }
};

/**
 * Get suggested agents for a task based on capability tags
 */
const getSuggestedAgents = async (req, res, next) => {
  try {
    const { tags } = req.query;

    let tagList = [];
    if (tags) {
      tagList = tags.split(',').map(t => t.toLowerCase().trim()).filter(Boolean);
    }

    // Use usersDal to list users with capability tags
    // For now, get all users and filter in memory (DAL doesn't have overlaps query)
    const allUsers = await usersDal.list({ limit: 100 });
    const agents = allUsers.filter(u => {
      if (!u.capabilityTags || u.capabilityTags.length === 0) return false;
      if (tagList.length === 0) return true;
      return tagList.some(tag => u.capabilityTags.includes(tag));
    }).slice(0, 20);

    res.json({ agents });
  } catch (error) {
    await logger.error('Unexpected error in getSuggestedAgents', error);
    next(error);
  }
};

module.exports = {
  getNodes,
  getNode,
  createNode,
  updateNode,
  deleteNode,
  addComment,
  getComments,
  getNodeContext,
  getNodeAncestry,
  updateNodeStatus,
  moveNode,
  addLogEntry,
  getNodeLogs,
  requestAgent,
  clearAgentRequest,
  assignAgent,
  unassignAgent,
  getSuggestedAgents,
};
