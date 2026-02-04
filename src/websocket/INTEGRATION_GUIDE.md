# WebSocket Message Schema Integration Guide

This guide explains how to integrate the new message schema with the existing WebSocket server and controllers.

## Quick Start

### 1. Import the Schema

```javascript
const {
  createPlanCreatedMessage,
  createNodeUpdatedMessage,
  createCommentAddedMessage,
  PLAN_EVENTS,
  NODE_EVENTS
} = require('../websocket/message-schema');
```

### 2. Access the WebSocket Server

The CollaborationServer instance is available on the Express app:

```javascript
// In any controller
req.app.collaborationServer.broadcastToPlan(planId, message);
```

### 3. Send Messages After Database Operations

```javascript
// After creating a node
const message = createNodeCreatedMessage(node, req.user.id, req.user.name);
req.app.collaborationServer.broadcastToPlan(node.plan_id, message);
```

## Integration with Existing WebSocket Server

### Current State

The existing `CollaborationServer` in `/src/websocket/collaboration.js` handles:
- Presence tracking (join/leave plan/node)
- Typing indicators
- User-initiated broadcasts

### New Capabilities

The message schema adds:
- **Data synchronization events** for CRUD operations
- **Standardized message format** for all events
- **Factory functions** to ensure consistency

### Backward Compatibility

The new schema is fully backward compatible:
- Existing presence events are preserved in `PRESENCE_EVENTS`
- Existing `broadcastToPlan()` and `broadcastToNode()` methods work with new messages
- No changes required to the WebSocket server itself

## Controller Integration Pattern

### Pattern 1: Simple CRUD Operations

```javascript
// plan.controller.js
const { supabase } = require('../config/supabase');
const { createPlanCreatedMessage } = require('../websocket/message-schema');

async function createPlan(req, res) {
  try {
    // 1. Perform database operation
    const { data: plan, error } = await supabase
      .from('plans')
      .insert({
        title: req.body.title,
        description: req.body.description,
        status: req.body.status || 'draft',
        owner_id: req.user.id
      })
      .select()
      .single();

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    // 2. Broadcast WebSocket message
    const message = createPlanCreatedMessage(plan, req.user.id, req.user.name);
    req.app.collaborationServer.broadcastToPlan(plan.id, message);

    // 3. Return response
    return res.status(201).json(plan);

  } catch (error) {
    return res.status(500).json({ error: 'Failed to create plan' });
  }
}
```

### Pattern 2: Status Changes (Granular Events)

Use specific status change events for better UI reactivity:

```javascript
const { createNodeStatusChangedMessage } = require('../websocket/message-schema');

async function updateNodeStatus(req, res) {
  const { plan_id, node_id } = req.params;
  const { status } = req.body;

  // 1. Get current status
  const { data: currentNode } = await supabase
    .from('plan_nodes')
    .select('status')
    .eq('id', node_id)
    .single();

  const oldStatus = currentNode.status;

  // 2. Update status
  await supabase
    .from('plan_nodes')
    .update({ status })
    .eq('id', node_id);

  // 3. Emit granular status change event
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

### Pattern 3: Batch Operations

For operations affecting multiple entities:

```javascript
const {
  createNodeUpdatedMessage,
  createNodeMovedMessage
} = require('../websocket/message-schema');

async function reorderNodes(req, res) {
  const { plan_id } = req.params;
  const { updates } = req.body; // Array of {nodeId, newOrderIndex}

  // 1. Update all nodes
  for (const update of updates) {
    await supabase
      .from('plan_nodes')
      .update({ order_index: update.newOrderIndex })
      .eq('id', update.nodeId);

    // 2. Emit message for each update
    const node = await getNode(update.nodeId);
    const message = createNodeUpdatedMessage(node, req.user.id, req.user.name);
    req.app.collaborationServer.broadcastToPlan(plan_id, message);
  }

  return res.json({ success: true });
}
```

### Pattern 4: Nested Operations

For operations that affect multiple tables (e.g., deleting a node with children):

```javascript
const { createNodeDeletedMessage } = require('../websocket/message-schema');

async function deleteNode(req, res) {
  const { plan_id, node_id } = req.params;

  // Delete node (cascade will delete child nodes, logs, etc.)
  await supabase
    .from('plan_nodes')
    .delete()
    .eq('id', node_id);

  // Emit node deletion event
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

## Accessing the Collaboration Server

### Method 1: Via Request Object (Recommended)

```javascript
// In any route handler
req.app.collaborationServer.broadcastToPlan(planId, message);
```

### Method 2: Direct Import (For Services)

```javascript
// In a service file
const app = require('../index'); // Your Express app
const collaborationServer = app.collaborationServer;

collaborationServer.broadcastToPlan(planId, message);
```

### Method 3: Pass as Parameter

```javascript
// In service function
async function createNodeService(nodeData, userId, userName, collaborationServer) {
  const node = await createNodeInDb(nodeData);

  const message = createNodeCreatedMessage(node, userId, userName);
  collaborationServer.broadcastToPlan(node.plan_id, message);

  return node;
}

// In controller
async function createNode(req, res) {
  const node = await createNodeService(
    req.body,
    req.user.id,
    req.user.name,
    req.app.collaborationServer
  );
  return res.json(node);
}
```

## Broadcasting Methods

The CollaborationServer provides two methods:

### broadcastToPlan(planId, message, excludeUserId)

Sends message to all users who have joined the plan:

```javascript
// Send to all users in the plan
req.app.collaborationServer.broadcastToPlan(plan.id, message);

// Exclude the triggering user (not recommended for data sync)
req.app.collaborationServer.broadcastToPlan(plan.id, message, req.user.id);
```

**When to use:**
- Data synchronization events (CRUD operations)
- Plan-level notifications
- Most use cases

### broadcastToNode(nodeId, planId, message, excludeUserId)

Sends message only to users currently viewing a specific node:

```javascript
// Send to users viewing this node
req.app.collaborationServer.broadcastToNode(node.id, plan.id, message);
```

**When to use:**
- Node-specific real-time updates
- Typing indicators (already implemented)
- Node viewer notifications

## Error Handling

### Pattern: Only Broadcast on Success

```javascript
async function updatePlan(req, res) {
  try {
    const { data: plan, error } = await supabase
      .from('plans')
      .update(req.body)
      .eq('id', req.params.id)
      .select()
      .single();

    // Only broadcast if database operation succeeded
    if (!error) {
      const message = createPlanUpdatedMessage(plan, req.user.id, req.user.name);
      req.app.collaborationServer.broadcastToPlan(plan.id, message);
      return res.json(plan);
    } else {
      return res.status(400).json({ error: error.message });
    }

  } catch (error) {
    // No broadcast on exception
    return res.status(500).json({ error: 'Internal server error' });
  }
}
```

### Pattern: Transaction Safety

For operations requiring transactions:

```javascript
async function moveNodeWithTransaction(req, res) {
  const { plan_id, node_id } = req.params;
  let success = false;
  let updatedNode = null;

  try {
    // Begin transaction (pseudo-code, Supabase doesn't support explicit transactions via API)
    updatedNode = await updateNodePosition(node_id, req.body);
    success = true;
  } catch (error) {
    // Rollback would happen here
    return res.status(500).json({ error: 'Failed to move node' });
  }

  // Only broadcast if transaction committed
  if (success) {
    const message = createNodeMovedMessage(
      node_id,
      plan_id,
      { /* move data */ },
      req.user.id,
      req.user.name
    );
    req.app.collaborationServer.broadcastToPlan(plan_id, message);
  }

  return res.json(updatedNode);
}
```

## User Information

### Getting User Name

Controllers should include user name when available:

```javascript
// Option 1: From JWT payload (if included)
const userName = req.user.name || req.user.email;

// Option 2: Query database
const { data: user } = await supabase
  .from('users')
  .select('name, email')
  .eq('id', req.user.id)
  .single();
const userName = user.name || user.email;

// Option 3: Pass null (schema allows optional)
const message = createNodeCreatedMessage(node, req.user.id, null);
```

### Best Practice: Middleware

Add user info to request object:

```javascript
// middleware/user-info.middleware.js
async function attachUserInfo(req, res, next) {
  if (req.user && req.user.id) {
    const { data: user } = await supabase
      .from('users')
      .select('name, email')
      .eq('id', req.user.id)
      .single();

    req.user.name = user.name;
    req.user.email = user.email;
  }
  next();
}

// In routes
router.post('/', authenticate, attachUserInfo, planController.createPlan);
```

## Testing

### Unit Testing Factory Functions

```javascript
// tests/unit/message-schema.test.js
const {
  createPlanCreatedMessage,
  PLAN_EVENTS
} = require('../../src/websocket/message-schema');

describe('Message Schema', () => {
  test('createPlanCreatedMessage generates correct structure', () => {
    const mockPlan = {
      id: 'test-plan-id',
      title: 'Test Plan',
      description: 'Test Description',
      status: 'draft',
      owner_id: 'user-123',
      created_at: new Date().toISOString(),
      metadata: {}
    };

    const message = createPlanCreatedMessage(mockPlan, 'user-123', 'Test User');

    expect(message.type).toBe(PLAN_EVENTS.CREATED);
    expect(message.payload.id).toBe(mockPlan.id);
    expect(message.metadata.userId).toBe('user-123');
    expect(message.metadata.userName).toBe('Test User');
    expect(message.metadata.planId).toBe(mockPlan.id);
    expect(message.metadata.version).toBe('1.0.0');
  });
});
```

### Integration Testing with WebSocket

```javascript
// tests/integration/plan-websocket.test.js
const request = require('supertest');
const WebSocket = require('ws');
const app = require('../../src/index');

describe('Plan WebSocket Integration', () => {
  let ws;
  let authToken;

  beforeAll(async () => {
    // Setup auth
    authToken = await getTestAuthToken();

    // Connect WebSocket
    ws = new WebSocket(`ws://localhost:3000/ws/collaborate?token=${authToken}`);
    await waitForOpen(ws);
  });

  test('creates plan and broadcasts message', (done) => {
    // Listen for WebSocket message
    ws.on('message', (data) => {
      const message = JSON.parse(data);
      if (message.type === 'plan.created') {
        expect(message.payload.title).toBe('Test Plan');
        expect(message.metadata.version).toBe('1.0.0');
        done();
      }
    });

    // Create plan via REST API
    request(app)
      .post('/plans')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ title: 'Test Plan', status: 'draft' })
      .expect(201);
  });
});
```

## Migration Checklist

To integrate the schema into existing controllers:

- [ ] Import the required factory functions from `../websocket/message-schema`
- [ ] Ensure `req.user.id` and optionally `req.user.name` are available
- [ ] Add broadcast calls after successful database operations
- [ ] Use specific events (e.g., `status_changed`) when appropriate
- [ ] Handle errors - only broadcast on success
- [ ] Test with WebSocket client to verify messages are received
- [ ] Update frontend to handle new event types
- [ ] Add JSDoc comments referencing the schema version

## Next Steps

1. **Update Controllers**: Add WebSocket broadcasts to all CRUD operations
2. **Update Frontend**: Handle new event types in WebSocket client
3. **Add Middleware**: Create middleware to attach user info to requests
4. **Add Tests**: Write integration tests for WebSocket events
5. **Monitor Performance**: Track message frequency and payload sizes
6. **Add Logging**: Log WebSocket events for debugging

## Reference

- **Schema File**: `/src/websocket/message-schema.js`
- **Examples**: `/src/websocket/MESSAGE_SCHEMA_EXAMPLES.md`
- **WebSocket Server**: `/src/websocket/collaboration.js`
- **Schema Version**: 1.0.0
