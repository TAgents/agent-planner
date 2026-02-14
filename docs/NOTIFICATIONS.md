# AgentPlanner Webhook Notifications

> **⚠️ DEPRECATED (pre-v2 cleanup):** Webhook notifications have been removed in favor of polling-based integration. This document is retained for historical reference only. See the polling approach in `OPENCLAW_INTEGRATION.md`.

Webhook notifications that integrate with AI agents like OpenClaw. One webhook URL per user, structured payloads.

---

## User Flow

1. User goes to **Settings → Notifications**
2. Enters webhook URL: `https://your-gateway/hooks/agentplanner`
3. Selects which events to receive (checkboxes)
4. Done ✓

---

## API Endpoints

```bash
# Get available event types
GET /webhooks/events
Authorization: Bearer <token>

# Get current settings
GET /webhooks/settings
Authorization: Bearer <token>

# Update settings
PUT /webhooks/settings
Authorization: Bearer <token>
Content-Type: application/json

{
  "url": "https://your-gateway/hooks/agentplanner",
  "events": ["task.blocked", "task.start_requested", "decision.requested.blocking"],
  "enabled": true
}

# Test webhook delivery
POST /webhooks/test
Authorization: Bearer <token>

# View delivery history
GET /webhooks/history?limit=20
Authorization: Bearer <token>
```

---

## Event Types

### Task Events

| Event | When | Default |
|-------|------|---------|
| `task.blocked` | Task status changed to blocked | ✅ On |
| `task.unblocked` | Task status changed from blocked | ❌ Off |
| `task.completed` | Task marked complete | ❌ Off |
| `task.assigned` | Task assigned to user | ✅ On |

### Agent Request Events

| Event | When | Default |
|-------|------|---------|
| `task.start_requested` | Human requests agent to START a task | ✅ On |
| `task.review_requested` | Human requests agent to REVIEW work | ✅ On |
| `task.help_requested` | Human requests agent assistance | ✅ On |
| `task.continue_requested` | Human requests agent to CONTINUE work | ✅ On |
| `task.agent_requested` | Generic agent request (fallback) | ✅ On |

### Decision Events

| Event | When | Default |
|-------|------|---------|
| `decision.requested` | Decision needed from human | ✅ On |
| `decision.requested.blocking` | URGENT: Agent blocked waiting for decision | ✅ On |
| `decision.resolved` | Decision was made | ❌ Off |

### Plan Events

| Event | When | Default |
|-------|------|---------|
| `plan.shared` | Plan visibility changed | ❌ Off |

---

## Webhook Payload Schemas

### Task Events

```json
{
  "event": "task.blocked",
  "timestamp": "2026-02-06T10:00:00Z",
  "plan": {
    "id": "plan-uuid",
    "title": "Project Roadmap"
  },
  "task": {
    "id": "task-uuid",
    "title": "Implement Authentication",
    "status": "blocked"
  },
  "actor": {
    "name": "John Doe",
    "type": "user"
  },
  "message": "🚫 Task 'Implement Authentication' is now blocked in plan 'Project Roadmap'"
}
```

### Agent Request Events

```json
{
  "event": "task.start_requested",
  "timestamp": "2026-02-06T10:00:00Z",
  "plan": {
    "id": "plan-uuid",
    "title": "Project Roadmap"
  },
  "task": {
    "id": "task-uuid",
    "title": "Setup React Project",
    "description": "Initialize the project with React 18 and TypeScript",
    "node_type": "task",
    "status": "not_started",
    "agent_instructions": "Use Vite as the build tool. Configure ESLint and Prettier.",
    "context": "This is part of the frontend development phase"
  },
  "request": {
    "type": "start",
    "message": "Please begin working on this task. Use TypeScript strict mode.",
    "requested_at": "2026-02-06T10:00:00Z",
    "requested_by": "John Doe"
  },
  "actor": {
    "name": "John Doe",
    "type": "user"
  },
  "message": "🚀 Agent requested to START task 'Setup React Project' in plan 'Project Roadmap'"
}
```

### Decision Events

```json
{
  "event": "decision.requested.blocking",
  "timestamp": "2026-02-06T10:00:00Z",
  "plan": {
    "id": "plan-uuid",
    "title": "Project Roadmap"
  },
  "decision": {
    "id": "decision-uuid",
    "title": "Which database to use?",
    "context": "We need to store user data and sessions. Expected 10k users initially.",
    "options": [
      {"option": "PostgreSQL", "pros": "ACID, mature ecosystem", "cons": "More complex setup"},
      {"option": "MongoDB", "pros": "Flexible schema", "cons": "Less consistency guarantees"}
    ],
    "urgency": "blocking",
    "status": "pending",
    "node_id": "task-uuid"
  },
  "actor": {
    "name": "AI Agent",
    "type": "agent",
    "agent_name": "Planner"
  },
  "message": "🚨 URGENT: Decision needed: 'Which database to use?' in plan 'Project Roadmap' - Agent is blocked!"
}
```

For resolved decisions:
```json
{
  "event": "decision.resolved",
  "resolution": {
    "decision": "We will use PostgreSQL",
    "rationale": "ACID compliance is critical for financial data",
    "decided_at": "2026-02-06T11:00:00Z"
  }
}
```

---

## Database Schema

User webhook settings are stored in the `users` table:

```sql
ALTER TABLE users ADD COLUMN webhook_url TEXT;
ALTER TABLE users ADD COLUMN webhook_events TEXT[] DEFAULT '{"task.blocked", "task.assigned", "task.start_requested", "decision.requested.blocking"}';
ALTER TABLE users ADD COLUMN webhook_enabled BOOLEAN DEFAULT false;
```

Delivery tracking in `webhook_deliveries`:

```sql
CREATE TABLE webhook_deliveries (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id),
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL,
  status TEXT NOT NULL,  -- 'success', 'failed'
  status_code INTEGER,
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  delivered_at TIMESTAMPTZ
);
```

---

## Authentication

Webhooks can authenticate with the receiving server using:

1. **Authorization header** (recommended):
   ```
   Authorization: Bearer your-secret-token
   ```

2. **Custom header**:
   ```
   X-OpenClaw-Token: your-secret-token
   ```

3. **Query parameter** (deprecated):
   ```
   https://gateway/hooks/agentplanner?token=your-secret-token
   ```

---

## Delivery

- Webhooks are sent immediately when events occur
- Timeout: 5 seconds
- No automatic retries (check delivery history for failures)
- Payload size limit: 100KB

---

## OpenClaw Integration

See [OPENCLAW_INTEGRATION.md](./OPENCLAW_INTEGRATION.md) for complete setup guide.

Quick config for `~/.openclaw/openclaw.json`:

```json5
{
  hooks: {
    enabled: true,
    token: "your-secret",
    mappings: [{
      match: { path: "agentplanner" },
      action: "agent",
      sessionKey: "hook:agentplanner:{{task.id}}",
      messageTemplate: "{{message}}\n\n**Task:** {{task.title}}\n**Plan:** {{plan.title}}",
      deliver: true,
      channel: "slack",
      to: "#your-channel"
    }]
  }
}
```

---

## Testing

Use the test endpoint to verify your webhook setup:

```bash
curl -X POST "https://api.agentplanner.io/webhooks/test" \
  -H "Authorization: Bearer $AGENTPLANNER_TOKEN"
```

This sends a test payload to your configured webhook URL.

---

## Troubleshooting

### Webhooks not receiving events

1. Check `GET /webhooks/settings` - is `enabled: true`?
2. Verify the event type is in your `events` array
3. Check `GET /webhooks/history` for delivery attempts
4. Ensure webhook URL is publicly accessible

### Common errors

| Status | Meaning |
|--------|---------|
| 401 | Auth token missing or invalid |
| 404 | Webhook URL not found |
| 408 | Request timeout (>5s) |
| 5xx | Server error at webhook receiver |
