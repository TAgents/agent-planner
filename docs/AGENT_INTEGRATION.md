# AgentPlanner — AI Agent Integration Guide

How AI agents (OpenClaw, Claude, custom agents) integrate with AgentPlanner.

## Architecture

Agents run **locally on users' machines** — behind firewalls, NAT, dynamic IPs. The server cannot call them directly. Instead, all communication flows through **messaging platforms** and the **MCP protocol**.

```
Human                         Server                        Agent (local)
  │                             │                              │
  │  "Agent, start task X"      │                              │
  │──── Slack/Discord ─────────►│                              │
  │                             │── notify via messageBus ──►  │
  │                             │   (Postgres LISTEN/NOTIFY)   │
  │                             │                              │
  │                             │   Slack/Discord/Teams/etc    │
  │                             │──────── message ───────────►│
  │                             │                              │
  │                             │◄──── MCP: get_context ──────│
  │                             │◄──── MCP: update_task ──────│
  │                             │◄──── MCP: add_log ──────────│
  │                             │                              │
  │                             │   Slack/Discord/Teams/etc    │
  │                             │◄──────── "Done!" ───────────│
  │◄─── Slack/Discord ─────────│                              │
```

### Key Principles

1. **Server never calls agents directly** — agents are behind firewalls
2. **Messaging platforms are the transport** — Slack, Discord, Teams, Telegram, WhatsApp, email
3. **MCP is the agent's API** — agents use MCP tools to read/update plans
4. **PostgreSQL LISTEN/NOTIFY is the internal bus** — all events flow through it, adapters fan out to platforms

---

## Messaging Architecture

All notifications flow through the **messageBus** (PostgreSQL LISTEN/NOTIFY), which fans out to configured adapters:

```
Event (e.g. task.start_requested)
  │
  ▼
messageBus.publish('notifications', payload)
  │
  ▼
Adapter Registry (fan-out)
  ├── SlackAdapter     → Slack Bot API
  ├── WebhookAdapter   → HTTP POST to configured URL
  ├── ConsoleAdapter   → stdout (dev only)
  └── [future adapters: Discord, Teams, Telegram, WhatsApp, Email]
```

### Adding a New Messaging Adapter

Create a new adapter in `src/adapters/` extending `BaseAdapter`:

```javascript
const { BaseAdapter } = require('./base.adapter');

class DiscordAdapter extends BaseAdapter {
  constructor() { super('discord'); }

  async isConfigured(userId) {
    // Check if user has Discord integration configured
  }

  async deliver(payload) {
    // Send message to Discord channel
    // payload: { event, plan, task, request, actor, message, userId }
  }
}
```

Register it in `src/adapters/index.js`:

```javascript
const adapters = [
  new WebhookAdapter(),
  new SlackAdapter(),
  new DiscordAdapter(),  // add here
  new ConsoleAdapter(),
];
```

### Supported Events

| Event | Description | When |
|-------|-------------|------|
| `task.start_requested` | Human wants agent to start a task | User clicks "Request Agent" |
| `task.review_requested` | Human wants agent to review work | User requests review |
| `task.help_requested` | Human wants agent assistance | User asks for help |
| `task.continue_requested` | Human wants agent to continue | User resumes paused work |
| `task.blocked` | Task became blocked | Status changed to blocked |
| `task.completed` | Task marked complete | Status changed to completed |
| `task.status_changed` | Any status change | Status transitions |
| `decision.requested` | Decision needed from human | Agent creates decision |
| `decision.requested.blocking` | Urgent: agent blocked on decision | Blocking decision created |
| `decision.resolved` | Decision was made | Human resolves decision |

---

## Agent Integration Methods

### 1. MCP Tools (Recommended)

The MCP server exposes all planning tools. Agents connect via stdio (local) or HTTP/SSE (remote).

**Setup (local agent):**
```json5
// Agent MCP config (e.g. ~/.openclaw/openclaw.json or claude_desktop_config.json)
{
  "mcpServers": {
    "agentplanner": {
      "command": "npx",
      "args": ["-y", "agent-planner-mcp"],
      "env": {
        "API_URL": "https://agentplanner.io/api",
        "USER_API_TOKEN": "your-token-here"
      }
    }
  }
}
```

**Available Tools:**

| Tool | Description |
|------|-------------|
| `search` | Search plans and nodes |
| `list_plans` | List user's plans |
| `get_plan_structure` | Get full plan tree |
| `get_plan_summary` | Get compact plan overview |
| `get_agent_context` | Get focused context for a task (leaf-up) |
| `create_node` | Add task/phase/milestone |
| `update_node` | Update node status, title, etc. |
| `batch_update_nodes` | Update multiple nodes at once |
| `add_log` | Add progress log to a node |
| `get_logs` | Get logs for a node |

### 2. REST API (Simple)

Direct API calls for agents that don't support MCP.

```bash
# Get task context
curl -s "https://agentplanner.io/api/plans/{plan_id}/nodes/{node_id}" \
  -H "Authorization: Bearer $TOKEN"

# Update task status
curl -X PUT "https://agentplanner.io/api/plans/{plan_id}/nodes/{node_id}" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"status": "in_progress"}'

# Log progress
curl -X POST "https://agentplanner.io/api/plans/{plan_id}/nodes/{node_id}/log" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"content": "Implemented auth endpoints", "log_type": "progress"}'
```

### 3. Polling (Firewall-Friendly)

Agents poll for pending requests — no inbound connections needed.

```bash
GET /api/users/my-tasks?requested=true
Authorization: Bearer <token>
```

Returns tasks where a human has requested agent assistance:

```json
{
  "tasks": [{
    "id": "task-uuid",
    "title": "Setup React project",
    "status": "not_started",
    "plan_id": "plan-uuid",
    "plan_title": "Website Redesign",
    "agent_request": {
      "type": "start",
      "message": "Please start working on this task",
      "requested_at": "2026-02-17T10:00:00Z"
    }
  }]
}
```

---

## Typical Workflow

### Task Execution via Slack

```
1. Human in Slack: "@agent please start task 'Setup Auth' in plan 'Backend'"
2. SlackAdapter receives message, publishes to messageBus
3. Agent (running locally) picks up message from Slack
4. Agent uses MCP tools:
   - get_agent_context(nodeId) → reads task details, plan context, knowledge
   - update_node(status: "in_progress")
   - [does the actual work]
   - add_log("Implemented JWT auth with refresh tokens")
   - update_node(status: "completed")
5. Agent posts to Slack: "Done! Implemented JWT auth with refresh tokens."
```

### Decision Flow

```
1. Agent working on task, hits choice point
2. Agent creates decision request via MCP:
   - title: "PostgreSQL vs MongoDB?"
   - options: [{option: "PostgreSQL", pros: "..."}, {option: "MongoDB", pros: "..."}]
   - urgency: "blocking"
3. messageBus publishes decision.requested.blocking
4. SlackAdapter sends urgent notification to human
5. Human resolves decision in UI or Slack
6. decision.resolved event fires
7. Agent picks up resolution, continues work
```

---

## Agent Request Types

| Type | When to Use |
|------|-------------|
| `start` | Begin working on a new task |
| `review` | Review completed work or deliverable |
| `help` | Get assistance or guidance |
| `continue` | Resume work on a paused task |

### Request Agent Assistance (API)

```bash
# Request agent to start a task
curl -X POST "https://agentplanner.io/api/plans/{plan_id}/nodes/{node_id}/request-agent" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"request_type": "start", "message": "Please implement this"}'

# Clear the request
curl -X DELETE "https://agentplanner.io/api/plans/{plan_id}/nodes/{node_id}/request-agent" \
  -H "Authorization: Bearer $TOKEN"
```

---

## Best Practices

### For Agents
1. **Read context first** — use `get_agent_context` before acting
2. **Update status early** — mark `in_progress` when starting
3. **Log as you go** — add progress logs frequently
4. **Mark blockers** — set status to `blocked` when stuck
5. **Request decisions** — don't guess on important choices

### For Platform Adapters
1. **Use messageBus** — subscribe to `notifications` channel for all events
2. **Keep adapters stateless** — configuration comes from DB per-user
3. **Handle failures gracefully** — adapter errors shouldn't block other adapters
4. **Format for the platform** — Slack blocks, Discord embeds, plain text for email

---

## Resources

- **AgentPlanner App**: https://www.agentplanner.io
- **API Documentation**: https://agentplanner.io/api/api-docs/
- **MCP Package**: https://github.com/TAgents/agent-planner-mcp
- **GitHub**: https://github.com/TAgents
