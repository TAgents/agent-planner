# WebSocket Message Schema - Usage Examples

This document provides comprehensive examples of how to use the WebSocket message schema in controllers and other backend code.

## Table of Contents
- [Overview](#overview)
- [Basic Usage](#basic-usage)
- [Plan Events](#plan-events)
- [Node Events](#node-events)
- [Collaboration Events](#collaboration-events)
- [Collaborator Events](#collaborator-events)
- [Integration with Controllers](#integration-with-controllers)
- [Message Structure](#message-structure)

## Overview

The WebSocket message schema provides:
- **Standardized event types** for all CRUD operations
- **Factory functions** for creating properly formatted messages
- **Consistent metadata** for routing and user tracking
- **Type definitions** via JSDoc for IDE autocomplete

### Schema Version: 1.0.0

All messages include a version field for future compatibility.

## Basic Usage

```javascript
const {
  createNodeCreatedMessage,
  createPlanUpdatedMessage,
  EVENT_TYPES
} = require('../websocket/message-schema');

// In your controller
const message = createNodeCreatedMessage(node, req.user.id, req.user.name);

// Broadcast to all users in the plan
collaborationServer.broadcastToPlan(node.plan_id, message);
```

## Plan Events

### plan.created

**When to emit:** After successfully creating a new plan in the database.

```javascript
const { plansDal } = require('../db/dal.cjs');
const { createPlanCreatedMessage } = require('../websocket/message-schema');

// In plan.controller.js - createPlan()
async function createPlan(req, res) {
  const { title, description, status } = req.body;

  // Create plan in database via DAL
  const plan = await plansDal.create({
    title, description, status, owner_id: req.user.id
  });

  // Broadcast WebSocket message
  const message = createPlanCreatedMessage(plan, req.user.id, req.user.name);
  req.app.collaborationServer.broadcastToPlan(plan.id, message);

  return res.status(201).json(plan);
}
```

**Message example:**
```json
{
  "type": "plan.created",
  "payload": {
    "id": "123e4567-e89b-12d3-a456-426614174000",
    "title": "Q4 Product Roadmap",
    "description": "Planning for Q4 releases",
    "status": "draft",
    "ownerId": "user-uuid-123",
    "createdAt": "2025-11-11T10:30:00.000Z",
    "metadata": {}
  },
  "metadata": {
    "userId": "user-uuid-123",
    "userName": "John Doe",
    "timestamp": "2025-11-11T10:30:00.000Z",
    "planId": "123e4567-e89b-12d3-a456-426614174000",
    "version": "1.0.0"
  }
}
```

### plan.updated

**When to emit:** After updating plan properties (title, description, metadata).

```javascript
const { plansDal } = require('../db/dal.cjs');
const { createPlanUpdatedMessage } = require('../websocket/message-schema');

async function updatePlan(req, res) {
  const { id } = req.params;
  const updates = req.body;

  const plan = await plansDal.update(id, updates);

  const message = createPlanUpdatedMessage(plan, req.user.id, req.user.name);
  req.app.collaborationServer.broadcastToPlan(plan.id, message);

  return res.json(plan);
}
```

### plan.status_changed

**When to emit:** Specifically when the plan status changes (more granular than plan.updated).

```javascript
const { plansDal } = require('../db/dal.cjs');
const { createPlanStatusChangedMessage } = require('../websocket/message-schema');

async function changePlanStatus(req, res) {
  const { id } = req.params;
  const { status } = req.body;

  // Get current status first
  const currentPlan = await plansDal.findById(id);
  const oldStatus = currentPlan.status;

  // Update status
  await plansDal.update(id, { status });

  // Emit specific status change event
  const message = createPlanStatusChangedMessage(
    id,
    oldStatus,
    status,
    req.user.id,
    req.user.name
  );
  req.app.collaborationServer.broadcastToPlan(id, message);

  return res.json({ success: true });
}
```

### plan.deleted

**When to emit:** After deleting a plan.

```javascript
const { plansDal } = require('../db/dal.cjs');
const { createPlanDeletedMessage } = require('../websocket/message-schema');

async function deletePlan(req, res) {
  const { id } = req.params;

  await plansDal.remove(id);

  const message = createPlanDeletedMessage(id, req.user.id, req.user.name);
  req.app.collaborationServer.broadcastToPlan(id, message);

  return res.json({ success: true });
}
```

## Node Events

### node.created

**When to emit:** After creating a new node (phase, task, or milestone).

```javascript
const { nodesDal } = require('../db/dal.cjs');
const { createNodeCreatedMessage } = require('../websocket/message-schema');

async function createNode(req, res) {
  const { plan_id } = req.params;
  const nodeData = req.body;

  const node = await nodesDal.create({ ...nodeData, plan_id });

  const message = createNodeCreatedMessage(node, req.user.id, req.user.name);
  req.app.collaborationServer.broadcastToPlan(plan_id, message);

  return res.status(201).json(node);
}
```

**Message example:**
```json
{
  "type": "node.created",
  "payload": {
    "id": "node-uuid-456",
    "planId": "plan-uuid-123",
    "parentId": "parent-node-uuid-789",
    "nodeType": "task",
    "title": "Implement user authentication",
    "description": "Add OAuth2 support",
    "status": "not_started",
    "orderIndex": 0,
    "dueDate": "2025-11-30T00:00:00.000Z",
    "createdAt": "2025-11-11T10:30:00.000Z",
    "metadata": {}
  },
  "metadata": {
    "userId": "user-uuid-123",
    "userName": "Jane Smith",
    "timestamp": "2025-11-11T10:30:00.000Z",
    "planId": "plan-uuid-123",
    "version": "1.0.0"
  }
}
```

### node.updated

**When to emit:** After updating node properties.

```javascript
const { nodesDal } = require('../db/dal.cjs');
const { createNodeUpdatedMessage } = require('../websocket/message-schema');

async function updateNode(req, res) {
  const { plan_id, node_id } = req.params;
  const updates = req.body;

  const node = await nodesDal.update(node_id, updates);

  const message = createNodeUpdatedMessage(node, req.user.id, req.user.name);
  req.app.collaborationServer.broadcastToPlan(plan_id, message);

  return res.json(node);
}
```

### node.status_changed

**When to emit:** Specifically when node status changes (e.g., not_started → in_progress).

```javascript
const { nodesDal } = require('../db/dal.cjs');
const { createNodeStatusChangedMessage } = require('../websocket/message-schema');

async function changeNodeStatus(req, res) {
  const { plan_id, node_id } = req.params;
  const { status } = req.body;

  // Get current status
  const currentNode = await nodesDal.findById(node_id);
  const oldStatus = currentNode.status;

  // Update status
  await nodesDal.update(node_id, { status });

  // Emit status change event
  const message = createNodeStatusChangedMessage(
    node_id,
    plan_id,
    oldStatus,
    status,
    req.user.id,
    req.user.name
  );
  req.app.collaborationServer.broadcastToPlan(plan_id, message);

  return res.json({ success: true });
}
```

### node.moved

**When to emit:** When a node is moved to a different parent or reordered.

```javascript
const { nodesDal } = require('../db/dal.cjs');
const { createNodeMovedMessage } = require('../websocket/message-schema');

async function moveNode(req, res) {
  const { plan_id, node_id } = req.params;
  const { new_parent_id, new_order_index } = req.body;

  // Get current position
  const currentNode = await nodesDal.findById(node_id);

  // Update position
  await nodesDal.update(node_id, {
    parent_id: new_parent_id,
    order_index: new_order_index
  });

  // Emit move event
  const moveData = {
    oldParentId: currentNode.parent_id,
    newParentId: new_parent_id,
    oldOrderIndex: currentNode.order_index,
    newOrderIndex: new_order_index
  };

  const message = createNodeMovedMessage(
    node_id,
    plan_id,
    moveData,
    req.user.id,
    req.user.name
  );
  req.app.collaborationServer.broadcastToPlan(plan_id, message);

  return res.json({ success: true });
}
```

### node.deleted

**When to emit:** After deleting a node.

```javascript
const { nodesDal } = require('../db/dal.cjs');
const { createNodeDeletedMessage } = require('../websocket/message-schema');

async function deleteNode(req, res) {
  const { plan_id, node_id } = req.params;

  await nodesDal.remove(node_id);

  const message = createNodeDeletedMessage(
    node_id,
    plan_id,
    req.user.id,
    req.user.name
  );
  req.app.collaborationServer.broadcastToPlan(plan_id, message);

  return res.json({ success: true });
}
```

## Collaboration Events

### collaboration.user_assigned

**When to emit:** When a user is assigned to a node.

```javascript
const { usersDal } = require('../db/dal.cjs');
const { createUserAssignedMessage } = require('../websocket/message-schema');

async function assignUser(req, res) {
  const { plan_id, node_id } = req.params;
  const { user_id } = req.body;

  // Get assigned user info
  const assignedUser = await usersDal.findById(user_id);

  // Create assignment (handled by appropriate DAL)
  // ... assignment logic ...

  // Emit event
  const message = createUserAssignedMessage(
    node_id,
    plan_id,
    assignedUser.id,
    assignedUser.name,
    req.user.id,
    req.user.name
  );
  req.app.collaborationServer.broadcastToPlan(plan_id, message);

  return res.json({ success: true });
}
```

### collaboration.comment_added

**When to emit:** When a comment is added to a node.

```javascript
const dal = require('../db/dal.cjs');
const { createCommentAddedMessage } = require('../websocket/message-schema');

async function addComment(req, res) {
  const { plan_id, node_id } = req.params;
  const { content, comment_type } = req.body;

  // Create comment via DAL
  const comment = await dal.commentsDal.create({
    plan_node_id: node_id,
    user_id: req.user.id,
    content,
    comment_type: comment_type || 'human'
  });

  const message = createCommentAddedMessage(
    comment,
    plan_id,
    req.user.name
  );
  req.app.collaborationServer.broadcastToPlan(plan_id, message);

  return res.status(201).json(comment);
}
```

### collaboration.log_added

**When to emit:** When a log entry is added to a node.

```javascript
const { createLogAddedMessage } = require('../websocket/message-schema');

async function addLog(req, res) {
  const { plan_id, node_id } = req.params;
  const { content, log_type, tags, actor_type } = req.body;

  // Build metadata with actor_type if provided
  const metadata = actor_type ? { actor_type } : {};

  // Create log entry via DAL
  const log = await dal.logsDal.create({
    plan_node_id: node_id,
    user_id: req.user.id,
    content,
    log_type,
    tags: tags || [],
    metadata
  });

  // createLogAddedMessage extracts actor_type from log.metadata
  const message = createLogAddedMessage(log, plan_id, req.user.name);
  req.app.collaborationServer.broadcastToPlan(plan_id, message);

  return res.status(201).json(log);
}
```

### collaboration.label_added

**When to emit:** When a label/tag is added to a node.

```javascript
const { createLabelAddedMessage } = require('../websocket/message-schema');

async function addLabel(req, res) {
  const { plan_id, node_id } = req.params;
  const { label } = req.body;

  // Create label via DAL
  const labelRecord = await dal.labelsDal.create({
    plan_node_id: node_id,
    label
  });

  const message = createLabelAddedMessage(
    labelRecord,
    plan_id,
    req.user.id,
    req.user.name
  );
  req.app.collaborationServer.broadcastToPlan(plan_id, message);

  return res.status(201).json(labelRecord);
}
```

## Collaborator Events

### collaborator.added

**When to emit:** When a user is added as a collaborator to a plan.

```javascript
const { createCollaboratorAddedMessage } = require('../websocket/message-schema');

async function addCollaborator(req, res) {
  const { plan_id } = req.params;
  const { user_id, role } = req.body;

  // Get user info and create collaborator via DAL
  const { usersDal, collaboratorsDal } = require('../db/dal.cjs');
  const user = await usersDal.findById(user_id);

  const collaborator = await collaboratorsDal.create({
    plan_id,
    user_id,
    role: role || 'viewer'
  });

  const collaboratorWithUserInfo = {
    ...collaborator,
    user_name: user.name,
    user_email: user.email
  };

  const message = createCollaboratorAddedMessage(
    collaboratorWithUserInfo,
    req.user.id,
    req.user.name
  );
  req.app.collaborationServer.broadcastToPlan(plan_id, message);

  return res.status(201).json(collaborator);
}
```

### collaborator.role_changed

**When to emit:** When a collaborator's role is changed.

```javascript
const { createCollaboratorRoleChangedMessage } = require('../websocket/message-schema');

async function changeCollaboratorRole(req, res) {
  const { plan_id, collaborator_id } = req.params;
  const { role } = req.body;

  // Get current role and update via DAL
  const { collaboratorsDal } = require('../db/dal.cjs');
  const current = await collaboratorsDal.findById(collaborator_id);
  const oldRole = current.role;

  const collaborator = await collaboratorsDal.update(collaborator_id, { role });

  const message = createCollaboratorRoleChangedMessage(
    collaborator,
    oldRole,
    req.user.id,
    req.user.name
  );
  req.app.collaborationServer.broadcastToPlan(plan_id, message);

  return res.json(collaborator);
}
```

## Integration with Controllers

### Complete Controller Example

```javascript
// plan.controller.js
const { plansDal, nodesDal } = require('../db/dal.cjs');
const {
  createPlanCreatedMessage,
  createPlanUpdatedMessage,
  createPlanDeletedMessage
} = require('../websocket/message-schema');

/**
 * Create a new plan
 */
async function createPlan(req, res) {
  try {
    const { title, description, status } = req.body;

    // Validate input
    if (!title) {
      return res.status(400).json({ error: 'Title is required' });
    }

    // Create plan in database via DAL
    const plan = await plansDal.create({
      title,
      description,
      status: status || 'draft',
      owner_id: req.user.id
    });

    // Create root node for the plan
    await nodesDal.create({
      plan_id: plan.id,
      node_type: 'root',
      title: plan.title,
      status: 'not_started',
      order_index: 0
    });

    // Broadcast WebSocket message to all users in the plan
    const message = createPlanCreatedMessage(
      plan,
      req.user.id,
      req.user.name
    );
    req.app.collaborationServer.broadcastToPlan(plan.id, message);

    return res.status(201).json(plan);

  } catch (error) {
    console.error('Error creating plan:', error);
    return res.status(500).json({ error: 'Failed to create plan' });
  }
}

/**
 * Update a plan
 */
async function updatePlan(req, res) {
  try {
    const { id } = req.params;
    const updates = req.body;

    // Update plan in database via DAL
    const plan = await plansDal.update(id, updates);

    // Broadcast WebSocket message
    const message = createPlanUpdatedMessage(
      plan,
      req.user.id,
      req.user.name
    );
    req.app.collaborationServer.broadcastToPlan(id, message);

    return res.json(plan);

  } catch (error) {
    console.error('Error updating plan:', error);
    return res.status(500).json({ error: 'Failed to update plan' });
  }
}

/**
 * Delete a plan
 */
async function deletePlan(req, res) {
  try {
    const { id } = req.params;

    // Delete plan (cascade will handle nodes, etc.)
    await plansDal.remove(id);

    // Broadcast WebSocket message
    const message = createPlanDeletedMessage(
      id,
      req.user.id,
      req.user.name
    );
    req.app.collaborationServer.broadcastToPlan(id, message);

    return res.json({ success: true, message: 'Plan deleted' });

  } catch (error) {
    console.error('Error deleting plan:', error);
    return res.status(500).json({ error: 'Failed to delete plan' });
  }
}

module.exports = {
  createPlan,
  updatePlan,
  deletePlan
};
```

## Message Structure

All messages follow this structure:

```javascript
{
  type: string,        // Event type from EVENT_TYPES
  payload: object,     // Event-specific data
  metadata: {
    userId: string,    // User UUID who triggered the event
    userName: string,  // Optional user display name
    timestamp: string, // ISO 8601 timestamp
    planId: string,    // Plan UUID for routing
    version: string    // Schema version (1.0.0)
  }
}
```

### Routing by Plan ID

The `metadata.planId` field is critical for the WebSocket server to route messages to the correct users. All users who have joined a plan (via `join_plan` message) will receive events for that plan.

### User Information

Always include both `userId` and optionally `userName` to enable:
- Displaying who made changes in the UI
- Filtering events by user
- Audit trails

### Timestamps

All timestamps are in ISO 8601 format (e.g., `2025-11-11T10:30:00.000Z`) for consistency across time zones.

## Best Practices

1. **Always broadcast after successful database operations**: Only emit WebSocket events after the database operation succeeds.

2. **Include user context**: Always pass `req.user.id` and `req.user.name` to factory functions.

3. **Use specific events when appropriate**: Use `status_changed` instead of generic `updated` for status changes to enable granular UI updates.

4. **Handle errors gracefully**: Don't broadcast events if the database operation fails.

5. **Don't exclude the triggering user**: The current implementation allows the triggering user to also receive the event for optimistic UI updates and consistency.

6. **Keep payloads lean**: Only include necessary data. Frontend can fetch full details if needed.

7. **Version your messages**: The schema includes a version field for future compatibility.

## Testing Messages

You can test message creation in isolation:

```javascript
const {
  createNodeCreatedMessage,
  EVENT_TYPES
} = require('../websocket/message-schema');

// Mock data
const mockNode = {
  id: 'node-uuid-123',
  plan_id: 'plan-uuid-456',
  parent_id: null,
  node_type: 'task',
  title: 'Test task',
  description: 'Test description',
  status: 'not_started',
  order_index: 0,
  due_date: null,
  created_at: new Date().toISOString(),
  metadata: {}
};

const message = createNodeCreatedMessage(
  mockNode,
  'user-uuid-789',
  'Test User'
);

console.log(JSON.stringify(message, null, 2));

// Verify structure
console.assert(message.type === EVENT_TYPES.CREATED);
console.assert(message.metadata.planId === mockNode.plan_id);
console.assert(message.metadata.version === '1.0.0');
```

## Future Extensions

The schema is designed to be extensible. Future additions might include:

- Batch operation events (e.g., `nodes.batch_updated`)
- Fine-grained field-level updates
- Undo/redo support
- Conflict resolution for simultaneous edits
- Binary protocol for performance

When adding new events:
1. Add the event type constant to the appropriate category
2. Create a factory function following the naming convention
3. Document with JSDoc
4. Add examples to this file
5. Update the version if the change is breaking
