/**
 * Node Service — business logic for the node domain.
 *
 * Controller handles HTTP (parse req → call service → return res).
 * This service owns all node business logic and orchestration.
 * All data access goes through node.repository.js — never imports DAL directly.
 */
const repo = require('../repositories/node.repository');
const { checkPlanAccess } = require('../../../middleware/planAccess.middleware');
const { broadcastPlanUpdate } = require('../../../websocket/broadcast');
const {
  createNodeCreatedMessage,
  createNodeUpdatedMessage,
  createNodeDeletedMessage,
  createNodeMovedMessage,
  createNodeStatusChangedMessage,
  createLogAddedMessage,
} = require('../../../websocket/message-schema');
const { notifyStatusChange, notifyAgentRequested } = require('../../../services/notifications.v2');
const messageBus = require('../../../services/messageBus');
const dal = require('../../../db/dal.cjs');

const VALID_TASK_MODES = ['research', 'plan', 'implement', 'free'];
const VALID_STATUSES = ['not_started', 'in_progress', 'completed', 'blocked', 'plan_ready', 'archived'];
const PROMOTING_STATUSES = ['in_progress', 'completed', 'blocked', 'plan_ready'];
const VALID_COHERENCE_STATUSES = ['coherent', 'stale_beliefs', 'contradiction_detected', 'unchecked'];
const VALID_LOG_TYPES = ['progress', 'reasoning', 'challenge', 'decision', 'comment'];
const VALID_AGENT_REQUEST_TYPES = ['start', 'review', 'help', 'continue'];

/** snake_case output for API compatibility */
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
  task_mode: n.taskMode,
  coherence_status: n.coherenceStatus,
  quality_score: n.qualityScore,
  quality_assessed_at: n.qualityAssessedAt,
  quality_rationale: n.qualityRationale,
});

const snakeNodeMinimal = (n) => ({
  id: n.id,
  parent_id: n.parentId,
  node_type: n.nodeType,
  title: n.title,
  status: n.status,
  order_index: n.orderIndex,
  task_mode: n.taskMode,
  coherence_status: n.coherenceStatus,
  quality_score: n.qualityScore,
  quality_assessed_at: n.qualityAssessedAt,
  quality_rationale: n.qualityRationale,
});

class ServiceError extends Error {
  constructor(message, statusCode) {
    super(message);
    this.statusCode = statusCode;
  }
}

const requireAccess = async (planId, userId, roles = []) => {
  if (!(await checkPlanAccess(planId, userId, roles))) {
    const msg = roles.length
      ? 'You do not have permission for this action'
      : 'You do not have access to this plan';
    throw new ServiceError(msg, 403);
  }
};

const requireNode = async (nodeId, planId) => {
  const node = await repo.findById(nodeId);
  if (!node || node.planId !== planId) {
    throw new ServiceError('Node not found in this plan', 404);
  }
  return node;
};

// ── List & Get ─────────────────────────────────────────────

async function listNodes(planId, userId, { includeDetails = false, coherenceStatus, flat = false, includeRoot = false } = {}) {
  await requireAccess(planId, userId);

  const filters = {};
  if (coherenceStatus) filters.coherenceStatus = coherenceStatus;
  const nodes = await repo.listByPlan(planId, filters);
  const mapper = includeDetails ? snakeNode : snakeNodeMinimal;
  const mapped = nodes.map(n => ({ ...mapper(n) }));

  if (flat) return mapped;

  const buildTree = (parentId = null) =>
    mapped
      .filter(n => n.parent_id === parentId)
      .map(n => ({ ...n, children: buildTree(n.id) }));

  const fullTree = buildTree();

  if (includeRoot) return fullTree;

  const root = fullTree[0];
  return root ? root.children : fullTree;
}

async function getNode(planId, nodeId, userId) {
  await requireAccess(planId, userId);
  const node = await requireNode(nodeId, planId);
  return snakeNode(node);
}

// ── Create ─────────────────────────────────────────────────

async function createNode(planId, userId, userName, data) {
  await requireAccess(planId, userId, ['owner', 'admin', 'editor']);

  const { nodeType, title, description, status, orderIndex, dueDate, context, agentInstructions, metadata, taskMode } = data;

  if (!nodeType) throw new ServiceError('Node type is required', 400);
  if (!title) throw new ServiceError('Node title is required', 400);
  if (nodeType === 'root') throw new ServiceError('Cannot create additional root nodes', 400);
  if (taskMode && !VALID_TASK_MODES.includes(taskMode)) {
    throw new ServiceError(`Invalid task_mode. Must be one of: ${VALID_TASK_MODES.join(', ')}`, 400);
  }

  // Determine parent
  let parentIdToUse = data.parentId;
  if (parentIdToUse) {
    const parent = await repo.findById(parentIdToUse);
    if (!parent || parent.planId !== planId) {
      throw new ServiceError('Parent node not found in this plan', 400);
    }
  } else {
    const root = await repo.getRoot(planId);
    if (!root) throw new ServiceError('Plan structure is invalid (no root node)', 500);
    parentIdToUse = root.id;
  }

  // Determine order index
  let finalOrderIndex = orderIndex;
  if (finalOrderIndex === undefined) {
    const siblings = await repo.getChildren(parentIdToUse);
    finalOrderIndex = siblings.length > 0 ? Math.max(...siblings.map(s => s.orderIndex)) + 1 : 0;
  }

  let node;
  try {
    node = await repo.create({
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
      taskMode: taskMode || 'free',
    });
  } catch (dbError) {
    if (dbError.code === '23505' && dbError.constraint === 'plan_nodes_unique_title_per_parent') {
      const siblings = await repo.getChildren(parentIdToUse);
      const existing = siblings.find(s => s.title === title && s.nodeType === nodeType);
      if (existing) return { result: snakeNode(existing), created: false };
    }
    throw dbError;
  }

  await repo.createLog({
    planNodeId: node.id, userId,
    content: `Created ${nodeType} "${title}"`, logType: 'progress',
  });

  // Cascade: if this plan is already linked to one or more goals, the new
  // task should immediately count toward each goal's progress. Mirrors the
  // cascade at goal-link creation time so /goals/tree progress stays in
  // sync without a manual /achievers call. Best-effort — never blocks the
  // create.
  if (nodeType === 'task') {
    try {
      const linkedGoalIds = await dal.goalsDal.listGoalsLinkedToPlan(planId);
      for (const goalId of linkedGoalIds) {
        await dal.dependenciesDal.create({
          sourceNodeId: node.id,
          targetGoalId: goalId,
          dependencyType: 'achieves',
          weight: 1,
          metadata: { auto_created_from_node: true },
          createdBy: userId,
        });
      }
    } catch (cascadeErr) {
      // swallow — cascade is best-effort
    }
  }

  const result = snakeNode(node);
  const message = createNodeCreatedMessage(result, userId, userName);
  await broadcastPlanUpdate(planId, message);

  return { result, created: true };
}

// ── Update ─────────────────────────────────────────────────

async function updateNode(planId, nodeId, userId, userName, data) {
  await requireAccess(planId, userId, ['owner', 'admin', 'editor']);

  const existing = await requireNode(nodeId, planId);
  const oldStatus = existing.status;

  if (existing.nodeType === 'root' && data.nodeType && data.nodeType !== 'root') {
    throw new ServiceError('Cannot change root node type', 400);
  }
  if (data.taskMode !== undefined && !VALID_TASK_MODES.includes(data.taskMode)) {
    throw new ServiceError(`Invalid task_mode. Must be one of: ${VALID_TASK_MODES.join(', ')}`, 400);
  }
  if (data.coherenceStatus !== undefined && !VALID_COHERENCE_STATUSES.includes(data.coherenceStatus)) {
    throw new ServiceError(`Invalid coherence_status. Must be one of: ${VALID_COHERENCE_STATUSES.join(', ')}`, 400);
  }
  if (data.qualityScore !== undefined && (typeof data.qualityScore !== 'number' || data.qualityScore < 0 || data.qualityScore > 1)) {
    throw new ServiceError('quality_score must be a number between 0.0 and 1.0', 400);
  }

  const updates = {};
  const fields = [
    'nodeType', 'title', 'description', 'status', 'orderIndex', 'dueDate',
    'context', 'agentInstructions', 'metadata', 'taskMode',
    'coherenceStatus', 'qualityScore', 'qualityAssessedAt', 'qualityRationale',
  ];
  for (const f of fields) {
    if (data[f] !== undefined) updates[f] = data[f];
  }

  const updated = await repo.update(nodeId, updates);
  const result = snakeNode(updated);

  if (data.status !== undefined && oldStatus !== data.status) {
    await repo.createLog({
      planNodeId: nodeId, userId,
      content: `Updated status to ${data.status}`, logType: 'progress',
    });

    const plan = await repo.findPlanById(planId);
    if (plan) {
      // Auto-promote draft plan → active when work meaningfully begins on any of its nodes.
      if (plan.status === 'draft' && PROMOTING_STATUSES.includes(data.status)) {
        try {
          await repo.updatePlan(planId, { status: 'active' });
        } catch (err) {
          console.error('Auto-promote draft plan failed:', err.message);
        }
      }

      const actor = { name: userName, type: 'user' };
      notifyStatusChange(result, { id: plan.id, title: plan.title, owner_id: plan.ownerId }, actor, oldStatus, data.status).catch(console.error);
    }

    messageBus.publish('node.status.changed', {
      nodeId, planId, oldStatus, newStatus: data.status, taskMode: existing.taskMode,
    }).catch(err => console.error('Failed to publish node.status.changed:', err.message));
  }

  const message = createNodeUpdatedMessage(result, userId, userName);
  await broadcastPlanUpdate(planId, message);

  return result;
}

// ── Delete ─────────────────────────────────────────────────

async function deleteNode(planId, nodeId, userId, userName) {
  await requireAccess(planId, userId, ['owner', 'admin', 'editor']);

  const node = await requireNode(nodeId, planId);
  if (node.nodeType === 'root') {
    throw new ServiceError('Cannot delete root node', 400);
  }

  await repo.deleteWithChildren(nodeId);

  const message = createNodeDeletedMessage(nodeId, planId, userId, userName);
  await broadcastPlanUpdate(planId, message);
}

// ── Status ─────────────────────────────────────────────────

async function updateNodeStatus(planId, nodeId, userId, userName, status) {
  await requireAccess(planId, userId, ['owner', 'admin', 'editor']);

  if (!status) throw new ServiceError('Status is required', 400);
  if (!VALID_STATUSES.includes(status)) {
    throw new ServiceError(`Invalid status. Valid: ${VALID_STATUSES.join(', ')}`, 400);
  }

  const existing = await requireNode(nodeId, planId);
  const oldStatus = existing.status;

  const updated = await repo.updateStatus(nodeId, status);
  const result = snakeNode(updated);

  await repo.createLog({
    planNodeId: nodeId, userId,
    content: `Updated status to ${status}`, logType: 'progress',
  });

  // Auto-promote draft plan → active when work meaningfully begins.
  if (oldStatus !== status && PROMOTING_STATUSES.includes(status)) {
    const plan = await repo.findPlanById(planId);
    if (plan && plan.status === 'draft') {
      try {
        await repo.updatePlan(planId, { status: 'active' });
      } catch (err) {
        console.error('Auto-promote draft plan failed:', err.message);
      }
    }
  }

  const message = createNodeStatusChangedMessage(nodeId, planId, oldStatus, status, userId, userName);
  await broadcastPlanUpdate(planId, message);

  if (oldStatus !== status) {
    messageBus.publish('node.status.changed', {
      nodeId, planId, oldStatus, newStatus: status, taskMode: existing.taskMode,
    }).catch(err => console.error('Failed to publish node.status.changed:', err.message));
  }

  return result;
}

// ── Move ───────────────────────────────────────────────────

async function moveNode(planId, nodeId, userId, userName, { newParentId, newOrderIndex }) {
  await requireAccess(planId, userId, ['owner', 'admin', 'editor']);

  const node = await requireNode(nodeId, planId);
  if (node.nodeType === 'root') {
    throw new ServiceError('Cannot move root nodes', 400);
  }

  const oldParentId = node.parentId;
  const oldOrderIndex = node.orderIndex;

  if (newParentId && newParentId !== node.parentId) {
    const parent = await repo.findById(newParentId);
    if (!parent || parent.planId !== planId) {
      throw new ServiceError('Parent node not found', 404);
    }
    await repo.move(nodeId, newParentId);
  }

  if (newOrderIndex !== undefined) {
    await repo.reorder(nodeId, newOrderIndex);
  }

  const updated = await repo.findById(nodeId);
  const result = snakeNode(updated);

  const logMsg = newParentId && newParentId !== oldParentId
    ? `Moved "${node.title}" to a different parent`
    : `Reordered "${node.title}"`;

  await repo.createLog({
    planNodeId: nodeId, userId, content: logMsg, logType: 'progress',
  });

  const moveData = { oldParentId, newParentId: updated.parentId, oldOrderIndex, newOrderIndex: updated.orderIndex };
  const message = createNodeMovedMessage(nodeId, planId, moveData, userId, userName);
  await broadcastPlanUpdate(planId, message);

  return result;
}

// ── Context & Ancestry ─────────────────────────────────────

async function getNodeContext(planId, nodeId, userId) {
  await requireAccess(planId, userId);

  const node = await requireNode(nodeId, planId);

  const [logs, childNodes, plan] = await Promise.all([
    repo.listLogsByNode(nodeId, { limit: 10 }),
    repo.getChildren(nodeId),
    repo.findPlanById(planId),
  ]);

  return {
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
  };
}

async function getNodeAncestry(planId, nodeId, userId) {
  await requireAccess(planId, userId);

  const ancestry = [];
  let currentId = nodeId;
  while (currentId) {
    const node = await repo.findById(currentId);
    if (!node || node.planId !== planId) break;
    ancestry.unshift({
      id: node.id, parent_id: node.parentId, node_type: node.nodeType,
      title: node.title, description: node.description, status: node.status,
    });
    if (node.nodeType === 'root' || !node.parentId) break;
    currentId = node.parentId;
  }

  const plan = await repo.findPlanById(planId);

  return {
    plan: plan ? { id: plan.id, title: plan.title, description: plan.description, status: plan.status } : null,
    ancestry,
  };
}

// ── Logs ───────────────────────────────────────────────────

async function addLogEntry(planId, nodeId, userId, userName, { content, logType, actorType, tags }) {
  await requireAccess(planId, userId);
  await requireNode(nodeId, planId);

  if (!content) throw new ServiceError('Log content is required', 400);

  const finalLogType = logType || 'progress';
  if (!VALID_LOG_TYPES.includes(finalLogType)) {
    throw new ServiceError(`Invalid log type. Valid: ${VALID_LOG_TYPES.join(', ')}`, 400);
  }

  const metadata = actorType ? { actor_type: actorType } : {};

  const log = await repo.createLog({
    planNodeId: nodeId, userId, content,
    logType: finalLogType, metadata,
    ...(tags && { tags }),
  });

  const result = {
    id: log.id, content: log.content, log_type: log.logType,
    created_at: log.createdAt, plan_node_id: log.planNodeId,
    user_id: log.userId, metadata: log.metadata, tags: log.tags,
  };

  const message = createLogAddedMessage(result, planId, userName);
  await broadcastPlanUpdate(planId, message);

  return result;
}

async function getNodeLogs(planId, nodeId, userId) {
  await requireAccess(planId, userId);
  await requireNode(nodeId, planId);

  const logs = await repo.listLogsByNode(nodeId);

  return logs.map(l => ({
    id: l.id, content: l.content, log_type: l.logType,
    created_at: l.createdAt, user_id: l.userId,
    actor_type: l.metadata?.actor_type || 'human',
    user: { id: l.userId, name: l.userName, email: l.userEmail },
  }));
}

// ── Agent operations ───────────────────────────────────────

async function requestAgent(planId, nodeId, userId, userName, { requestType, message }) {
  if (!requestType || !VALID_AGENT_REQUEST_TYPES.includes(requestType)) {
    throw new ServiceError(`Invalid request_type. Must be: ${VALID_AGENT_REQUEST_TYPES.join(', ')}`, 400);
  }

  await requireAccess(planId, userId);
  await requireNode(nodeId, planId);

  const updated = await repo.setAgentRequest(nodeId, {
    type: requestType, message: message || null, requestedBy: userId,
  });

  await repo.createLog({
    planNodeId: nodeId, userId,
    content: `Requested agent to ${requestType}${message ? `: "${message}"` : ''}`,
    logType: 'progress',
  });

  // Notify async — fire and forget
  (async () => {
    try {
      const plan = await repo.findPlanById(planId);
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

  return snakeNode(updated);
}

async function clearAgentRequest(planId, nodeId, userId) {
  await requireAccess(planId, userId);

  const updated = await repo.clearAgentRequest(nodeId);
  if (!updated || updated.planId !== planId) {
    throw new ServiceError('Node not found in this plan', 404);
  }

  return snakeNode(updated);
}

async function assignAgent(planId, nodeId, userId, agentId) {
  if (!agentId) throw new ServiceError('agent_id is required', 400);

  await requireAccess(planId, userId, ['owner', 'admin', 'editor']);
  await requireNode(nodeId, planId);

  const agent = await repo.findUserById(agentId);
  if (!agent) throw new ServiceError('Agent not found', 404);

  const updated = await repo.assignAgent(nodeId, { agentId, assignedBy: userId });

  return {
    ...snakeNode(updated),
    agent: { id: agent.id, name: agent.name, email: agent.email, capability_tags: agent.capabilityTags },
  };
}

async function unassignAgent(planId, nodeId, userId) {
  await requireAccess(planId, userId, ['owner', 'admin', 'editor']);

  await repo.update(nodeId, {
    assignedAgentId: null, assignedAgentAt: null, assignedAgentBy: null,
  });
}

async function getSuggestedAgents() {
  const users = await repo.listUsers({ limit: 20 });
  const agents = users.filter(u => u.capabilityTags && u.capabilityTags.length > 0);
  return agents.map(a => ({
    id: a.id, name: a.name, email: a.email,
    avatar_url: a.avatarUrl, capability_tags: a.capabilityTags,
  }));
}

// ── RPI Chain ──────────────────────────────────────────────

async function createRpiChain(planId, userId, userName, { title, description, parentId }) {
  await requireAccess(planId, userId, ['owner', 'admin', 'editor']);
  if (!title) throw new ServiceError('Title is required', 400);

  let parentIdToUse = parentId;
  if (!parentIdToUse) {
    const root = await repo.getRoot(planId);
    if (!root) throw new ServiceError('Plan structure is invalid', 500);
    parentIdToUse = root.id;
  }

  const siblings = await repo.getChildren(parentIdToUse);
  const baseOrder = siblings.length > 0 ? Math.max(...siblings.map(s => s.orderIndex)) + 1 : 0;

  const research = await repo.create({
    planId, parentId: parentIdToUse, nodeType: 'task',
    title: `Research: ${title}`, description: description || '',
    status: 'not_started', orderIndex: baseOrder,
    context: `Research phase for: ${title}`, taskMode: 'research', metadata: {},
  });
  const plan = await repo.create({
    planId, parentId: parentIdToUse, nodeType: 'task',
    title: `Plan: ${title}`, description: '',
    status: 'not_started', orderIndex: baseOrder + 1,
    context: `Planning phase for: ${title}`, taskMode: 'plan', metadata: {},
  });
  const implement = await repo.create({
    planId, parentId: parentIdToUse, nodeType: 'task',
    title: `Implement: ${title}`, description: '',
    status: 'not_started', orderIndex: baseOrder + 2,
    context: `Implementation phase for: ${title}`, taskMode: 'implement', metadata: {},
  });

  const edge1 = await repo.createDependency({
    sourceNodeId: research.id, targetNodeId: plan.id,
    dependencyType: 'blocks', weight: 1, createdBy: userId, metadata: {},
  });
  const edge2 = await repo.createDependency({
    sourceNodeId: plan.id, targetNodeId: implement.id,
    dependencyType: 'blocks', weight: 1, createdBy: userId, metadata: {},
  });

  await repo.createLog({
    planNodeId: research.id, userId,
    content: `Created RPI chain "${title}"`, logType: 'progress',
  });

  const message = createNodeCreatedMessage(snakeNode(research), userId, userName);
  await broadcastPlanUpdate(planId, message);

  return {
    chain: {
      research: snakeNode(research),
      plan: snakeNode(plan),
      implement: snakeNode(implement),
    },
    dependencies: [
      { id: edge1.id, source: research.id, target: plan.id, type: 'blocks' },
      { id: edge2.id, source: plan.id, target: implement.id, type: 'blocks' },
    ],
  };
}

module.exports = {
  // Errors
  ServiceError,
  // Mappers (exported for controller use)
  snakeNode,
  snakeNodeMinimal,
  // Operations
  listNodes,
  getNode,
  createNode,
  updateNode,
  deleteNode,
  updateNodeStatus,
  moveNode,
  getNodeContext,
  getNodeAncestry,
  addLogEntry,
  getNodeLogs,
  requestAgent,
  clearAgentRequest,
  assignAgent,
  unassignAgent,
  getSuggestedAgents,
  createRpiChain,
};
