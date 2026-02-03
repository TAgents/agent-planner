# AgentPlanner + OpenClaw Integration Guide

Best practices for integrating AgentPlanner with OpenClaw AI agents.

## Overview

AgentPlanner provides two ways for OpenClaw agents to interact:

1. **MCP Tools** - Agents use Model Context Protocol tools to read/write plans
2. **Webhook Notifications** - AgentPlanner pushes events to agents

```
┌─────────────────┐                    ┌─────────────────┐
│    OpenClaw     │◄──── Webhooks ────│  AgentPlanner   │
│     Agent       │                    │      API        │
│                 │──── MCP Tools ────►│                 │
└─────────────────┘                    └─────────────────┘
```

---

## 1. MCP Integration

### Setup

Add AgentPlanner MCP server to your OpenClaw agent:

```yaml
# openclaw.yaml or claude_desktop_config.json
mcpServers:
  planning-system:
    command: npx
    args: ["-y", "agent-planner-mcp"]
    env:
      API_URL: https://api.agentplanner.io
      USER_API_TOKEN: your_token_here
```

### Available Tools

| Tool | Description |
|------|-------------|
| `search` | Search plans and nodes |
| `list_plans` | List user's plans |
| `create_plan` | Create a new plan |
| `update_plan` | Update plan metadata |
| `delete_plan` | Archive or delete a plan |
| `share_plan` | Make plan public/private |
| `create_node` | Add task/phase/milestone |
| `update_node` | Update node status, title, etc. |
| `delete_node` | Remove a node |
| `move_node` | Reorder or reparent nodes |
| `add_log` | Add progress log to a node |
| `get_logs` | Get logs for a node |
| `add_task_reference` | Link PR, issue, or URL to task |
| `list_task_references` | Get references for a task |
| `batch_update_nodes` | Update multiple nodes at once |
| `get_plan_summary` | Get compact plan overview |
| `get_plan_structure` | Get full plan tree |

### Example Agent Prompts

**Creating a plan:**
```
Create a plan for "Build REST API" with phases for design, implementation, and testing.
Add tasks to implementation: set up Express server, add authentication, create database models.
```

**Checking progress:**
```
What's the status of my "Website Redesign" plan? Show me blocked tasks.
```

**Updating tasks:**
```
Mark the "Set up Express server" task as completed and add a log entry saying "Server running on port 3000".
```

---

## 2. Webhook Notifications

### Setup

1. Go to AgentPlanner **Settings → Notifications**
2. Enter your OpenClaw webhook URL
3. Select which events to receive
4. Enable notifications

### OpenClaw Webhook Config

Add a webhook handler to receive AgentPlanner events:

```yaml
# openclaw.yaml
webhooks:
  agentplanner:
    path: /webhook/agentplanner
    inject: session  # Injects as system message to agent
```

### Event Types

| Event | When | Message Example |
|-------|------|-----------------|
| `task.blocked` | Task status → blocked | 🚫 Task 'Rate Limiting' is now blocked |
| `task.assigned` | Task assigned to user | 📋 You were assigned 'API Design' |
| `task.completed` | Task marked done | ✅ Task 'Unit Tests' completed |
| `task.unblocked` | Blocker resolved | ✨ Task 'Rate Limiting' is no longer blocked |
| `plan.shared` | Visibility changed | 🔗 Plan 'Roadmap' is now public |

### Webhook Payload

```json
{
  "event": "task.blocked",
  "timestamp": "2026-02-03T10:00:00Z",
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

The `message` field is pre-formatted - agents can use it directly in responses.

---

## 3. Best Practices

### For Planning Agents

1. **Use `get_plan_summary`** for context - it's more token-efficient than full structure
2. **Batch updates** when possible - use `batch_update_nodes` for multiple changes
3. **Add meaningful logs** - helps track progress and provides context for other agents
4. **Link references** - connect tasks to PRs, issues, and docs for traceability

### For Monitoring Agents

1. **Subscribe to `task.blocked`** - these need attention
2. **Use webhooks over polling** - more efficient, real-time updates
3. **Check context in payload** - plan/task titles help understand the issue

### For Executor Agents

1. **Update status as you work** - `not_started` → `in_progress` → `completed`
2. **Add logs for each significant step** - creates audit trail
3. **Link PRs and commits** - use `add_task_reference` with GitHub URLs
4. **Mark blockers explicitly** - status `blocked` triggers notifications

---

## 4. Example Workflows

### Autonomous Task Execution

```
Agent receives: "Execute the 'API Design' task in my Backend API plan"

1. get_plan_summary("Backend API") → understand context
2. update_node(task_id, {status: "in_progress"})
3. ... agent does the work ...
4. add_log(task_id, "Created OpenAPI spec with 15 endpoints")
5. add_task_reference(task_id, {url: "...", ref_type: "document"})
6. update_node(task_id, {status: "completed"})
```

### Reactive Notification Handling

```
Webhook received: task.blocked for "Database Migration"

1. Agent sees: "🚫 Task 'Database Migration' is blocked"
2. get_node_context(task_id) → understand what's blocking
3. Agent investigates/helps resolve
4. update_node(task_id, {status: "in_progress"})
5. Sends response to user about resolution
```

### Daily Standup Report

```
Agent (on schedule): "Generate standup report for Project X"

1. get_plan_summary("Project X")
2. search({plan_id, status: "completed", since: "yesterday"})
3. search({plan_id, status: "in_progress"})
4. search({plan_id, status: "blocked"})
5. Format and send summary
```

---

## 5. API Reference

### Webhook Settings API

```bash
# Get current settings
GET /webhooks/settings
Authorization: Bearer <token>

# Update settings
PUT /webhooks/settings
{
  "url": "https://gateway.openclaw.ai/webhook/abc123",
  "events": ["task.blocked", "task.assigned"],
  "enabled": true
}

# Test webhook
POST /webhooks/test

# View delivery history
GET /webhooks/history?limit=20
```

### MCP Tool Examples

```javascript
// Search for blocked tasks
{
  "tool": "search",
  "params": {
    "query": "blocked",
    "plan_id": "uuid"
  }
}

// Batch update multiple tasks
{
  "tool": "batch_update_nodes",
  "params": {
    "plan_id": "uuid",
    "updates": [
      {"node_id": "uuid1", "status": "completed"},
      {"node_id": "uuid2", "status": "in_progress"}
    ]
  }
}

// Add GitHub PR reference
{
  "tool": "add_task_reference",
  "params": {
    "plan_id": "uuid",
    "node_id": "uuid",
    "title": "PR #42: Add authentication",
    "url": "https://github.com/org/repo/pull/42",
    "ref_type": "github_pr",
    "status": "merged"
  }
}
```

---

## 6. Troubleshooting

### Webhooks not receiving events

1. Check webhook URL is accessible from internet
2. Verify `webhook_enabled` is `true` in settings
3. Confirm event type is in your `webhook_events` array
4. Check `/webhooks/history` for delivery attempts

### MCP tools not working

1. Verify `USER_API_TOKEN` is set correctly
2. Check token has required permissions (read/write)
3. Ensure `API_URL` points to correct server

### Rate limiting

- API: 1000 requests/hour per user
- Webhooks: Events are sent immediately, no batching (MVP)

---

## Resources

- [AgentPlanner MCP Server](https://github.com/tagents/agent-planner-mcp)
- [OpenClaw Documentation](https://docs.openclaw.ai)
- [Model Context Protocol](https://modelcontextprotocol.io)
