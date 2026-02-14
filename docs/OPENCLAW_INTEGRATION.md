# AgentPlanner + OpenClaw Integration Guide

Complete guide for integrating AgentPlanner with OpenClaw AI agents.

## Overview

AgentPlanner provides multiple ways for OpenClaw agents to interact:

1. **REST API** - Direct API calls via curl (simplest)
2. **MCP Tools** - Model Context Protocol tools for richer integration
3. **Polling** - Agent periodically checks for pending requests (no webhook URL needed)
4. **~~Webhook Notifications~~** - ⚠️ Removed in pre-v2 cleanup. Use polling instead.

```
┌─────────────────┐                    ┌─────────────────┐
│    OpenClaw     │◄──── Webhooks ────│  AgentPlanner   │
│     Agent       │──── Polling ─────►│      API        │
│                 │───── REST API ───►│                 │
│                 │───── MCP Tools ──►│                 │
└─────────────────┘                    └─────────────────┘
```

---

## 1. REST API Integration (Recommended Start)

The simplest integration - use curl from OpenClaw's exec tool.

### Setup

Add token to OpenClaw config:

```json5
// ~/.openclaw/openclaw.json
{
  env: {
    vars: {
      AGENTPLANNER_TOKEN: "your-api-token-here"
    }
  }
}
```

### Essential Commands

```bash
# List plans
curl -s "https://api.agentplanner.io/plans" \
  -H "Authorization: Bearer $AGENTPLANNER_TOKEN"

# Get plan structure
curl -s "https://api.agentplanner.io/plans/{plan_id}/nodes" \
  -H "Authorization: Bearer $AGENTPLANNER_TOKEN"

# Update task status
curl -X PUT "https://api.agentplanner.io/plans/{plan_id}/nodes/{node_id}" \
  -H "Authorization: Bearer $AGENTPLANNER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"status": "in_progress"}'

# Log progress
curl -X POST "https://api.agentplanner.io/plans/{plan_id}/nodes/{node_id}/log" \
  -H "Authorization: Bearer $AGENTPLANNER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"content": "Completed the implementation", "log_type": "progress"}'
```

See the [API documentation](https://api.agentplanner.io/api-docs/) for all endpoints.

---

## 2. MCP Integration

For richer tool-based integration.

### Setup

Add AgentPlanner MCP server to OpenClaw:

```json5
// ~/.openclaw/openclaw.json
{
  mcp: {
    servers: {
      agentplanner: {
        command: "npx",
        args: ["-y", "agent-planner-mcp"],
        env: {
          API_URL: "https://api.agentplanner.io",
          USER_API_TOKEN: "your-token-here"
        }
      }
    }
  }
}
```

### Available Tools

| Tool | Description |
|------|-------------|
| `search` | Search plans and nodes |
| `list_plans` | List user's plans |
| `create_plan` | Create a new plan |
| `update_plan` | Update plan metadata |
| `create_node` | Add task/phase/milestone |
| `update_node` | Update node status, title, etc. |
| `add_log` | Add progress log to a node |
| `get_logs` | Get logs for a node |
| `batch_update_nodes` | Update multiple nodes at once |
| `get_plan_summary` | Get compact plan overview |
| `get_plan_structure` | Get full plan tree |

---

## 3. Polling for Agent Requests (No Webhook URL Needed)

Poll for pending agent requests using OpenClaw's heartbeat or cron system. This is simpler than webhooks because it doesn't require a public URL.

### Endpoint

```bash
GET /users/my-tasks?requested=true
Authorization: Bearer <token>
```

Returns tasks where a human has requested agent assistance:

```json
{
  "tasks": [{
    "id": "task-uuid",
    "title": "Setup React project",
    "description": "Initialize React with TypeScript",
    "status": "not_started",
    "plan_id": "plan-uuid",
    "plan_title": "Website Redesign",
    "agent_request": {
      "type": "start",
      "message": "Please start working on this task...",
      "requested_at": "2026-02-06T17:21:47.059Z",
      "requested_by": "user-uuid"
    }
  }],
  "total": 1
}
```

### Setup with HEARTBEAT.md

Add to your OpenClaw `HEARTBEAT.md`:

```markdown
## AgentPlanner Polling
Check for pending agent requests:
1. Call `GET https://api.agentplanner.io/users/my-tasks?requested=true`
2. For each task with a pending request:
   - Read the task context and agent_request.message
   - Do the requested work (start/review/help/continue)
   - Log progress: `POST /plans/{plan_id}/nodes/{node_id}/log`
   - Update status if needed: `PUT /plans/{plan_id}/nodes/{node_id}`
   - Clear the request: `DELETE /plans/{plan_id}/nodes/{node_id}/request-agent`
```

### Setup with Cron Job

For more control over polling frequency:

```json5
// Poll every 5 minutes
{
  schedule: { kind: "every", everyMs: 300000 },
  payload: { 
    kind: "agentTurn",
    message: "Check AgentPlanner for pending agent requests. Call GET /users/my-tasks?requested=true and process any found."
  },
  sessionTarget: "isolated"
}
```

### Polling Workflow

```
1. Human clicks "Request Agent" in AgentPlanner UI
2. Sets agent_requested field on the task
3. OpenClaw polls /users/my-tasks?requested=true (via heartbeat/cron)
4. Agent finds pending request, processes the task
5. Agent clears request: DELETE /plans/{plan_id}/nodes/{node_id}/request-agent
6. Response delivered to chat
```

### Polling vs Webhooks

| Polling | Webhooks |
|---------|----------|
| ✅ No public URL needed | ❌ Requires public endpoint |
| ✅ Works behind firewalls/NAT | ❌ Needs port forwarding or tunnel |
| ✅ Agent controls frequency | ✅ Real-time notifications |
| ❌ Slight delay (poll interval) | ✅ Instant response |
| ✅ Simpler setup | ❌ More configuration |

**Recommendation:** Start with polling. Switch to webhooks if you need real-time response.

---

## 4. Webhook Notifications (Real-Time)

> **⚠️ DEPRECATED:** Webhook notifications have been removed in the pre-v2 cleanup. Use polling (Section 3) instead. The content below is retained for historical reference.

AgentPlanner can push events to OpenClaw when things happen.

### Configure Webhook in AgentPlanner

```bash
curl -X PUT "https://api.agentplanner.io/webhooks/settings" \
  -H "Authorization: Bearer $AGENTPLANNER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://your-openclaw-host:18789/hooks/agentplanner",
    "enabled": true,
    "events": [
      "task.start_requested",
      "task.review_requested",
      "task.help_requested",
      "task.continue_requested",
      "task.blocked",
      "decision.requested",
      "decision.requested.blocking"
    ]
  }'
```

### Configure OpenClaw to Receive Webhooks

Add hooks configuration to `~/.openclaw/openclaw.json`:

```json5
{
  hooks: {
    enabled: true,
    token: "your-webhook-secret",
    path: "/hooks",
    mappings: [
      {
        match: { path: "agentplanner" },
        action: "agent",
        wakeMode: "now",
        name: "AgentPlanner",
        // Use task ID for session continuity
        sessionKey: "hook:agentplanner:{{task.id}}",
        // Format the message for the agent
        messageTemplate: "{{message}}\n\n**Task:** {{task.title}}\n**Status:** {{task.status}}\n**Plan:** {{plan.title}} (ID: {{plan.id}})\n\n{{#task.description}}**Description:** {{task.description}}\n{{/task.description}}{{#task.agent_instructions}}**Instructions:** {{task.agent_instructions}}\n{{/task.agent_instructions}}{{#request.message}}**Request Message:** {{request.message}}{{/request.message}}",
        deliver: true,
        channel: "slack",  // or telegram, discord, etc.
        to: "#your-channel"
      }
    ]
  }
}
```

### Authentication

Include the webhook token in your AgentPlanner webhook URL:

**Option 1: Header (recommended)**
Configure your webhook URL without token, then add header support in AgentPlanner (coming soon).

**Option 2: Query parameter (works now)**
```
https://your-host:18789/hooks/agentplanner?token=your-webhook-secret
```

### Event Types

| Event | Description | Payload includes |
|-------|-------------|------------------|
| `task.start_requested` | Human wants agent to START a task | task details, request message |
| `task.review_requested` | Human wants agent to REVIEW work | task details, request message |
| `task.help_requested` | Human wants agent assistance | task details, request message |
| `task.continue_requested` | Human wants agent to CONTINUE | task details, request message |
| `task.blocked` | Task became blocked | task details |
| `task.completed` | Task marked complete | task details |
| `decision.requested` | Decision needed from human | decision options |
| `decision.requested.blocking` | URGENT: Agent blocked on decision | decision options, urgency |

### Webhook Payload Example

```json
{
  "event": "task.start_requested",
  "timestamp": "2026-02-06T10:00:00Z",
  "plan": {
    "id": "plan-uuid",
    "title": "Website Redesign"
  },
  "task": {
    "id": "task-uuid",
    "title": "Setup React Project",
    "description": "Initialize React 18 with TypeScript",
    "status": "not_started",
    "agent_instructions": "Use Vite. Configure ESLint."
  },
  "request": {
    "type": "start",
    "message": "Please begin this task using TypeScript strict mode",
    "requested_at": "2026-02-06T10:00:00Z",
    "requested_by": "John"
  },
  "message": "🚀 Agent requested to START task 'Setup React Project' in plan 'Website Redesign'"
}
```

---

## 5. Agent Request System

Humans can explicitly request AI agent assistance on tasks.

### Request Agent Assistance

```bash
# Request agent to start a task
curl -X POST "https://api.agentplanner.io/plans/{plan_id}/nodes/{node_id}/request-agent" \
  -H "Authorization: Bearer $AGENTPLANNER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "request_type": "start",
    "message": "Please start working on this task"
  }'

# Clear the request
curl -X DELETE "https://api.agentplanner.io/plans/{plan_id}/nodes/{node_id}/request-agent" \
  -H "Authorization: Bearer $AGENTPLANNER_TOKEN"
```

### Request Types

| Type | When to Use |
|------|-------------|
| `start` | Begin working on a new task |
| `review` | Review completed work, code, or deliverable |
| `help` | Get assistance or guidance |
| `continue` | Resume work on a paused task |

### Workflow

1. Human clicks "Request Agent" in AgentPlanner UI
2. Selects request type and adds optional message
3. AgentPlanner sends webhook to OpenClaw
4. OpenClaw spawns agent session with task context
5. Agent reads task, does work, logs progress
6. Response delivered to configured channel

---

## 6. Decision Request System

Agents can request human decisions when they hit choice points.

### Create Decision Request

```bash
curl -X POST "https://api.agentplanner.io/plans/{plan_id}/decisions" \
  -H "Authorization: Bearer $AGENTPLANNER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "node_id": "task-uuid",
    "title": "Which framework should we use?",
    "context": "Need to choose a frontend framework for the project",
    "options": [
      {"option": "React", "pros": "Large ecosystem", "cons": "Learning curve"},
      {"option": "Vue", "pros": "Simpler API", "cons": "Smaller ecosystem"}
    ],
    "urgency": "blocking"
  }'
```

### Urgency Levels

| Level | Meaning |
|-------|---------|
| `low` | Can wait, not blocking |
| `normal` | Should address soon |
| `high` | Important, prioritize |
| `blocking` | Agent cannot continue |

When urgency is `blocking`, the `decision.requested.blocking` webhook fires.

### Resolve Decision

```bash
curl -X PUT "https://api.agentplanner.io/plans/{plan_id}/decisions/{decision_id}" \
  -H "Authorization: Bearer $AGENTPLANNER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "status": "resolved",
    "resolution": "We will use React for the larger ecosystem",
    "selected_option": 0
  }'
```

---

## 7. Best Practices

### For Planning Agents

1. **Check context first** - Always read plan structure before acting
2. **Update status early** - Mark `in_progress` when starting
3. **Log as you go** - Don't wait until the end
4. **Capture decisions** - Create knowledge entries for important choices

### For Execution Agents (receiving webhooks)

1. **Read full task context** - Use the task description and instructions
2. **Log progress frequently** - Add logs as you complete steps
3. **Mark blockers explicitly** - Set status to `blocked` when stuck
4. **Request decisions** - Don't guess on important choices

### For Monitoring

1. **Subscribe to `task.blocked`** - These need attention
2. **Watch `decision.requested.blocking`** - Agents are waiting
3. **Use webhooks over polling** - Real-time, more efficient

---

## 8. Example Workflows

### Autonomous Task Execution (webhook → agent → task complete)

```
1. Human clicks "Request Agent" on "Implement Auth" task
2. AgentPlanner sends task.start_requested webhook
3. OpenClaw spawns session with task context
4. Agent:
   - Reads task: "Implement JWT authentication"
   - Calls API to mark in_progress
   - Does the implementation work
   - Adds log: "Added /auth/login and /auth/register endpoints"
   - Marks task completed
5. Response delivered to Slack
```

### Decision Flow (agent → human → agent continues)

```
1. Agent working on database task
2. Agent hits choice point: PostgreSQL vs MongoDB
3. Agent creates decision request with urgency: blocking
4. decision.requested.blocking webhook fires
5. Human sees notification, makes decision in AgentPlanner UI
6. decision.resolved webhook fires
7. Agent continues with chosen option
```

---

## 9. Troubleshooting

### Webhooks not receiving events

1. Check settings: `GET /webhooks/settings`
2. Verify `enabled: true` and correct URL
3. Check event is in `events` array
4. View delivery history: `GET /webhooks/history`

### OpenClaw not processing webhooks

1. Verify hooks are enabled in openclaw.json
2. Check token matches between AgentPlanner URL and OpenClaw config
3. Look at Gateway logs for errors

### Rate Limiting

- API: 1000 requests/hour per user
- Webhooks: Sent immediately, no batching

---

## Resources

- **AgentPlanner App**: https://www.agentplanner.io
- **API Documentation**: https://api.agentplanner.io/api-docs/
- **MCP Package**: https://github.com/TAgents/agent-planner-mcp
- **OpenClaw Docs**: https://docs.openclaw.ai
- **GitHub**: https://github.com/TAgents
