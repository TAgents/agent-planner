/**
 * WebSocket Event Message Schema
 *
 * This module defines the standardized message format and event types for
 * WebSocket communication in the Agent Planner system.
 *
 * Message Structure:
 * All WebSocket messages follow a consistent structure with:
 * - type: Event type identifier (string constant)
 * - payload: Event-specific data (object)
 * - metadata: Common metadata (user, timestamp, plan_id for routing)
 *
 * Schema Version: 1.0.0
 */

// ============================================================================
// EVENT TYPE CONSTANTS
// ============================================================================

/**
 * @enum {string}
 * Connection and presence event types
 */
const CONNECTION_EVENTS = {
  CONNECTION: 'connection',
  PING: 'ping',
  PONG: 'pong',
  ERROR: 'error'
};

/**
 * @enum {string}
 * Plan-level event types (CRUD operations)
 */
const PLAN_EVENTS = {
  CREATED: 'plan.created',
  UPDATED: 'plan.updated',
  DELETED: 'plan.deleted',
  STATUS_CHANGED: 'plan.status_changed'
};

/**
 * @enum {string}
 * Node-level event types (CRUD and status operations)
 */
const NODE_EVENTS = {
  CREATED: 'node.created',
  UPDATED: 'node.updated',
  DELETED: 'node.deleted',
  MOVED: 'node.moved',
  STATUS_CHANGED: 'node.status_changed'
};

/**
 * @enum {string}
 * Collaboration event types
 */
const COLLABORATION_EVENTS = {
  USER_ASSIGNED: 'collaboration.user_assigned',
  USER_UNASSIGNED: 'collaboration.user_unassigned',
  COMMENT_ADDED: 'collaboration.comment_added',
  COMMENT_UPDATED: 'collaboration.comment_updated',
  COMMENT_DELETED: 'collaboration.comment_deleted',
  LOG_ADDED: 'collaboration.log_added',
  LABEL_ADDED: 'collaboration.label_added',
  LABEL_REMOVED: 'collaboration.label_removed',
  DECISION_REQUESTED: 'collaboration.decision_requested',
  DECISION_RESOLVED: 'collaboration.decision_resolved'
};

/**
 * @enum {string}
 * Collaborator management event types
 */
const COLLABORATOR_EVENTS = {
  ADDED: 'collaborator.added',
  REMOVED: 'collaborator.removed',
  ROLE_CHANGED: 'collaborator.role_changed'
};

/**
 * @enum {string}
 * Real-time presence event types (already implemented)
 */
const PRESENCE_EVENTS = {
  USER_JOINED_PLAN: 'user_joined_plan',
  USER_LEFT_PLAN: 'user_left_plan',
  USER_JOINED_NODE: 'user_joined_node',
  USER_LEFT_NODE: 'user_left_node',
  TYPING_START: 'typing_start',
  TYPING_STOP: 'typing_stop',
  PRESENCE_UPDATE: 'presence_update',
  ACTIVE_USERS: 'active_users',
  NODE_VIEWERS: 'node_viewers'
};

/**
 * Combined export of all event types
 */
const EVENT_TYPES = {
  ...CONNECTION_EVENTS,
  ...PLAN_EVENTS,
  ...NODE_EVENTS,
  ...COLLABORATION_EVENTS,
  ...COLLABORATOR_EVENTS,
  ...PRESENCE_EVENTS
};

// ============================================================================
// TYPE DEFINITIONS (JSDoc)
// ============================================================================

/**
 * @typedef {Object} MessageMetadata
 * @property {string} userId - User who triggered the event (UUID)
 * @property {string} [userName] - Optional user display name
 * @property {string} timestamp - ISO 8601 timestamp
 * @property {string} planId - Plan ID for routing (UUID)
 * @property {string} [version] - Schema version (default: '1.0.0')
 */

/**
 * @typedef {Object} BaseMessage
 * @property {string} type - Event type from EVENT_TYPES
 * @property {Object} payload - Event-specific data
 * @property {MessageMetadata} metadata - Common metadata
 */

/**
 * @typedef {Object} PlanPayload
 * @property {string} id - Plan UUID
 * @property {string} title - Plan title
 * @property {string} [description] - Plan description
 * @property {string} status - Plan status (draft, active, completed, archived)
 * @property {string} ownerId - Owner user UUID
 * @property {Object} [metadata] - Additional plan metadata
 */

/**
 * @typedef {Object} NodePayload
 * @property {string} id - Node UUID
 * @property {string} planId - Parent plan UUID
 * @property {string} [parentId] - Parent node UUID (null for root)
 * @property {string} nodeType - Node type (root, phase, task, milestone)
 * @property {string} title - Node title
 * @property {string} [description] - Node description
 * @property {string} status - Node status (not_started, in_progress, completed, blocked)
 * @property {number} [orderIndex] - Position in parent's children
 * @property {string} [dueDate] - ISO 8601 date
 * @property {Object} [metadata] - Additional node metadata
 */

/**
 * @typedef {Object} NodeMovePayload
 * @property {string} nodeId - Node UUID being moved
 * @property {string} [oldParentId] - Previous parent UUID
 * @property {string} [newParentId] - New parent UUID
 * @property {number} [oldOrderIndex] - Previous position
 * @property {number} [newOrderIndex] - New position
 */

/**
 * @typedef {Object} StatusChangePayload
 * @property {string} id - Entity UUID (plan or node)
 * @property {string} oldStatus - Previous status
 * @property {string} newStatus - Current status
 */

/**
 * @typedef {Object} AssignmentPayload
 * @property {string} nodeId - Node UUID
 * @property {string} userId - Assigned user UUID
 * @property {string} [userName] - User display name
 */

/**
 * @typedef {Object} CommentPayload
 * @property {string} id - Comment UUID
 * @property {string} nodeId - Parent node UUID
 * @property {string} userId - Comment author UUID
 * @property {string} [userName] - Author display name
 * @property {string} content - Comment text
 * @property {string} commentType - Comment type (human, agent, system)
 * @property {string} createdAt - ISO 8601 timestamp
 */

/**
 * @typedef {Object} LogPayload
 * @property {string} id - Log UUID
 * @property {string} nodeId - Parent node UUID
 * @property {string} userId - Log author UUID
 * @property {string} [userName] - Author display name
 * @property {string} content - Log content
 * @property {string} logType - Log type (progress, reasoning, challenge, decision)
 * @property {string[]} [tags] - Log tags
 * @property {string} actorType - Actor type (human or agent)
 * @property {string} createdAt - ISO 8601 timestamp
 */

/**
 * @typedef {Object} LabelPayload
 * @property {string} id - Label UUID
 * @property {string} nodeId - Parent node UUID
 * @property {string} label - Label text
 */

/**
 * @typedef {Object} CollaboratorPayload
 * @property {string} id - Collaborator record UUID
 * @property {string} planId - Plan UUID
 * @property {string} userId - Collaborator user UUID
 * @property {string} [userName] - User display name
 * @property {string} [userEmail] - User email
 * @property {string} role - Collaborator role (viewer, editor, admin)
 * @property {string} [oldRole] - Previous role (for role changes)
 */

// ============================================================================
// MESSAGE FACTORY FUNCTIONS
// ============================================================================

/**
 * Creates base metadata object for all messages
 * @param {string} userId - User who triggered the event
 * @param {string} planId - Plan ID for routing
 * @param {string} [userName] - Optional user display name
 * @returns {MessageMetadata}
 */
function createMetadata(userId, planId, userName = null) {
  return {
    userId,
    userName,
    timestamp: new Date().toISOString(),
    planId,
    version: '1.0.0'
  };
}

/**
 * Creates a complete WebSocket message
 * @param {string} eventType - Event type from EVENT_TYPES
 * @param {Object} payload - Event-specific payload
 * @param {MessageMetadata} metadata - Message metadata
 * @returns {BaseMessage}
 */
function createMessage(eventType, payload, metadata) {
  return {
    type: eventType,
    payload,
    metadata
  };
}

// ----------------------------------------------------------------------------
// Plan Event Factories
// ----------------------------------------------------------------------------

/**
 * Creates a plan.created event message
 * @param {Object} plan - Plan object from database
 * @param {string} userId - User who created the plan
 * @param {string} [userName] - Optional user display name
 * @returns {BaseMessage}
 */
function createPlanCreatedMessage(plan, userId, userName = null) {
  const metadata = createMetadata(userId, plan.id, userName);
  const payload = {
    id: plan.id,
    title: plan.title,
    description: plan.description,
    status: plan.status,
    ownerId: plan.owner_id,
    createdAt: plan.created_at,
    metadata: plan.metadata
  };
  return createMessage(PLAN_EVENTS.CREATED, payload, metadata);
}

/**
 * Creates a plan.updated event message
 * @param {Object} plan - Updated plan object
 * @param {string} userId - User who updated the plan
 * @param {string} [userName] - Optional user display name
 * @returns {BaseMessage}
 */
function createPlanUpdatedMessage(plan, userId, userName = null) {
  const metadata = createMetadata(userId, plan.id, userName);
  const payload = {
    id: plan.id,
    title: plan.title,
    description: plan.description,
    status: plan.status,
    ownerId: plan.owner_id,
    updatedAt: plan.updated_at,
    metadata: plan.metadata
  };
  return createMessage(PLAN_EVENTS.UPDATED, payload, metadata);
}

/**
 * Creates a plan.deleted event message
 * @param {string} planId - Deleted plan UUID
 * @param {string} userId - User who deleted the plan
 * @param {string} [userName] - Optional user display name
 * @returns {BaseMessage}
 */
function createPlanDeletedMessage(planId, userId, userName = null) {
  const metadata = createMetadata(userId, planId, userName);
  const payload = { id: planId };
  return createMessage(PLAN_EVENTS.DELETED, payload, metadata);
}

/**
 * Creates a plan.status_changed event message
 * @param {string} planId - Plan UUID
 * @param {string} oldStatus - Previous status
 * @param {string} newStatus - New status
 * @param {string} userId - User who changed the status
 * @param {string} [userName] - Optional user display name
 * @returns {BaseMessage}
 */
function createPlanStatusChangedMessage(planId, oldStatus, newStatus, userId, userName = null) {
  const metadata = createMetadata(userId, planId, userName);
  const payload = {
    id: planId,
    oldStatus,
    newStatus
  };
  return createMessage(PLAN_EVENTS.STATUS_CHANGED, payload, metadata);
}

// ----------------------------------------------------------------------------
// Node Event Factories
// ----------------------------------------------------------------------------

/**
 * Creates a node.created event message
 * @param {Object} node - Node object from database
 * @param {string} userId - User who created the node
 * @param {string} [userName] - Optional user display name
 * @returns {BaseMessage}
 */
function createNodeCreatedMessage(node, userId, userName = null) {
  const metadata = createMetadata(userId, node.plan_id, userName);
  const payload = {
    id: node.id,
    planId: node.plan_id,
    parentId: node.parent_id,
    nodeType: node.node_type,
    title: node.title,
    description: node.description,
    status: node.status,
    orderIndex: node.order_index,
    dueDate: node.due_date,
    createdAt: node.created_at,
    metadata: node.metadata
  };
  return createMessage(NODE_EVENTS.CREATED, payload, metadata);
}

/**
 * Creates a node.updated event message
 * @param {Object} node - Updated node object
 * @param {string} userId - User who updated the node
 * @param {string} [userName] - Optional user display name
 * @returns {BaseMessage}
 */
function createNodeUpdatedMessage(node, userId, userName = null) {
  const metadata = createMetadata(userId, node.plan_id, userName);
  const payload = {
    id: node.id,
    planId: node.plan_id,
    parentId: node.parent_id,
    nodeType: node.node_type,
    title: node.title,
    description: node.description,
    status: node.status,
    orderIndex: node.order_index,
    dueDate: node.due_date,
    updatedAt: node.updated_at,
    metadata: node.metadata
  };
  return createMessage(NODE_EVENTS.UPDATED, payload, metadata);
}

/**
 * Creates a node.deleted event message
 * @param {string} nodeId - Deleted node UUID
 * @param {string} planId - Parent plan UUID
 * @param {string} userId - User who deleted the node
 * @param {string} [userName] - Optional user display name
 * @returns {BaseMessage}
 */
function createNodeDeletedMessage(nodeId, planId, userId, userName = null) {
  const metadata = createMetadata(userId, planId, userName);
  const payload = {
    id: nodeId,
    planId
  };
  return createMessage(NODE_EVENTS.DELETED, payload, metadata);
}

/**
 * Creates a node.moved event message
 * @param {string} nodeId - Moved node UUID
 * @param {string} planId - Parent plan UUID
 * @param {Object} moveData - Movement details
 * @param {string} moveData.oldParentId - Previous parent UUID
 * @param {string} moveData.newParentId - New parent UUID
 * @param {number} moveData.oldOrderIndex - Previous position
 * @param {number} moveData.newOrderIndex - New position
 * @param {string} userId - User who moved the node
 * @param {string} [userName] - Optional user display name
 * @returns {BaseMessage}
 */
function createNodeMovedMessage(nodeId, planId, moveData, userId, userName = null) {
  const metadata = createMetadata(userId, planId, userName);
  const payload = {
    nodeId,
    ...moveData
  };
  return createMessage(NODE_EVENTS.MOVED, payload, metadata);
}

/**
 * Creates a node.status_changed event message
 * @param {string} nodeId - Node UUID
 * @param {string} planId - Parent plan UUID
 * @param {string} oldStatus - Previous status
 * @param {string} newStatus - New status
 * @param {string} userId - User who changed the status
 * @param {string} [userName] - Optional user display name
 * @returns {BaseMessage}
 */
function createNodeStatusChangedMessage(nodeId, planId, oldStatus, newStatus, userId, userName = null) {
  const metadata = createMetadata(userId, planId, userName);
  const payload = {
    id: nodeId,
    oldStatus,
    newStatus
  };
  return createMessage(NODE_EVENTS.STATUS_CHANGED, payload, metadata);
}

// ----------------------------------------------------------------------------
// Collaboration Event Factories
// ----------------------------------------------------------------------------

/**
 * Creates a collaboration.user_assigned event message
 * @param {string} nodeId - Node UUID
 * @param {string} planId - Parent plan UUID
 * @param {string} assignedUserId - Assigned user UUID
 * @param {string} assignedUserName - Assigned user display name
 * @param {string} assignerUserId - User who made the assignment
 * @param {string} [assignerUserName] - Optional assigner display name
 * @returns {BaseMessage}
 */
function createUserAssignedMessage(nodeId, planId, assignedUserId, assignedUserName, assignerUserId, assignerUserName = null) {
  const metadata = createMetadata(assignerUserId, planId, assignerUserName);
  const payload = {
    nodeId,
    userId: assignedUserId,
    userName: assignedUserName
  };
  return createMessage(COLLABORATION_EVENTS.USER_ASSIGNED, payload, metadata);
}

/**
 * Creates a collaboration.user_unassigned event message
 * @param {string} nodeId - Node UUID
 * @param {string} planId - Parent plan UUID
 * @param {string} unassignedUserId - Unassigned user UUID
 * @param {string} unassignedUserName - Unassigned user display name
 * @param {string} unassignerUserId - User who removed the assignment
 * @param {string} [unassignerUserName] - Optional unassigner display name
 * @returns {BaseMessage}
 */
function createUserUnassignedMessage(nodeId, planId, unassignedUserId, unassignedUserName, unassignerUserId, unassignerUserName = null) {
  const metadata = createMetadata(unassignerUserId, planId, unassignerUserName);
  const payload = {
    nodeId,
    userId: unassignedUserId,
    userName: unassignedUserName
  };
  return createMessage(COLLABORATION_EVENTS.USER_UNASSIGNED, payload, metadata);
}

/**
 * Creates a collaboration.comment_added event message
 * @param {Object} comment - Comment object from database
 * @param {string} planId - Parent plan UUID
 * @param {string} [userName] - Optional user display name
 * @returns {BaseMessage}
 */
function createCommentAddedMessage(comment, planId, userName = null) {
  const metadata = createMetadata(comment.user_id, planId, userName);
  const payload = {
    id: comment.id,
    nodeId: comment.plan_node_id,
    userId: comment.user_id,
    userName,
    content: comment.content,
    commentType: comment.comment_type,
    createdAt: comment.created_at
  };
  return createMessage(COLLABORATION_EVENTS.COMMENT_ADDED, payload, metadata);
}

/**
 * Creates a collaboration.comment_updated event message
 * @param {Object} comment - Updated comment object
 * @param {string} planId - Parent plan UUID
 * @param {string} [userName] - Optional user display name
 * @returns {BaseMessage}
 */
function createCommentUpdatedMessage(comment, planId, userName = null) {
  const metadata = createMetadata(comment.user_id, planId, userName);
  const payload = {
    id: comment.id,
    nodeId: comment.plan_node_id,
    userId: comment.user_id,
    userName,
    content: comment.content,
    commentType: comment.comment_type,
    updatedAt: comment.updated_at
  };
  return createMessage(COLLABORATION_EVENTS.COMMENT_UPDATED, payload, metadata);
}

/**
 * Creates a collaboration.comment_deleted event message
 * @param {string} commentId - Deleted comment UUID
 * @param {string} nodeId - Parent node UUID
 * @param {string} planId - Parent plan UUID
 * @param {string} userId - User who deleted the comment
 * @param {string} [userName] - Optional user display name
 * @returns {BaseMessage}
 */
function createCommentDeletedMessage(commentId, nodeId, planId, userId, userName = null) {
  const metadata = createMetadata(userId, planId, userName);
  const payload = {
    id: commentId,
    nodeId
  };
  return createMessage(COLLABORATION_EVENTS.COMMENT_DELETED, payload, metadata);
}

/**
 * Creates a collaboration.log_added event message
 * @param {Object} log - Log object from database
 * @param {string} planId - Parent plan UUID
 * @param {string} [userName] - Optional user display name
 * @returns {BaseMessage}
 */
function createLogAddedMessage(log, planId, userName = null) {
  const metadata = createMetadata(log.user_id, planId, userName);
  const payload = {
    id: log.id,
    nodeId: log.plan_node_id,
    userId: log.user_id,
    userName,
    content: log.content,
    logType: log.log_type,
    tags: log.tags,
    actorType: log.metadata?.actor_type || 'human',
    createdAt: log.created_at
  };
  return createMessage(COLLABORATION_EVENTS.LOG_ADDED, payload, metadata);
}

/**
 * Creates a collaboration.label_added event message
 * @param {Object} label - Label object from database
 * @param {string} planId - Parent plan UUID
 * @param {string} userId - User who added the label
 * @param {string} [userName] - Optional user display name
 * @returns {BaseMessage}
 */
function createLabelAddedMessage(label, planId, userId, userName = null) {
  const metadata = createMetadata(userId, planId, userName);
  const payload = {
    id: label.id,
    nodeId: label.plan_node_id,
    label: label.label
  };
  return createMessage(COLLABORATION_EVENTS.LABEL_ADDED, payload, metadata);
}

/**
 * Creates a collaboration.label_removed event message
 * @param {string} labelId - Removed label UUID
 * @param {string} nodeId - Parent node UUID
 * @param {string} planId - Parent plan UUID
 * @param {string} userId - User who removed the label
 * @param {string} [userName] - Optional user display name
 * @returns {BaseMessage}
 */
function createLabelRemovedMessage(labelId, nodeId, planId, userId, userName = null) {
  const metadata = createMetadata(userId, planId, userName);
  const payload = {
    id: labelId,
    nodeId
  };
  return createMessage(COLLABORATION_EVENTS.LABEL_REMOVED, payload, metadata);
}

/**
 * Creates a collaboration.decision_requested event message
 * @param {Object} decision - Decision request object from database
 * @param {string} planId - Plan UUID
 * @param {string} [userName] - Optional user display name
 * @returns {BaseMessage}
 */
function createDecisionRequestedMessage(decision, planId, userName = null) {
  const metadata = createMetadata(decision.requested_by_user_id, planId, userName);
  const payload = {
    id: decision.id,
    planId: decision.plan_id,
    nodeId: decision.node_id,
    title: decision.title,
    context: decision.context,
    options: decision.options,
    urgency: decision.urgency,
    requestedByAgentName: decision.requested_by_agent_name,
    expiresAt: decision.expires_at,
    status: decision.status,
    createdAt: decision.created_at
  };
  return createMessage(COLLABORATION_EVENTS.DECISION_REQUESTED, payload, metadata);
}

/**
 * Creates a collaboration.decision_resolved event message
 * @param {Object} decision - Resolved decision request object
 * @param {string} planId - Plan UUID
 * @param {string} [userName] - Optional user display name
 * @returns {BaseMessage}
 */
function createDecisionResolvedMessage(decision, planId, userName = null) {
  const metadata = createMetadata(decision.decided_by_user_id, planId, userName);
  const payload = {
    id: decision.id,
    planId: decision.plan_id,
    nodeId: decision.node_id,
    title: decision.title,
    decision: decision.decision,
    rationale: decision.rationale,
    status: decision.status,
    decidedAt: decision.decided_at
  };
  return createMessage(COLLABORATION_EVENTS.DECISION_RESOLVED, payload, metadata);
}

// ----------------------------------------------------------------------------
// Collaborator Event Factories
// ----------------------------------------------------------------------------

/**
 * Creates a collaborator.added event message
 * @param {Object} collaborator - Collaborator object from database
 * @param {string} userId - User who added the collaborator
 * @param {string} [userName] - Optional user display name
 * @returns {BaseMessage}
 */
function createCollaboratorAddedMessage(collaborator, userId, userName = null) {
  const metadata = createMetadata(userId, collaborator.plan_id, userName);
  const payload = {
    id: collaborator.id,
    planId: collaborator.plan_id,
    userId: collaborator.user_id,
    userName: collaborator.user_name,
    userEmail: collaborator.user_email,
    role: collaborator.role
  };
  return createMessage(COLLABORATOR_EVENTS.ADDED, payload, metadata);
}

/**
 * Creates a collaborator.removed event message
 * @param {string} collaboratorId - Removed collaborator record UUID
 * @param {string} planId - Plan UUID
 * @param {string} removedUserId - Removed user UUID
 * @param {string} removerUserId - User who removed the collaborator
 * @param {string} [removerUserName] - Optional remover display name
 * @returns {BaseMessage}
 */
function createCollaboratorRemovedMessage(collaboratorId, planId, removedUserId, removerUserId, removerUserName = null) {
  const metadata = createMetadata(removerUserId, planId, removerUserName);
  const payload = {
    id: collaboratorId,
    planId,
    userId: removedUserId
  };
  return createMessage(COLLABORATOR_EVENTS.REMOVED, payload, metadata);
}

/**
 * Creates a collaborator.role_changed event message
 * @param {Object} collaborator - Updated collaborator object
 * @param {string} oldRole - Previous role
 * @param {string} userId - User who changed the role
 * @param {string} [userName] - Optional user display name
 * @returns {BaseMessage}
 */
function createCollaboratorRoleChangedMessage(collaborator, oldRole, userId, userName = null) {
  const metadata = createMetadata(userId, collaborator.plan_id, userName);
  const payload = {
    id: collaborator.id,
    planId: collaborator.plan_id,
    userId: collaborator.user_id,
    oldRole,
    role: collaborator.role
  };
  return createMessage(COLLABORATOR_EVENTS.ROLE_CHANGED, payload, metadata);
}

// ============================================================================
// EXPORTS
// ============================================================================

module.exports = {
  // Event type constants
  EVENT_TYPES,
  PLAN_EVENTS,
  NODE_EVENTS,
  COLLABORATION_EVENTS,
  COLLABORATOR_EVENTS,
  PRESENCE_EVENTS,
  CONNECTION_EVENTS,

  // Core factories
  createMetadata,
  createMessage,

  // Plan event factories
  createPlanCreatedMessage,
  createPlanUpdatedMessage,
  createPlanDeletedMessage,
  createPlanStatusChangedMessage,

  // Node event factories
  createNodeCreatedMessage,
  createNodeUpdatedMessage,
  createNodeDeletedMessage,
  createNodeMovedMessage,
  createNodeStatusChangedMessage,

  // Collaboration event factories
  createUserAssignedMessage,
  createUserUnassignedMessage,
  createCommentAddedMessage,
  createCommentUpdatedMessage,
  createCommentDeletedMessage,
  createLogAddedMessage,
  createLabelAddedMessage,
  createLabelRemovedMessage,
  createDecisionRequestedMessage,
  createDecisionResolvedMessage,

  // Collaborator event factories
  createCollaboratorAddedMessage,
  createCollaboratorRemovedMessage,
  createCollaboratorRoleChangedMessage
};
