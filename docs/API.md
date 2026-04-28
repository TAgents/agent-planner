# Agent Planner API

Version: 2.0.0

A collaborative planning system for humans and AI agents with dependency graphs, progressive context assembly, and RPI (Research-Plan-Implement) workflows.

## Base URL

- **Local development:** `http://localhost:3000`
- **Production:** `https://api.agent-planner.com`
- **Swagger UI:** `http://localhost:3000/api-docs` (interactive docs)
- **OpenAPI JSON:** `http://localhost:3000/api-docs-json`

## Authentication

Two authentication methods are supported. All authenticated endpoints require one of these in the `Authorization` header.

### Bearer JWT

```
Authorization: Bearer <jwt_token>
```

Obtained via `POST /auth/login`. Used by the web UI and interactive sessions.

### API Key

```
Authorization: ApiKey <token>
```

Created via `POST /auth/token`. Used by MCP servers and automated agents. Tokens are SHA-256 hashed at rest and can be scoped.

## Key Concepts

### Node Types

Plans are hierarchical trees of nodes. Each node has a `node_type`:

| Type | Description |
|------|-------------|
| `root` | Auto-created tree root (one per plan, cannot be deleted) |
| `phase` | Grouping container for tasks |
| `task` | Work item (the primary unit of work) |
| `milestone` | Checkpoint or deliverable marker |

### Node Statuses

| Status | Description |
|--------|-------------|
| `not_started` | Default. No work has begun. |
| `in_progress` | Actively being worked on. |
| `completed` | Work is finished. |
| `blocked` | Cannot proceed (usually due to an unresolved dependency or decision). |
| `plan_ready` | Planning phase complete; ready for implementation. Used in RPI workflows. |

### Task Modes (RPI Workflow)

Tasks can have a `task_mode` field indicating their role in a Research-Plan-Implement workflow:

| Mode | Description |
|------|-------------|
| `free` | Default. No specific workflow constraint. |
| `research` | Investigation and discovery. Logs are compacted when completed. |
| `plan` | Design and planning based on research output. |
| `implement` | Execution based on the plan. Receives compacted research context. |

### Dependency Types

Edges in the dependency graph connecting two nodes:

| Type | Description |
|------|-------------|
| `blocks` | Source must complete before target can start. Used for critical path calculation. |
| `requires` | Target needs output from source but can potentially start in parallel. |
| `relates_to` | Informational link with no scheduling constraint. |

### Plan Visibility

| Visibility | Description |
|------------|-------------|
| `private` | Only owner and collaborators can access. |
| `public` | Visible to anyone (including unauthenticated users via `/plans/public` endpoints). |
| `unlisted` | Accessible via direct link but not listed publicly. |

### Progressive Context Depth Levels

The context engine assembles information in 4 progressive layers, each including everything from the previous level:

| Depth | Name | Contents |
|-------|------|----------|
| 1 | **Task focus** | Node details, recent logs, agent instructions |
| 2 | **Local neighborhood** | Parent node, siblings, direct dependencies (upstream/downstream) |
| 3 | **Knowledge** | Plan-scoped knowledge entries, research outputs from RPI chain siblings |
| 4 | **Extended** | Full plan overview, complete ancestry path, linked goals, transitive dependencies |

---

## Endpoint Tiers

### Core (Essential for basic workflows)

- `GET/POST /plans` - List and create plans
- `GET/POST/PUT/DELETE /plans/{id}/nodes` - Manage plan structure
- `PUT /plans/{id}/nodes/{nodeId}/status` - Update task status
- `POST /plans/{id}/nodes/{nodeId}/log` - Add progress logs

### Task Claims (Multi-agent coordination)

- `POST /nodes/{nodeId}/claim` - Claim a task for an agent
- `DELETE /nodes/{nodeId}/claim` - Release a claim
- `GET /nodes/{nodeId}/claim` - Get active claim for a node

### Agent Loop (Recommended for agents)

- `GET /agent/briefing` - Bundled mission-control state: goal health, pending decisions, active claims, recent activity, recommendations
- `POST /agent/work-sessions` - Pick or claim a task, mark it `in_progress`, and return progressive context
- `POST /agent/work-sessions/{sessionId}/complete` - Complete a claimed task, write a log, optionally record learning, and release the claim
- `POST /agent/work-sessions/{sessionId}/block` - Block a claimed task, write a challenge log, optionally queue a decision, and release the claim
- `POST /agent/intentions` - Create a plan tree under a goal and link it atomically

These endpoints are a facade over the lower-level domain APIs. Prefer them for MCP clients, coding agents, scheduled autopilots, and validation loops.

### Agent View (Agent-first context)

- `GET /nodes/{nodeId}/agent-view?depth=1-4` - Progressive context layers for agent consumption

### Goal Health (Goal-level dashboards)

- `GET /goals/v2/dashboard` - Goal health dashboard
- `GET /goals/v2/{goalId}/briefing` - Goal briefing with critical path and bottlenecks

### Dependencies (Dependency graph operations)

- `POST /plans/{id}/dependencies` - Create dependency edge
- `DELETE /plans/{id}/dependencies/{depId}` - Delete dependency
- `GET /plans/{id}/dependencies` - List all dependencies in a plan
- `GET /plans/{id}/nodes/{nodeId}/dependencies` - Node dependencies (upstream/downstream/both)
- `GET /plans/{id}/nodes/{nodeId}/upstream` - Recursive upstream traversal
- `GET /plans/{id}/nodes/{nodeId}/downstream` - Recursive downstream traversal
- `GET /plans/{id}/nodes/{nodeId}/impact` - Impact analysis (delay/block/remove scenarios)
- `GET /plans/{id}/critical-path` - Critical path through blocking edges
- `POST /plans/{id}/nodes/rpi-chain` - Create R-P-I task chain with dependencies

### Context (Progressive context engine)

- `GET /context/progressive?node_id=X&depth=1-4&token_budget=N` - Progressive context assembly
- `GET /context/suggest?plan_id=X&limit=5` - Suggest next actionable tasks
- `POST /context/compact` - Trigger research output compaction
- `GET /context?node_id=X` - Legacy focused context (leaf-up)
- `GET /context/plan?plan_id=X` - Legacy plan context

### Reasoning (Automated analysis)

- `GET /plans/{id}/bottlenecks` - Bottleneck detection (high fan-out nodes)
- `GET /plans/{id}/rpi-chains` - RPI chain detection
- `GET /plans/{id}/schedule` - Topological execution order
- `GET /plans/{id}/decomposition-alerts` - Tasks needing decomposition

### Advanced (Specialized)

- Collaboration, Assignment, Activity, Knowledge, Goals, Organizations, Decisions, Search, Dashboard endpoints

---

## Agent Loop API

The Agent Loop API is the narrow, opinionated surface for autonomous work. It keeps the domain API intact, but bundles the common agent workflow into fewer atomic calls.

### GET /agent/briefing

Returns the current mission-control state for an agent.

**Query:** `goal_id`, `plan_id`, `recent_window_hours`

**Response includes:**
- `goal_health.summary` and `goal_health.goals`
- `pending_decisions`
- `active_claims`
- `recent_activity`
- `top_recommendation`

### POST /agent/work-sessions

Pick or claim a task and start work.

**Body:**
```json
{
  "plan_id": "optional plan UUID",
  "goal_id": "optional goal UUID",
  "task_id": "optional explicit task UUID",
  "ttl_minutes": 30,
  "depth": 3,
  "token_budget": 6000,
  "fresh": false,
  "dry_run": false,
  "agent_id": "mcp-agent"
}
```

If `dry_run` is false, the endpoint claims the task, marks it `in_progress`, and returns progressive context. If `dry_run` is true, it returns the candidate without mutating state.

### POST /agent/work-sessions/{sessionId}/complete

Complete a work session.

**Body:**
```json
{
  "summary": "What changed",
  "learning": {
    "content": "Reusable fact or lesson"
  }
}
```

The endpoint updates task status, writes a log, optionally records knowledge, and releases the claim.

### POST /agent/work-sessions/{sessionId}/block

Block a work session.

**Body:**
```json
{
  "summary": "What is blocked and why",
  "decision": {
    "title": "Decision needed",
    "context": "Background",
    "urgency": "blocking",
    "options": []
  }
}
```

The endpoint marks the task blocked, writes a challenge log, optionally queues a decision, and releases the claim.

### POST /agent/intentions

Create a plan tree under a goal.

**Body:**
```json
{
  "goal_id": "goal UUID",
  "title": "Plan title",
  "rationale": "Why this plan exists",
  "description": "Optional details",
  "status": "draft",
  "visibility": "private",
  "tree": [
    {
      "node_type": "phase",
      "title": "Research",
      "children": [
        { "node_type": "task", "title": "Investigate options", "task_mode": "research" }
      ]
    }
  ]
}
```

Use `status: "draft"` when an autonomous agent proposes work for human review; use `active` for human-directed creation.

### Validation Loop

The backend includes a focused validation command:

```bash
npm run validate:agent-loop
```

It verifies the main loop: briefing, task selection/claim/context, dry-run behavior, completion logging, and claim release.

---

## Endpoints

### Plans

#### GET /plans
List all plans accessible to the authenticated user (owned + collaborator).

#### POST /plans
Create a new plan. A root node is auto-created.

**Body:**
```json
{
  "title": "string (required)",
  "description": "string",
  "status": "draft | active | completed | archived",
  "metadata": {}
}
```

#### GET /plans/{id}
Get a specific plan with its root node.

#### PUT /plans/{id}
Update a plan's title, description, status, or metadata.

#### DELETE /plans/{id}
Delete a plan. Pass `?archive=true` to archive instead.

#### GET /plans/public
List all public plans with pagination and filtering. No authentication required.

**Query:** `sortBy` (recent/alphabetical/completion), `limit`, `page`, `status`, `hasGithubLink`, `owner`, `updatedAfter`, `updatedBefore`, `search`

#### GET /plans/public/{id}
Get a public plan with full node hierarchy. No authentication required.

#### GET /plans/{id}/progress
Get progress statistics (total nodes, completed, in progress, blocked, percentage).

#### GET /plans/{id}/context
Get compiled plan context suitable for agents (plan details + hierarchical node structure).

#### PUT /plans/{id}/visibility
Update plan visibility (`public` or `private`). Owner only.

#### PUT /plans/{id}/github
Link a GitHub repository to the plan. Owner only.

**Body:** `{ "github_repo_owner": "string", "github_repo_name": "string" }`

#### POST /plans/{id}/view
Increment view count for a public plan. No authentication required.

---

### Nodes

#### GET /plans/{id}/nodes
Get all nodes as a hierarchical tree. Returns minimal fields by default; pass `?include_details=true` for full data (description, context, agent_instructions, metadata, timestamps).

#### GET /plans/{id}/nodes/{nodeId}
Get a specific node with all fields.

#### POST /plans/{id}/nodes
Create a new node.

**Body:**
```json
{
  "parent_id": "uuid (defaults to root)",
  "node_type": "phase | task | milestone (required)",
  "title": "string (required)",
  "description": "string",
  "status": "not_started | in_progress | completed | blocked",
  "task_mode": "free | research | plan | implement",
  "order_index": 0,
  "due_date": "ISO 8601",
  "context": "string",
  "agent_instructions": "string",
  "metadata": {}
}
```

#### PUT /plans/{id}/nodes/{nodeId}
Update a node's properties. Same fields as create (all optional).

#### DELETE /plans/{id}/nodes/{nodeId}
Delete a node and its children. Cannot delete the root node.

#### PUT /plans/{id}/nodes/{nodeId}/status
Update node status.

**Body:** `{ "status": "not_started | in_progress | completed | blocked | plan_ready" }`

#### POST /plans/{id}/nodes/{nodeId}/move
Move a node to a different parent or position.

**Body:** `{ "parent_id": "uuid", "order_index": 0 }`

#### POST /plans/{id}/nodes/{nodeId}/log
Add a progress log entry.

**Body:**
```json
{
  "content": "string (required)",
  "log_type": "progress | reasoning | challenge | decision",
  "actor_type": "human | agent"
}
```

#### GET /plans/{id}/nodes/{nodeId}/logs
Get activity logs for a node.

#### GET /plans/{id}/nodes/{nodeId}/context
Get detailed context for a node (node data, ancestry, siblings, plan info).

#### GET /plans/{id}/nodes/{nodeId}/ancestry
Get the path from root to this node.

#### POST /plans/{id}/nodes/{nodeId}/comments
Add a comment. **Body:** `{ "content": "string", "comment_type": "human | agent | system" }`

#### GET /plans/{id}/nodes/{nodeId}/comments
Get comments for a node.

#### GET /plans/{id}/nodes/{nodeId}/activities
Get aggregated activities (logs, comments, status changes, assignments). Supports `limit` and `offset` pagination.

#### POST /plans/{id}/nodes/rpi-chain
Create a Research-Plan-Implement task chain with dependency edges automatically wired (R blocks P, P blocks I).

**Body:**
```json
{
  "title": "string (required)",
  "description": "string",
  "parent_id": "uuid"
}
```

**Response:** Three tasks and two dependency edges.

---

### Dependencies

#### POST /plans/{id}/dependencies
Create a dependency edge between two nodes.

**Body:**
```json
{
  "source_node_id": "uuid (required)",
  "target_node_id": "uuid (required)",
  "dependency_type": "blocks | requires | relates_to (default: blocks)",
  "weight": 1,
  "metadata": {}
}
```

Returns `409` if a cycle would be created or the edge is a duplicate.

#### DELETE /plans/{id}/dependencies/{depId}
Delete a dependency edge.

#### GET /plans/{id}/dependencies
List all dependency edges in a plan.

#### GET /plans/{id}/nodes/{nodeId}/dependencies
List dependencies for a specific node.

**Query:** `direction` = `upstream | downstream | both` (default: `both`)

#### GET /plans/{id}/nodes/{nodeId}/upstream
Recursive traversal of all upstream (blocking) nodes.

**Query:** `max_depth` (default: 10)

#### GET /plans/{id}/nodes/{nodeId}/downstream
Recursive traversal of all downstream (dependent) nodes.

**Query:** `max_depth` (default: 10)

#### GET /plans/{id}/nodes/{nodeId}/impact
Analyze the impact of a node being delayed, blocked, or removed.

**Query:** `scenario` = `delay | block | remove` (default: `block`)

#### GET /plans/{id}/critical-path
Find the critical path (longest weighted dependency chain of `blocks` edges) in a plan.

---

### Context

#### GET /context/progressive
Progressive context assembly for agent tasks. The primary context endpoint.

**Query:**
| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `node_id` | uuid | required | Target node |
| `depth` | 1-4 | 2 | Context depth level |
| `token_budget` | integer | 0 | Max estimated tokens (0 = unlimited) |
| `log_limit` | integer | 10 | Max log entries to include |
| `include_research` | boolean | true | Include research outputs from RPI chain siblings |

#### GET /context/suggest
Suggest next actionable tasks for a plan. Returns tasks where all upstream dependencies are completed. Prioritizes research tasks and high-impact tasks that unblock the most downstream work.

**Query:** `plan_id` (required), `limit` (default: 5)

#### POST /context/compact
Trigger research output compaction for a completed research/plan node. Compacts verbose logs into a structured summary suitable for downstream tasks.

**Body:** `{ "node_id": "uuid" }`

#### GET /context
Legacy focused context. Loads node details, ancestry, plan info, linked goals, and optionally knowledge and siblings.

**Query:** `node_id` (required), `include_knowledge` (default: true), `include_siblings` (default: false)

#### GET /context/plan
Legacy plan context with phase summaries and linked goals.

**Query:** `plan_id` (required), `include_knowledge` (default: true)

---

### Reasoning

#### GET /plans/{id}/bottlenecks
Detect bottleneck nodes with high fan-out in the dependency graph.

**Query:** `limit` (default: 5), `incomplete_only` (default: true)

#### GET /plans/{id}/rpi-chains
Detect Research-Plan-Implement chains within the plan and report their current status.

#### GET /plans/{id}/schedule
Get tasks in topological (execution) order respecting dependency constraints. Returns tasks grouped into parallelizable layers.

#### GET /plans/{id}/decomposition-alerts
Flag tasks that may need decomposition (too large, too many dependencies, or stalled).

---

### Decisions (Human-in-the-Loop)

#### GET /plans/{id}/decisions
List decision requests for a plan.

**Query:** `status` (pending/decided/expired/cancelled), `urgency` (blocking/can_continue/informational), `node_id`, `limit`, `offset`

#### POST /plans/{id}/decisions
Create a decision request.

**Body:**
```json
{
  "title": "string (required, max 200)",
  "context": "string (required, max 5000)",
  "node_id": "uuid (optional)",
  "options": [
    {
      "option": "string",
      "pros": ["string"],
      "cons": ["string"],
      "recommendation": true
    }
  ],
  "urgency": "blocking | can_continue | informational",
  "expires_at": "ISO 8601",
  "requested_by_agent_name": "string"
}
```

#### GET /plans/{id}/decisions/{decisionId}
Get a single decision request.

#### PUT /plans/{id}/decisions/{decisionId}
Update a pending decision request (title, context, options, urgency).

#### POST /plans/{id}/decisions/{decisionId}/resolve
Resolve a decision.

**Body:** `{ "decision": "string (required)", "rationale": "string" }`

#### POST /plans/{id}/decisions/{decisionId}/cancel
Cancel a decision request.

**Body:** `{ "reason": "string" }`

#### DELETE /plans/{id}/decisions/{decisionId}
Delete a decision request. Plan owners only.

#### GET /plans/{id}/decisions/pending-count
Get the count of pending decisions for a plan.

---

### Knowledge (Semantic Knowledge Store)

Mounted at `/knowledge`. Entries support embeddings via OpenAI `text-embedding-3-small` for semantic search.

#### GET /knowledge
List knowledge entries. Filter by `scope` + `scopeId`, or returns entries owned by the authenticated user.

**Query:** `limit`, `offset`, `entryType`, `scope`, `scopeId`

#### POST /knowledge
Create a knowledge entry. Embedding is auto-generated if OPENAI_API_KEY is configured.

**Body:**
```json
{
  "title": "string (required)",
  "content": "string (required)",
  "entryType": "decision | learning | context | constraint | reference | note",
  "scope": "global | plan | task",
  "scopeId": "uuid",
  "tags": ["string"],
  "source": "agent | human | import",
  "metadata": {}
}
```

#### GET /knowledge/{id}
Get a single knowledge entry.

#### PUT /knowledge/{id}
Update a knowledge entry. Re-embeds automatically if title, content, or tags change.

#### DELETE /knowledge/{id}
Delete a knowledge entry.

#### POST /knowledge/search
Semantic search across knowledge entries. Falls back to text search if embeddings are unavailable.

**Body:** `{ "query": "string", "limit": 20, "scope": "string", "scopeId": "uuid", "entryType": "string", "threshold": 0.0 }`

#### GET /knowledge/graph
Get a similarity graph of knowledge entries.

**Query:** `threshold` (default: 0.7), `limit` (default: 100)

#### GET /knowledge/{id}/similar
Find entries similar to a given knowledge entry.

**Query:** `limit` (default: 10)

---

### Collaboration

#### GET /plans/{id}/collaborators
List collaborators on a plan.

#### POST /plans/{id}/collaborators
Add a collaborator. **Body:** `{ "email": "string", "role": "viewer | editor | admin" }`

#### DELETE /plans/{id}/collaborators/{userId}
Remove a collaborator.

#### GET /plans/{id}/active-users
Get currently active users in a plan (presence).

#### POST /plans/{id}/presence
Update user presence in a plan.

#### GET /plans/{id}/nodes/{nodeId}/active-users
Get active and typing users for a node.

---

### Sharing (Email Invitations)

#### POST /plans/{id}/share
Share a plan by email. If the user exists, adds them as collaborator directly. Otherwise creates a pending invitation.

**Body:** `{ "email": "string", "role": "viewer | editor | admin" }`

#### GET /plans/{id}/invites
List pending invitations for a plan.

#### DELETE /plans/{id}/invites/{inviteId}
Revoke a pending invitation.

#### POST /invites/accept/{token}
Accept an invitation (authenticated, email must match).

#### GET /invites/info/{token}
Get invitation details. No authentication required.

---

### Assignment

#### GET /plans/{id}/nodes/{nodeId}/assignments
Get user assignments for a node.

#### POST /plans/{id}/nodes/{nodeId}/assign
Assign a user. **Body:** `{ "user_id": "uuid" }`

#### DELETE /plans/{id}/nodes/{nodeId}/unassign
Unassign a user. **Body:** `{ "user_id": "uuid" }`

#### GET /plans/{id}/available-users
Get users available for assignment (plan collaborators).

#### POST /plans/{id}/nodes/{nodeId}/request-agent
Request agent assistance on a task. **Body:** `{ "request_type": "start | review | help | continue", "message": "string" }`

#### DELETE /plans/{id}/nodes/{nodeId}/request-agent
Clear an agent assistance request.

#### POST /plans/{id}/nodes/{nodeId}/assign-agent
Assign an agent to a task. **Body:** `{ "agent_id": "uuid" }`

#### DELETE /plans/{id}/nodes/{nodeId}/assign-agent
Unassign an agent from a task.

#### GET /plans/{id}/nodes/{nodeId}/suggested-agents
Get suggested agents for a task. **Query:** `tags` (comma-separated)

---

### Activity

#### GET /activity/feed
Get activity feed across all accessible plans. Supports `page` and `limit` pagination.

#### GET /activity/plans/{id}/activity
Get activity logs for a plan. **Query:** `page`, `limit`, `type` (progress/reasoning/challenge/decision)

#### GET /activity/plans/{id}/timeline
Get chronological timeline of significant events (plan creation, node creation, status changes, decisions, knowledge additions).

#### GET /activity/plans/{id}/nodes/{nodeId}/activity
Get recent activity for a node. **Query:** `limit` (default: 10)

#### POST /activity/plans/{id}/nodes/{nodeId}/detailed-log
Add a detailed log entry with metadata and tags.

**Body:** `{ "content": "string", "log_type": "progress | reasoning | challenge | decision", "metadata": {}, "tags": ["string"] }`

---

### Goals

#### GET /goals
List goals owned by the authenticated user. **Query:** `status`

#### POST /goals
Create a goal. **Body:** `{ "title": "string", "description": "string", "type": "outcome", "success_criteria": "string", "priority": 0 }`

#### GET /goals/{id}
Get goal details with linked plans.

#### PUT /goals/{id}
Update a goal. Status values: `active`, `achieved`, `paused`, `abandoned`.

#### DELETE /goals/{id}
Soft-delete a goal.

#### POST /goals/{goalId}/plans/{planId}
Link a plan to a goal.

#### DELETE /goals/{goalId}/plans/{planId}
Unlink a plan from a goal.

---

### Organizations

#### GET /organizations
List organizations the user belongs to.

#### POST /organizations
Create an organization. **Body:** `{ "name": "string", "description": "string", "slug": "string" }`

#### GET /organizations/{id}
Get organization details (includes member count, plan count, user role).

#### PUT /organizations/{id}
Update an organization. Owner only.

#### DELETE /organizations/{id}
Delete an organization. Owner only. Cannot delete personal workspaces.

#### GET /organizations/{id}/members
List organization members.

#### POST /organizations/{id}/members
Add a member. **Body:** `{ "user_id": "uuid" | "email": "string", "role": "member | admin" }`

#### DELETE /organizations/{orgId}/members/{memberId}
Remove a member.

#### PUT /organizations/{orgId}/members/{memberId}/role
Update a member's role. Owner only.

#### GET /organizations/{id}/plans
List plans belonging to an organization.

---

### Search

#### GET /search
Global search across all accessible resources (plans, nodes, comments, logs). **Query:** `query` (min 3 chars)

#### GET /plans/{id}/nodes/search
Search nodes within a plan. **Query:** `query`, `status`, `node_type`, `date_from`, `date_to`

#### GET /search/plan/{plan_id}
Search within a plan using database full-text search. **Query:** `query` (min 2 chars)

---

### Dashboard

#### GET /dashboard/summary
Dashboard summary stats: active plans, pending decisions, pending agent requests, tasks completed this week.

#### GET /dashboard/pending
Pending items: decision requests and agent assistance requests.

#### GET /dashboard/recent-plans
Recently updated plans with progress percentages.

#### GET /dashboard/active-goals
Active goals (placeholder, use `/goals` for full data).

---

### Task Claims

#### POST /nodes/{nodeId}/claim
Claim a task for exclusive agent work. Prevents multiple agents from working on the same task simultaneously.

**Body:**
```json
{
  "agent_id": "string (required)",
  "ttl_minutes": 30
}
```

`ttl_minutes` is optional and controls how long the claim remains active before auto-expiring. Returns the claim object with expiry timestamp.

#### DELETE /nodes/{nodeId}/claim
Release an active claim on a task.

**Body:** `{ "agent_id": "string (required)" }`

Only the agent that holds the claim can release it.

#### GET /nodes/{nodeId}/claim
Get the active claim for a node. Returns the claim object if one exists, or 404 if the node is unclaimed.

---

### Agent View

#### GET /nodes/{nodeId}/agent-view
Get progressive context layers packaged for agent consumption. Similar to the progressive context endpoint but optimized for the agent-first paradigm.

**Query:**
| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `depth` | 1-4 | 2 | Context depth level (same layers as progressive context) |

Returns structured context suitable for direct agent consumption, including task details, dependencies, knowledge, and plan overview at the requested depth.

---

### Goal Health

#### GET /goals/v2/dashboard
Goal health dashboard. Returns all active goals with health indicators computed from linked plan progress, stale tasks, and dependency bottlenecks.

Each goal includes a `health` field with one of:

| Health | Description |
|--------|-------------|
| `on_track` | Linked plans are progressing normally |
| `at_risk` | Some linked plans have blocked or stalled tasks |
| `stale` | No meaningful progress detected in linked plans recently |

#### GET /goals/v2/{goalId}/briefing
Goal briefing with deep analysis. Returns a comprehensive summary including:

- **Critical path** across all linked plans
- **Bottlenecks** blocking progress toward the goal
- **Knowledge status** — available research and knowledge relevant to the goal
- **Plan progress** breakdowns for each linked plan

---

### Agent Integration

#### GET /v2/agent/tools
List available MCP tool definitions.

#### POST /v2/agent/tools/{toolName}
Execute an MCP tool by name. Body contains the tool arguments.

#### POST /v2/agent/callback
Webhook callback from agent sessions. Authenticates via `AGENT_CALLBACK_TOKEN`.

**Body:** `{ "sessionId": "string", "status": "string", "result": {}, "metadata": { "taskId": "uuid" } }`

---

### Authentication

#### POST /auth/register
Register a new user.

#### POST /auth/login
Login and receive a JWT token.

#### POST /auth/logout
Logout (invalidate session).

#### POST /auth/forgot-password
Request password reset email.

#### POST /auth/reset-password
Reset password with token.

#### POST /auth/verify-email
Verify email with token.

#### POST /auth/resend-verification
Resend verification email.

#### GET /auth/profile
Get current user profile.

#### PUT /auth/profile
Update user profile.

#### POST /auth/change-password
Change password (requires current password).

#### GET /auth/token
List all API tokens for the current user.

#### POST /auth/token
Create an API token with specific scopes.

#### DELETE /auth/token/{id}
Revoke an API token.

---

### Users

#### GET /users
List all users.

#### GET /users/search
Search users by name or email.

---

### Upload

#### POST /upload/avatar
Upload user avatar.

#### DELETE /upload/avatar
Delete user avatar.

---

### System

#### GET /
API root endpoint.

#### GET /health
Health check endpoint. Used by monitoring and orchestration platforms.

#### GET /api-docs
Interactive Swagger UI documentation.

#### GET /api-docs-json
OpenAPI specification in JSON format.

---

## WebSocket

Real-time collaboration via WebSocket at `/api/ws`.

- **Protocol:** Exponential backoff reconnection (max 10 attempts, up to 30s delay)
- **Keepalive:** Ping/pong every 30s
- **Events:** Node updates, status changes, presence, typing indicators
- **Authentication:** JWT token passed as query parameter

## Rate Limiting

Four tiers applied at the route level:

| Tier | Routes | Description |
|------|--------|-------------|
| **General** | Most endpoints | Standard rate limit |
| **Auth** | `/auth/*` | Strict limit to prevent brute force |
| **Search** | `/search/*`, `/knowledge/search` | Moderate limit for expensive queries |
| **Token** | `/tokens/*` | Strict limit to prevent token abuse |

## Error Responses

All errors follow a consistent format:

```json
{
  "error": "Human-readable error message"
}
```

Common HTTP status codes:

| Code | Meaning |
|------|---------|
| 400 | Invalid input or validation error |
| 401 | Authentication required |
| 403 | Access denied (insufficient permissions) |
| 404 | Resource not found |
| 409 | Conflict (e.g., duplicate dependency, cycle detected) |
| 500 | Internal server error |
