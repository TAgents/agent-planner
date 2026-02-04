# WebSocket Message Schema

A standardized schema for WebSocket messages in the Agent Planner system, enabling real-time synchronization of plans, nodes, and collaboration events.

## Overview

This schema provides a consistent structure for all WebSocket events in the system, from basic presence tracking to complex data synchronization. It covers CRUD operations for plans and nodes, collaboration activities, and user presence.

**Schema Version:** 1.0.0

## Files

| File | Lines | Description |
|------|-------|-------------|
| `broadcast.js` | 300+ | **Main utility for controllers** - Easy-to-use broadcast API with error handling |
| `message-schema.js` | 766 | Core schema with event types, JSDoc definitions, and factory functions |
| `collaboration.js` | 392 | WebSocket server implementation (connection management, presence tracking) |
| `broadcast-usage-examples.js` | 500+ | Comprehensive examples of broadcast utility usage in controllers |
| `MESSAGE_SCHEMA_EXAMPLES.md` | 904 | Message schema usage examples for all event types |
| `INTEGRATION_GUIDE.md` | 515 | Integration patterns, testing, and migration guide |
| `EXAMPLE_MESSAGES.json` | 200 | Actual message examples in JSON format |

## Quick Start

### 1. Import the Utilities

```javascript
// Import the broadcast utility (primary API for controllers)
const { broadcastPlanUpdate } = require('../websocket/broadcast');

// Import message factory functions
const { createNodeCreatedMessage } = require('../websocket/message-schema');
```

### 2. Create and Broadcast Messages

```javascript
// After a successful database operation
const message = createNodeCreatedMessage(node, req.user.id, req.user.name);

// Broadcast to all users viewing this plan
await broadcastPlanUpdate(node.plan_id, message);
```

**Note:** The broadcast utility handles all error management automatically. WebSocket failures will not break your API calls.

### 3. Complete Controller Example

```javascript
// node.controller.js
const { broadcastPlanUpdate } = require('../websocket/broadcast');
const { createNodeCreatedMessage } = require('../websocket/message-schema');

async function createNode(req, res) {
  try {
    // 1. Create node in database
    const { data: newNode, error } = await supabase
      .from('plan_nodes')
      .insert(req.body)
      .select()
      .single();

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    // 2. Broadcast to WebSocket clients (error-safe)
    const message = createNodeCreatedMessage(newNode, req.user.id, req.user.name);
    await broadcastPlanUpdate(newNode.plan_id, message);

    // 3. Return HTTP response
    return res.status(201).json({ node: newNode });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
```

### 4. Example Message Structure

All messages follow this format:

```json
{
  "type": "node.created",
  "payload": {
    "id": "node-uuid",
    "planId": "plan-uuid",
    "title": "Implement authentication",
    "status": "in_progress"
  },
  "metadata": {
    "userId": "user-uuid",
    "userName": "Jane Smith",
    "timestamp": "2025-11-11T10:30:00.000Z",
    "planId": "plan-uuid",
    "version": "1.0.0"
  }
}
```

## Event Categories

### Plan Events (4)
- `plan.created` - Plan created
- `plan.updated` - Plan properties updated
- `plan.deleted` - Plan deleted
- `plan.status_changed` - Plan status changed

### Node Events (5)
- `node.created` - Node created
- `node.updated` - Node properties updated
- `node.deleted` - Node deleted
- `node.moved` - Node moved to different parent or reordered
- `node.status_changed` - Node status changed

### Collaboration Events (10)
- `collaboration.user_assigned` - User assigned to node
- `collaboration.user_unassigned` - User unassigned from node
- `collaboration.comment_added` - Comment added to node
- `collaboration.comment_updated` - Comment updated
- `collaboration.comment_deleted` - Comment deleted
- `collaboration.log_added` - Log entry added to node
- `collaboration.label_added` - Label added to node
- `collaboration.label_removed` - Label removed from node

### Collaborator Events (3)
- `collaborator.added` - Collaborator added to plan
- `collaborator.removed` - Collaborator removed from plan
- `collaborator.role_changed` - Collaborator role changed

### Presence Events (9 - Existing)
- `user_joined_plan` - User joined a plan view
- `user_left_plan` - User left a plan view
- `user_joined_node` - User joined a node view
- `user_left_node` - User left a node view
- `typing_start` - User started typing
- `typing_stop` - User stopped typing
- `presence_update` - User presence status changed
- `active_users` - List of active users in plan
- `node_viewers` - List of users viewing a node

### Connection Events (4 - Existing)
- `connection` - Connection established
- `ping` - Ping request
- `pong` - Pong response
- `error` - Error occurred

**Total:** 35 event types

## Broadcast Utility API

The `broadcast.js` module provides the primary API for controllers:

### Core Functions

```javascript
const {
  broadcastPlanUpdate,    // Broadcast to all users viewing a plan
  broadcastNodeUpdate,    // Broadcast to users viewing a specific node
  sendToUser,             // Send to a specific user
  broadcastCustom,        // Broadcast custom events
  getActivePlanUsers,     // Get active users in a plan
  getActiveNodeUsers,     // Get active users viewing a node
  getTypingUsers          // Get users typing in a node
} = require('../websocket/broadcast');
```

### Error Handling

All broadcast functions are **fail-safe**:
- Return `false` if WebSocket server is unavailable (no error thrown)
- Log errors but never throw exceptions
- API calls always succeed if database operation succeeds
- Controllers don't need try/catch around broadcasts

### Usage Patterns

```javascript
// Standard broadcast (most common)
await broadcastPlanUpdate(planId, message);

// Exclude current user (optional optimization)
await broadcastPlanUpdate(planId, message, req.user.id);

// Broadcast to node viewers
await broadcastNodeUpdate(nodeId, planId, message);

// Send to specific user
await sendToUser(userId, notificationMessage);

// Check who's active before broadcasting
const activeUsers = await getActivePlanUsers(planId);
if (activeUsers.length > 0) {
  await broadcastPlanUpdate(planId, message);
}
```

See `broadcast-usage-examples.js` for comprehensive examples.

## Factory Functions

The schema provides 24 factory functions for creating properly formatted messages:

### Core Functions (2)
- `createMetadata(userId, planId, userName)` - Create metadata object
- `createMessage(eventType, payload, metadata)` - Create complete message

### Plan Functions (4)
- `createPlanCreatedMessage(plan, userId, userName)`
- `createPlanUpdatedMessage(plan, userId, userName)`
- `createPlanDeletedMessage(planId, userId, userName)`
- `createPlanStatusChangedMessage(planId, oldStatus, newStatus, userId, userName)`

### Node Functions (5)
- `createNodeCreatedMessage(node, userId, userName)`
- `createNodeUpdatedMessage(node, userId, userName)`
- `createNodeDeletedMessage(nodeId, planId, userId, userName)`
- `createNodeMovedMessage(nodeId, planId, moveData, userId, userName)`
- `createNodeStatusChangedMessage(nodeId, planId, oldStatus, newStatus, userId, userName)`

### Collaboration Functions (10)
- `createUserAssignedMessage(nodeId, planId, assignedUserId, assignedUserName, assignerUserId, assignerUserName)`
- `createUserUnassignedMessage(nodeId, planId, unassignedUserId, unassignedUserName, unassignerUserId, unassignerUserName)`
- `createCommentAddedMessage(comment, planId, userName)`
- `createCommentUpdatedMessage(comment, planId, userName)`
- `createCommentDeletedMessage(commentId, nodeId, planId, userId, userName)`
- `createLogAddedMessage(log, planId, userName)`
- `createLabelAddedMessage(label, planId, userId, userName)`
- `createLabelRemovedMessage(labelId, nodeId, planId, userId, userName)`

### Collaborator Functions (3)
- `createCollaboratorAddedMessage(collaborator, userId, userName)`
- `createCollaboratorRemovedMessage(collaboratorId, planId, removedUserId, removerUserId, removerUserName)`
- `createCollaboratorRoleChangedMessage(collaborator, oldRole, userId, userName)`

## Message Structure

All messages follow this consistent structure:

```javascript
{
  type: string,        // Event type from EVENT_TYPES
  payload: object,     // Event-specific data
  metadata: {
    userId: string,    // User UUID who triggered the event
    userName: string,  // User display name (optional)
    timestamp: string, // ISO 8601 timestamp
    planId: string,    // Plan UUID for routing
    version: string    // Schema version (1.0.0)
  }
}
```

### Key Design Decisions

1. **planId in metadata**: Every message includes `planId` for room-based routing
2. **userName is optional**: All factory functions accept optional `userName` parameter
3. **ISO 8601 timestamps**: Consistent date/time format across all events
4. **Versioned schema**: `version` field enables future compatibility
5. **Lean payloads**: Only essential data included, frontend can fetch details as needed

## Usage Examples

### Creating a Plan

```javascript
// plan.controller.js
const { broadcastPlanUpdate } = require('../websocket/broadcast');
const { createPlanCreatedMessage } = require('../websocket/message-schema');

async function createPlan(req, res) {
  const { data: plan, error } = await supabase
    .from('plans')
    .insert({ title: req.body.title, owner_id: req.user.id })
    .select()
    .single();

  if (error) {
    return res.status(500).json({ error: error.message });
  }

  // Broadcast to WebSocket clients
  const message = createPlanCreatedMessage(plan, req.user.id, req.user.name);
  await broadcastPlanUpdate(plan.id, message);

  return res.status(201).json(plan);
}
```

### Updating a Node

```javascript
// node.controller.js
const { broadcastPlanUpdate } = require('../websocket/broadcast');
const { createNodeUpdatedMessage } = require('../websocket/message-schema');

async function updateNode(req, res) {
  const { plan_id, node_id } = req.params;

  const { data: node, error } = await supabase
    .from('plan_nodes')
    .update(req.body)
    .eq('id', node_id)
    .select()
    .single();

  if (error) {
    return res.status(500).json({ error: error.message });
  }

  // Broadcast to all users viewing this plan
  const message = createNodeUpdatedMessage(node, req.user.id, req.user.name);
  await broadcastPlanUpdate(plan_id, message);

  return res.json(node);
}
```

### Adding a Comment

```javascript
// comment.controller.js
const { broadcastPlanUpdate } = require('../websocket/broadcast');
const { createCommentAddedMessage } = require('../websocket/message-schema');

async function addComment(req, res) {
  const { plan_id, node_id } = req.params;

  const { data: comment, error } = await supabase
    .from('plan_comments')
    .insert({
      plan_node_id: node_id,
      user_id: req.user.id,
      content: req.body.content,
      comment_type: 'human'
    })
    .select()
    .single();

  if (error) {
    return res.status(500).json({ error: error.message });
  }

  // Broadcast to all plan viewers
  const message = createCommentAddedMessage(comment, plan_id, req.user.name);
  await broadcastPlanUpdate(plan_id, message);

  return res.status(201).json(comment);
}
```

## Integration Checklist

When adding broadcasts to a controller:

- [ ] Import `broadcast` utility and relevant message schema factories
- [ ] Add broadcast call **after** successful database operation
- [ ] Use appropriate factory function (e.g., `createNodeCreatedMessage`)
- [ ] Pass `req.user.id` and `req.user.name` to factory
- [ ] Use `broadcastPlanUpdate()` for most events (reaches all plan viewers)
- [ ] Only use `broadcastNodeUpdate()` for node-specific events (typing, etc.)
- [ ] No try/catch needed around broadcast calls (fail-safe by design)
- [ ] Test with WebSocket client to verify messages
- [ ] Check browser console for broadcast logs in development mode

## Testing

### Unit Test Example

```javascript
const { createNodeCreatedMessage, NODE_EVENTS } = require('./message-schema');

test('creates valid node.created message', () => {
  const node = { id: 'test-id', plan_id: 'plan-id', title: 'Test', ... };
  const message = createNodeCreatedMessage(node, 'user-id', 'Test User');

  expect(message.type).toBe(NODE_EVENTS.CREATED);
  expect(message.payload.id).toBe('test-id');
  expect(message.metadata.userId).toBe('user-id');
  expect(message.metadata.version).toBe('1.0.0');
});
```

### Integration Test Example

```javascript
test('broadcasts node creation via WebSocket', (done) => {
  const ws = new WebSocket('ws://localhost:3000/ws/collaborate?token=...');

  ws.on('message', (data) => {
    const message = JSON.parse(data);
    if (message.type === 'node.created') {
      expect(message.payload.title).toBe('Test Node');
      done();
    }
  });

  // Trigger node creation via REST API
  request(app)
    .post('/plans/test-plan-id/nodes')
    .send({ title: 'Test Node', node_type: 'task' })
    .expect(201);
});
```

## Best Practices

1. **Always broadcast after success**: Only emit events after database operations succeed
2. **Include user context**: Pass `userId` and `userName` to all factory functions
3. **Use specific events**: Prefer `status_changed` over generic `updated` for status changes
4. **Keep payloads lean**: Include only essential data in messages
5. **Don't exclude triggering user**: Let all users receive events for consistency
6. **Version your schema**: Use the `version` field for future compatibility
7. **Document breaking changes**: Update version and migration guide for breaking changes

## Architecture

### Message Flow

```
Controller → Database Operation → Success? → Factory Function → WebSocket Server → Clients
                                     ↓
                                   Failure
                                     ↓
                                Error Response
```

### Room-Based Routing

Messages are routed to users based on the plan they've joined:

```javascript
// User joins a plan room
ws.send(JSON.stringify({ type: 'join_plan', planId: 'plan-123' }));

// All subsequent messages with metadata.planId === 'plan-123'
// will be delivered to this user
```

## Backward Compatibility

The schema is fully backward compatible with the existing WebSocket implementation:

- Existing presence events preserved
- No changes required to `collaboration.js`
- `broadcastToPlan()` and `broadcastToNode()` methods unchanged
- Frontend can progressively adopt new event types

## Future Extensions

Planned additions (will increment schema version):

- Batch operation events (e.g., `nodes.batch_updated`)
- Field-level change tracking
- Conflict resolution events
- Undo/redo support
- Binary protocol for performance

## Support

For questions, issues, or contributions:

1. Read `MESSAGE_SCHEMA_EXAMPLES.md` for detailed examples
2. Check `INTEGRATION_GUIDE.md` for integration patterns
3. Review `EXAMPLE_MESSAGES.json` for message formats
4. Examine existing WebSocket server in `collaboration.js`

## License

Part of the Agent Planner project.

---

**Last Updated:** November 11, 2025
**Schema Version:** 1.0.0
**Contributors:** Development Team
