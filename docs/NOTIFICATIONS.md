# AgentPlanner Notifications - Simple Design

## Overview

Webhook notifications that integrate with OpenClaw agents. One webhook URL per user, simple payloads, minimal config.

---

## User Flow

1. User goes to **Settings → Notifications**
2. Enters webhook URL: `https://gateway.openclaw.ai/webhook/abc123`
3. Selects which events to receive (checkboxes)
4. Done ✓

---

## Events (Keep it minimal)

| Event | When | Why it matters |
|-------|------|----------------|
| `task.blocked` | Task status → blocked | Needs attention |
| `task.assigned` | Task assigned to user | Work to do |
| `task.completed` | Task marked done | Progress update |
| `plan.shared` | Plan visibility changed | Collaboration |

---

## Webhook Payload

```json
{
  "event": "task.blocked",
  "timestamp": "2026-02-02T00:45:00Z",
  "plan": {
    "id": "uuid",
    "title": "AgentPlanner Roadmap"
  },
  "task": {
    "id": "uuid", 
    "title": "Implement Rate Limiting",
    "status": "blocked"
  },
  "actor": {
    "name": "Feynman",
    "type": "agent"
  },
  "message": "🚫 Task 'Implement Rate Limiting' is now blocked in plan 'AgentPlanner Roadmap'"
}
```

The `message` field is pre-formatted for easy display - agents can use it directly.

---

## Database

Add to `users` table:
```sql
ALTER TABLE users ADD COLUMN webhook_url TEXT;
ALTER TABLE users ADD COLUMN webhook_events TEXT[] DEFAULT '{"task.blocked", "task.assigned"}';
ALTER TABLE users ADD COLUMN webhook_enabled BOOLEAN DEFAULT false;
```

---

## API

### Update webhook settings
```
PUT /api/user/webhook
{
  "url": "https://gateway.openclaw.ai/webhook/abc123",
  "events": ["task.blocked", "task.assigned", "task.completed"],
  "enabled": true
}
```

### Get current settings
```
GET /api/user/webhook
```

---

## Backend Implementation

```javascript
// services/notifications.js

const EVENTS = {
  'task.blocked': (node, plan, actor) => ({
    message: `🚫 Task '${node.title}' is now blocked in plan '${plan.title}'`
  }),
  'task.assigned': (node, plan, actor) => ({
    message: `📋 You were assigned '${node.title}' in plan '${plan.title}'`
  }),
  'task.completed': (node, plan, actor) => ({
    message: `✅ Task '${node.title}' completed in plan '${plan.title}'`
  }),
  'plan.shared': (node, plan, actor) => ({
    message: `🔗 Plan '${plan.title}' is now ${plan.visibility}`
  })
};

async function sendNotification(eventType, { node, plan, actor, userId }) {
  const user = await getUser(userId);
  
  if (!user.webhook_enabled || !user.webhook_url) return;
  if (!user.webhook_events.includes(eventType)) return;
  
  const eventData = EVENTS[eventType](node, plan, actor);
  
  const payload = {
    event: eventType,
    timestamp: new Date().toISOString(),
    plan: { id: plan.id, title: plan.title },
    task: node ? { id: node.id, title: node.title, status: node.status } : null,
    actor: { name: actor.name, type: actor.type || 'user' },
    message: eventData.message
  };
  
  try {
    await fetch(user.webhook_url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      timeout: 5000
    });
  } catch (err) {
    console.error('Webhook delivery failed:', err.message);
    // Don't retry for MVP - just log it
  }
}
```

---

## Trigger Points

Add notification calls to existing endpoints:

```javascript
// In node controller - updateNode()
if (oldStatus !== newStatus) {
  if (newStatus === 'blocked') {
    await sendNotification('task.blocked', { node, plan, actor, userId: plan.owner_id });
  }
  if (newStatus === 'completed') {
    await sendNotification('task.completed', { node, plan, actor, userId: plan.owner_id });
  }
}

// In node controller - assignNode()
await sendNotification('task.assigned', { node, plan, actor, userId: assignee_id });

// In plan controller - updatePlan() 
if (oldVisibility !== newVisibility) {
  await sendNotification('plan.shared', { plan, actor, userId: plan.owner_id });
}
```

---

## UI (Settings Page)

```
┌─────────────────────────────────────────────────────┐
│ Notifications                                        │
├─────────────────────────────────────────────────────┤
│                                                      │
│ Webhook URL                                          │
│ ┌─────────────────────────────────────────────────┐ │
│ │ https://gateway.openclaw.ai/webhook/abc123      │ │
│ └─────────────────────────────────────────────────┘ │
│                                                      │
│ Events to receive:                                   │
│ ☑ Task blocked                                       │
│ ☑ Task assigned to me                                │
│ ☐ Task completed                                     │
│ ☐ Plan sharing changed                               │
│                                                      │
│ ┌──────────────────┐                                 │
│ │ ● Enabled        │  [Test Webhook] [Save]          │
│ └──────────────────┘                                 │
│                                                      │
└─────────────────────────────────────────────────────┘
```

---

## OpenClaw Integration

In OpenClaw config, user adds a webhook channel:

```yaml
# openclaw.yaml
webhooks:
  agentplanner:
    path: /webhook/agentplanner
    inject: session  # Injects as system message
```

When AgentPlanner sends `task.blocked`, agent sees:
```
🚫 Task 'Implement Rate Limiting' is now blocked in plan 'AgentPlanner Roadmap'
```

Agent can then respond naturally, use MCP tools to investigate, etc.

---

## Files to Create/Modify

### Backend (agent-planner)
- [ ] `src/services/notifications.js` - Core notification logic
- [ ] `src/routes/webhook.js` - API endpoints  
- [ ] `src/controllers/nodeController.js` - Add trigger points
- [ ] `src/controllers/planController.js` - Add trigger points
- [ ] Migration for user webhook columns

### Frontend (agent-planner-ui)
- [ ] `src/pages/Settings.tsx` - Add Notifications section
- [ ] `src/services/webhookService.ts` - API calls

---

## Future (Not MVP)

- Webhook signing (HMAC)
- Retry with backoff
- Event log/history
- Team notifications (notify all collaborators)
- More event types (comments, logs, deadlines)
