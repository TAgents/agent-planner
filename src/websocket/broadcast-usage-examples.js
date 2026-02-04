/**
 * WebSocket Broadcast Utility - Usage Examples
 *
 * This file demonstrates how to use the broadcast utility in controllers.
 * These are example code snippets, not meant to be executed directly.
 */

// ============================================================================
// EXAMPLE 1: Broadcasting plan updates
// ============================================================================

/**
 * Example: Broadcasting when a plan is created
 */
async function examplePlanCreated(req, res) {
  const { broadcastPlanUpdate } = require('../websocket/broadcast');
  const { createPlanCreatedMessage } = require('../websocket/message-schema');

  // ... create plan in database ...
  const newPlan = {
    id: 'plan-uuid',
    title: 'New Plan',
    description: 'Plan description',
    status: 'draft',
    owner_id: req.user.id,
    created_at: new Date().toISOString()
  };

  // Broadcast to all users viewing this plan
  const message = createPlanCreatedMessage(newPlan, req.user.id, req.user.name);
  await broadcastPlanUpdate(newPlan.id, message);

  res.json({ plan: newPlan });
}

/**
 * Example: Broadcasting when a plan is updated
 */
async function examplePlanUpdated(req, res) {
  const { broadcastPlanUpdate } = require('../websocket/broadcast');
  const { createPlanUpdatedMessage } = require('../websocket/message-schema');

  // ... update plan in database ...
  const updatedPlan = { /* plan object */ };

  // Broadcast to all users viewing this plan
  const message = createPlanUpdatedMessage(updatedPlan, req.user.id, req.user.name);
  await broadcastPlanUpdate(updatedPlan.id, message);

  res.json({ plan: updatedPlan });
}

/**
 * Example: Broadcasting plan status changes
 */
async function examplePlanStatusChanged(req, res) {
  const { broadcastPlanUpdate } = require('../websocket/broadcast');
  const { createPlanStatusChangedMessage } = require('../websocket/message-schema');

  const planId = req.params.id;
  const oldStatus = 'draft';
  const newStatus = req.body.status;

  // ... update status in database ...

  // Broadcast status change
  const message = createPlanStatusChangedMessage(planId, oldStatus, newStatus, req.user.id, req.user.name);
  await broadcastPlanUpdate(planId, message);

  res.json({ status: newStatus });
}

// ============================================================================
// EXAMPLE 2: Broadcasting node updates
// ============================================================================

/**
 * Example: Broadcasting when a node is created
 */
async function exampleNodeCreated(req, res) {
  const { broadcastPlanUpdate } = require('../websocket/broadcast');
  const { createNodeCreatedMessage } = require('../websocket/message-schema');

  // ... create node in database ...
  const newNode = {
    id: 'node-uuid',
    plan_id: 'plan-uuid',
    parent_id: 'parent-uuid',
    node_type: 'task',
    title: 'New Task',
    description: 'Task description',
    status: 'not_started',
    order_index: 0,
    created_at: new Date().toISOString()
  };

  // Broadcast to all users viewing this plan
  const message = createNodeCreatedMessage(newNode, req.user.id, req.user.name);
  await broadcastPlanUpdate(newNode.plan_id, message);

  res.json({ node: newNode });
}

/**
 * Example: Broadcasting when a node is updated
 */
async function exampleNodeUpdated(req, res) {
  const { broadcastPlanUpdate } = require('../websocket/broadcast');
  const { createNodeUpdatedMessage } = require('../websocket/message-schema');

  // ... update node in database ...
  const updatedNode = { /* node object */ };

  // Broadcast to all users viewing this plan
  const message = createNodeUpdatedMessage(updatedNode, req.user.id, req.user.name);
  await broadcastPlanUpdate(updatedNode.plan_id, message);

  res.json({ node: updatedNode });
}

/**
 * Example: Broadcasting when a node is moved
 */
async function exampleNodeMoved(req, res) {
  const { broadcastPlanUpdate } = require('../websocket/broadcast');
  const { createNodeMovedMessage } = require('../websocket/message-schema');

  const nodeId = req.params.nodeId;
  const planId = req.params.planId;
  const moveData = {
    oldParentId: 'old-parent-uuid',
    newParentId: req.body.parent_id,
    oldOrderIndex: 0,
    newOrderIndex: req.body.order_index
  };

  // ... update node in database ...

  // Broadcast move event
  const message = createNodeMovedMessage(nodeId, planId, moveData, req.user.id, req.user.name);
  await broadcastPlanUpdate(planId, message);

  res.json({ nodeId, ...moveData });
}

/**
 * Example: Broadcasting node status changes
 */
async function exampleNodeStatusChanged(req, res) {
  const { broadcastNodeUpdate } = require('../websocket/broadcast');
  const { createNodeStatusChangedMessage } = require('../websocket/message-schema');

  const { planId, nodeId } = req.params;
  const oldStatus = 'not_started';
  const newStatus = req.body.status;

  // ... update status in database ...

  // Broadcast to users viewing this specific node
  const message = createNodeStatusChangedMessage(nodeId, planId, oldStatus, newStatus, req.user.id, req.user.name);
  await broadcastNodeUpdate(nodeId, planId, message);

  res.json({ nodeId, status: newStatus });
}

// ============================================================================
// EXAMPLE 3: Broadcasting collaboration events
// ============================================================================

/**
 * Example: Broadcasting when a user is assigned to a node
 */
async function exampleUserAssigned(req, res) {
  const { broadcastPlanUpdate } = require('../websocket/broadcast');
  const { createUserAssignedMessage } = require('../websocket/message-schema');

  const { planId, nodeId } = req.params;
  const assignedUserId = req.body.user_id;
  const assignedUserName = req.body.user_name;

  // ... create assignment in database ...

  // Broadcast assignment
  const message = createUserAssignedMessage(
    nodeId,
    planId,
    assignedUserId,
    assignedUserName,
    req.user.id,
    req.user.name
  );
  await broadcastPlanUpdate(planId, message);

  res.json({ nodeId, assignedUserId });
}

/**
 * Example: Broadcasting when a comment is added
 */
async function exampleCommentAdded(req, res) {
  const { broadcastPlanUpdate } = require('../websocket/broadcast');
  const { createCommentAddedMessage } = require('../websocket/message-schema');

  // ... create comment in database ...
  const newComment = {
    id: 'comment-uuid',
    plan_node_id: req.params.nodeId,
    user_id: req.user.id,
    content: req.body.content,
    comment_type: 'human',
    created_at: new Date().toISOString()
  };

  // Broadcast to all users viewing this plan
  const message = createCommentAddedMessage(newComment, req.params.planId, req.user.name);
  await broadcastPlanUpdate(req.params.planId, message);

  res.json({ comment: newComment });
}

/**
 * Example: Broadcasting when a log is added
 */
async function exampleLogAdded(req, res) {
  const { broadcastPlanUpdate } = require('../websocket/broadcast');
  const { createLogAddedMessage } = require('../websocket/message-schema');

  // ... create log in database ...
  const newLog = {
    id: 'log-uuid',
    plan_node_id: req.params.nodeId,
    user_id: req.user.id,
    content: req.body.content,
    log_type: req.body.log_type || 'progress',
    tags: req.body.tags || [],
    created_at: new Date().toISOString()
  };

  // Broadcast to all users viewing this plan
  const message = createLogAddedMessage(newLog, req.params.planId, req.user.name);
  await broadcastPlanUpdate(req.params.planId, message);

  res.json({ log: newLog });
}

// ============================================================================
// EXAMPLE 4: Broadcasting collaborator events
// ============================================================================

/**
 * Example: Broadcasting when a collaborator is added
 */
async function exampleCollaboratorAdded(req, res) {
  const { broadcastPlanUpdate } = require('../websocket/broadcast');
  const { createCollaboratorAddedMessage } = require('../websocket/message-schema');

  // ... create collaborator in database ...
  const newCollaborator = {
    id: 'collaborator-uuid',
    plan_id: req.params.planId,
    user_id: req.body.user_id,
    user_name: req.body.user_name,
    user_email: req.body.user_email,
    role: req.body.role
  };

  // Broadcast to all users viewing this plan (including the new collaborator if they're online)
  const message = createCollaboratorAddedMessage(newCollaborator, req.user.id, req.user.name);
  await broadcastPlanUpdate(req.params.planId, message);

  res.json({ collaborator: newCollaborator });
}

/**
 * Example: Broadcasting when a collaborator's role changes
 */
async function exampleCollaboratorRoleChanged(req, res) {
  const { broadcastPlanUpdate } = require('../websocket/broadcast');
  const { createCollaboratorRoleChangedMessage } = require('../websocket/message-schema');

  // ... update role in database ...
  const updatedCollaborator = {
    id: req.params.collaboratorId,
    plan_id: req.params.planId,
    user_id: 'user-uuid',
    role: req.body.role
  };
  const oldRole = 'viewer';

  // Broadcast role change
  const message = createCollaboratorRoleChangedMessage(updatedCollaborator, oldRole, req.user.id, req.user.name);
  await broadcastPlanUpdate(req.params.planId, message);

  res.json({ collaborator: updatedCollaborator });
}

// ============================================================================
// EXAMPLE 5: Using utility functions
// ============================================================================

/**
 * Example: Checking who's viewing a plan before broadcasting
 */
async function exampleCheckActiveUsers(req, res) {
  const { getActivePlanUsers, broadcastPlanUpdate } = require('../websocket/broadcast');

  const planId = req.params.planId;

  // Check who's currently viewing
  const activeUsers = await getActivePlanUsers(planId);

  if (activeUsers.length > 0) {
    // Only broadcast if there are active users
    const message = { /* ... */ };
    await broadcastPlanUpdate(planId, message);
  }

  res.json({ activeUsers });
}

/**
 * Example: Sending a targeted notification to a specific user
 */
async function exampleSendToUser(req, res) {
  const { sendToUser } = require('../websocket/broadcast');

  const targetUserId = req.body.target_user_id;

  // Send notification to specific user
  const sent = await sendToUser(targetUserId, {
    type: 'notification',
    payload: {
      message: 'You have been assigned to a new task',
      taskId: req.params.taskId
    },
    metadata: {
      timestamp: new Date().toISOString()
    }
  });

  if (sent) {
    res.json({ message: 'Notification sent' });
  } else {
    res.json({ message: 'User not connected, notification queued for later' });
  }
}

/**
 * Example: Broadcasting custom events
 */
async function exampleCustomBroadcast(req, res) {
  const { broadcastCustom } = require('../websocket/broadcast');

  const planId = req.params.planId;

  // Broadcast a custom event
  await broadcastCustom(planId, 'custom.event', {
    customField: 'custom value',
    timestamp: new Date().toISOString()
  });

  res.json({ message: 'Custom event broadcasted' });
}

// ============================================================================
// EXAMPLE 6: Error handling patterns
// ============================================================================

/**
 * Example: Proper error handling - broadcast failures don't break API calls
 */
async function exampleErrorHandling(req, res) {
  const { broadcastPlanUpdate } = require('../websocket/broadcast');
  const { createPlanUpdatedMessage } = require('../websocket/message-schema');

  try {
    // ... update plan in database ...
    const updatedPlan = { /* plan object */ };

    // Broadcast - this won't throw even if WebSocket fails
    const message = createPlanUpdatedMessage(updatedPlan, req.user.id, req.user.name);
    const broadcasted = await broadcastPlanUpdate(updatedPlan.id, message);

    // You can check if broadcast succeeded, but API call still succeeds
    if (!broadcasted) {
      // Log or handle the fact that broadcast failed, but don't fail the request
      console.log('WebSocket broadcast failed, but operation succeeded');
    }

    // Always return success if database operation succeeded
    res.json({ plan: updatedPlan });
  } catch (error) {
    // Only database errors should fail the request
    res.status(500).json({ error: error.message });
  }
}

/**
 * Example: Excluding the current user from broadcasts
 */
async function exampleExcludeUser(req, res) {
  const { broadcastPlanUpdate } = require('../websocket/broadcast');
  const { createNodeUpdatedMessage } = require('../websocket/message-schema');

  // ... update node in database ...
  const updatedNode = { /* node object */ };

  // Broadcast to everyone EXCEPT the user who made the change
  // (they already have the latest data)
  const message = createNodeUpdatedMessage(updatedNode, req.user.id, req.user.name);
  await broadcastPlanUpdate(updatedNode.plan_id, message, req.user.id);

  res.json({ node: updatedNode });
}

// ============================================================================
// EXPORT (for documentation purposes only)
// ============================================================================

module.exports = {
  // These are examples, not actual controller functions
  examplePlanCreated,
  examplePlanUpdated,
  exampleNodeCreated,
  exampleNodeUpdated,
  exampleNodeMoved,
  exampleCommentAdded,
  exampleLogAdded,
  exampleArtifactAdded,
  exampleCollaboratorAdded,
  exampleUserAssigned,
  exampleCheckActiveUsers,
  exampleSendToUser,
  exampleCustomBroadcast,
  exampleErrorHandling,
  exampleExcludeUser
};
