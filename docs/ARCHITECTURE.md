# AgentPlanner API v2.0 — Architecture & Design

A comprehensive guide to the AgentPlanner backend: how plans, dependencies, progressive context, and reasoning services work together to enable human-AI collaborative planning.

## Table of Contents

- [Overview](#overview)
- [Core Data Model](#core-data-model)
- [Dependency Graph](#dependency-graph)
- [Progressive Context Engine](#progressive-context-engine)
- [RPI Chains (Research → Plan → Implement)](#rpi-chains)
- [Reasoning Services](#reasoning-services)
- [Research Output Compaction](#research-output-compaction)
- [MCP Integration](#mcp-integration)
- [Authentication](#authentication)
- [Real-Time Collaboration](#real-time-collaboration)
- [Database & ORM](#database--orm)
- [Service Architecture](#service-architecture)
- [API Endpoint Map](#api-endpoint-map)

---

## Overview

AgentPlanner is a collaborative planning system where humans and AI agents work together on structured plans. The system models work as hierarchical trees of nodes (phases, tasks, milestones) connected by a dependency graph. AI agents access plans through the MCP protocol or REST API, and receive exactly the right amount of context for any task via the progressive context engine.

**Key innovations in v2.0:**

1. **Dependency graph** — Directed edges between nodes with cycle detection, traversal, impact analysis, and critical path computation, all via PostgreSQL recursive CTEs.
2. **Progressive context engine** — 4-layer context assembly with token budgeting, so agents never need to load entire plans.
3. **RPI chains** — Research → Plan → Implement task decomposition with automatic dependency wiring and research output compaction.
4. **Reasoning services** — Automated status propagation, bottleneck detection, topological scheduling, and decomposition alerts.

### Technology Stack

| Component | Technology |
|-----------|------------|
| Runtime | Node.js + Express |
| Database | PostgreSQL 17 (pgvector) |
| ORM | Drizzle ORM (ESM modules) |
| Auth | JWT + API tokens (SHA-256 hashed) |
| Real-time | WebSocket (ws) + PostgreSQL LISTEN/NOTIFY |
| MCP | @modelcontextprotocol/sdk (stdio + HTTP/SSE) |
| Frontend | React 18 + TypeScript + Tailwind CSS |

---

## Core Data Model

### Plans

A plan is the top-level container. Each plan has a `visibility` (private, public, unlisted) and a set of collaborators with roles (owner, admin, editor, viewer).

### Nodes

Nodes form a tree via `parent_id`. Each plan has exactly one root node.

| Field | Description |
|-------|-------------|
| `id` | UUID primary key |
| `plan_id` | Foreign key to plan |
| `parent_id` | Parent node (tree structure) |
| `node_type` | `root`, `phase`, `task`, `milestone` |
| `status` | `not_started`, `in_progress`, `completed`, `blocked`, `plan_ready` |
| `task_mode` | `free`, `research`, `plan`, `implement` |
| `title` | Node title |
| `description` | Rich text description |
| `context` | Additional context for agents |
| `agent_instructions` | Specific instructions for AI agents |
| `order_index` | Sort order among siblings |
| `metadata` | JSONB for extensible data (includes compacted_context) |
| `assigned_agent_id` | Currently assigned agent |
| `due_date` | Optional deadline |

### Node Types

- **root** — Automatically created when a plan is created. The tree root.
- **phase** — A group of tasks. Phases can be nested.
- **task** — A unit of work. Can have a `task_mode` for RPI chains.
- **milestone** — A checkpoint or deliverable.

### Statuses

| Status | Meaning |
|--------|---------|
| `not_started` | No work has begun |
| `in_progress` | Actively being worked on |
| `completed` | Done and verified |
| `blocked` | Cannot proceed (upstream dependency incomplete, waiting for decision, etc.) |
| `plan_ready` | Plan/research phase complete — waiting for human review before proceeding |

### Task Modes

| Mode | Meaning | Used in |
|------|---------|---------|
| `free` | Default — no special workflow | Standalone tasks |
| `research` | Investigation phase | RPI chain step 1 |
| `plan` | Design/planning phase | RPI chain step 2 |
| `implement` | Implementation phase | RPI chain step 3 |

---

## Dependency Graph

Dependencies are directed edges between nodes, stored in the `node_dependencies` table.

### Schema

```sql
CREATE TABLE node_dependencies (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_node_id UUID NOT NULL REFERENCES plan_nodes(id) ON DELETE CASCADE,
  target_node_id UUID NOT NULL REFERENCES plan_nodes(id) ON DELETE CASCADE,
  dependency_type TEXT NOT NULL DEFAULT 'blocks',  -- blocks | requires | relates_to
  weight        INTEGER DEFAULT 1,
  metadata      JSONB DEFAULT '{}',
  created_by    UUID REFERENCES users(id),
  created_at    TIMESTAMPTZ DEFAULT now(),
  updated_at    TIMESTAMPTZ DEFAULT now(),
  UNIQUE(source_node_id, target_node_id, dependency_type),
  CHECK (source_node_id != target_node_id)
);
```

### Dependency Types

| Type | Semantics | Example |
|------|-----------|---------|
| `blocks` | Source must complete before target can start | "Design API" blocks "Implement API" |
| `requires` | Target needs output from source (softer than blocks) | "Research patterns" requires "Setup dev env" |
| `relates_to` | Informational link, no execution constraint | "Auth service" relates_to "User management" |

### Cycle Detection

Before creating any edge, a recursive CTE walks forward from the target node to check if the source node is reachable. If so, the edge would create a cycle and is rejected with HTTP 409.

```sql
WITH RECURSIVE reachable AS (
  SELECT target_node_id AS node_id, ARRAY[target_id, target_node_id] AS path
  FROM node_dependencies
  WHERE source_node_id = $target_id AND dependency_type = ANY($types)
  UNION
  SELECT nd.target_node_id, r.path || nd.target_node_id
  FROM node_dependencies nd
  JOIN reachable r ON nd.source_node_id = r.node_id
  WHERE NOT nd.target_node_id = ANY(r.path)
)
SELECT path FROM reachable WHERE node_id = $source_id LIMIT 1
```

### Traversal

**Upstream** (what blocks me) and **downstream** (what I block) traversal use recursive CTEs with configurable max depth. Results include node details (title, status, type, task_mode) joined from `plan_nodes`.

### Impact Analysis

Given a node and a scenario (`delay`, `block`, `remove`), the impact endpoint walks downstream through the dependency graph and classifies affected nodes:

- **Direct** (depth = 1) — immediately dependent
- **Transitive** (depth > 1) — indirectly affected

The `remove` scenario follows all edge types including `relates_to`; `delay` and `block` only follow `blocks` and `requires`.

### Critical Path

Finds the longest chain of `blocks` edges through incomplete nodes in a plan. Uses a recursive CTE starting from DAG roots (nodes with no upstream blockers) and accumulates `weight` along the path.

### API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/plans/:id/dependencies` | Create edge (with cycle detection) |
| DELETE | `/plans/:id/dependencies/:depId` | Delete edge |
| GET | `/plans/:id/dependencies` | List all edges in plan |
| GET | `/plans/:id/nodes/:nodeId/dependencies` | Node deps (direction: upstream/downstream/both) |
| GET | `/plans/:id/nodes/:nodeId/upstream` | Recursive upstream traversal |
| GET | `/plans/:id/nodes/:nodeId/downstream` | Recursive downstream traversal |
| GET | `/plans/:id/nodes/:nodeId/impact` | Impact analysis |
| GET | `/plans/:id/critical-path` | Critical path |

---

## Progressive Context Engine

The progressive context engine (`src/services/contextEngine.js`) is the core innovation. It assembles exactly the right amount of context for any task, at adjustable depth with optional token budgeting.

### 4 Layers

| Depth | Layer | What's Included |
|-------|-------|-----------------|
| 1 | **Task Focus** | Node details, recent logs, RPI research (for implement tasks) |
| 2 | **Local Neighborhood** | Parent node, sibling nodes, direct dependencies (upstream + downstream) |
| 3 | **Knowledge** | Plan-scoped knowledge entries (future: Graphiti temporal knowledge) |
| 4 | **Extended** | Plan overview, full ancestry path, linked goals, transitive dependencies |

### Token Budgeting

Callers can set a `token_budget` parameter. The engine estimates token count using a `chars / 4` heuristic and progressively truncates lower-priority sections when the budget is exceeded. The response includes metadata:

```json
{
  "meta": {
    "node_id": "...",
    "depth": 4,
    "layers_included": ["task_focus", "local_neighborhood", "knowledge", "extended"],
    "token_estimate": 1850,
    "budget_applied": 2000
  },
  "task": { ... },
  "logs": [ ... ],
  "rpi_research": [ ... ],
  "parent": { ... },
  "siblings": [ ... ],
  "dependencies": { "upstream": [...], "downstream": [...] },
  "knowledge": [ ... ],
  "plan": { ... },
  "ancestry": [ ... ],
  "goals": [ ... ],
  "transitive_dependencies": { "upstream": [...], "downstream": [...] }
}
```

### RPI Research Integration

When the target node has `task_mode = implement`, the engine automatically finds its research/plan siblings and includes their context:

- **If compacted** (research output has been compacted): includes structured sections (decisions, key findings, challenges)
- **If not compacted**: includes raw log entries as fallback

### API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/context/progressive` | Progressive context assembly |
| GET | `/context/suggest` | Suggest next actionable tasks |
| POST | `/context/compact` | Trigger research output compaction |
| GET | `/context` | Legacy node context (leaf-up) |
| GET | `/context/plan` | Legacy plan context |

### Suggest Next Tasks

The suggest endpoint (`GET /context/suggest?plan_id=X`) uses the dependency graph to find tasks that are ready to work on:

1. Finds all `not_started` and `plan_ready` tasks in the plan
2. For each, checks if ALL upstream `blocks`/`requires` dependencies are `completed`
3. Ranks by: RPI research tasks first → highest downstream unblock count → order index
4. Returns with reasons explaining why each task is recommended

---

## RPI Chains

RPI (Research → Plan → Implement) is a task decomposition pattern for complex work.

### Creation

`POST /plans/:id/nodes/rpi-chain` creates 3 sibling tasks under a parent node:

1. **Research** task (`task_mode: research`) — investigate the problem
2. **Plan** task (`task_mode: plan`) — design the solution
3. **Implement** task (`task_mode: implement`) — build it

Two `blocks` dependency edges are automatically created: Research → Plan → Implement.

### Workflow

```
Research (task_mode=research)
  │  Agent researches, logs findings as reasoning/decision entries
  │  Mark completed → auto-compaction of research output
  ▼
Plan (task_mode=plan)
  │  Agent gets compacted research context automatically
  │  Creates implementation plan
  │  Mark plan_ready → human review gate
  ▼  (human approves → status transitions to completed)
Implement (task_mode=implement)
  │  Agent gets compacted research + plan context via progressive engine
  │  Builds the solution
  ▼
Done
```

### Detection

`GET /plans/:id/rpi-chains` detects existing RPI chains by finding groups of 3 sibling tasks connected by `blocks` edges where `task_mode` follows the R→P→I pattern. Returns chain status: `not_started`, `researching`, `research_done`, `planning`, `plan_ready`, `implementing`, `completed`.

---

## Reasoning Services

Backend services (`src/services/reasoning.js`) that analyze the dependency graph and provide automated insights.

### Status Propagation

When a task is marked `completed`, the engine checks all downstream tasks blocked by it. If a downstream task's **every** upstream blocker is now completed, it auto-transitions from `blocked` to `not_started`.

When a task is marked `blocked`, downstream tasks receive warnings.

Triggered via PostgreSQL LISTEN/NOTIFY message bus.

### Bottleneck Detection

`GET /plans/:id/bottlenecks`

Identifies nodes with the highest downstream dependency fan-out — tasks that block the most other work. Helps prioritize what to work on first.

### Topological Scheduling

`GET /plans/:id/schedule`

Returns incomplete tasks in dependency-respecting execution order using Kahn's algorithm. Tasks are grouped into **layers** — all tasks in a layer can execute in parallel (their dependencies are in earlier layers).

```json
{
  "schedule": [
    { "id": "...", "title": "Research auth", "layer": 0 },
    { "id": "...", "title": "Plan auth", "layer": 1 },
    { "id": "...", "title": "Implement auth", "layer": 2 }
  ],
  "layers": {
    "0": [ ... ],  // can all run in parallel
    "1": [ ... ],  // can run after layer 0 completes
    "2": [ ... ]
  }
}
```

### Decomposition Alerts

`GET /plans/:id/decomposition-alerts`

Flags tasks that may be too complex for a single work unit. Heuristics:
- Description longer than 500 characters
- In progress for more than 7 days
- More than 20 log entries

Recommends decomposing into an RPI chain.

---

## Research Output Compaction

When a research or plan task is completed, its logs can be **compacted** into a structured summary stored in `node.metadata.compacted_context`.

### How It Works

1. Triggered manually via `POST /context/compact` or automatically via message bus on status change
2. Extracts high-signal logs: `decision` type first, then `reasoning`, then `challenge`
3. Falls back to recent `progress` logs if no high-signal logs exist
4. Stores the compacted summary in the node's JSONB metadata

### Output Format

```json
{
  "source_node_id": "...",
  "source_title": "Research auth patterns",
  "source_task_mode": "research",
  "compacted_at": "2026-03-13T14:33:23.851Z",
  "log_count": 12,
  "sections": [
    { "type": "decisions", "items": ["Use JWT+refresh for API auth, PKCE for frontend"] },
    { "type": "key_findings", "items": ["OAuth2 with PKCE is best for SPAs"] },
    { "type": "challenges", "items": ["mTLS requires cert management infra"] }
  ]
}
```

### Integration with Context Engine

The progressive context engine checks for compacted output before falling back to raw logs. Downstream `implement` tasks automatically receive the compacted version, reducing context size by 5-10x.

---

## MCP Integration

The MCP server (`agent-planner-mcp`) is the primary interface for AI agents. Single server, single API token.

### Transport Modes

- **stdio** — For Claude Desktop, Claude Code, and local MCP clients
- **HTTP/SSE** — For remote/container deployment (port 3100)

### Tool Categories

| Category | Tools |
|----------|-------|
| Quick Actions | `quick_plan`, `quick_task`, `quick_status`, `quick_log` |
| Plans | `list_plans`, `create_plan`, `update_plan`, `delete_plan`, `get_plan_structure`, `get_plan_summary`, `share_plan` |
| Nodes | `create_node`, `update_node`, `delete_node`, `move_node`, `get_node_context`, `get_node_ancestry`, `batch_update_nodes` |
| Dependencies | `create_dependency`, `delete_dependency`, `list_dependencies`, `get_node_dependencies`, `analyze_impact`, `get_critical_path`, `create_rpi_chain` |
| Context | `get_task_context`, `suggest_next_tasks`, `get_agent_context`, `get_plan_context` |
| Logs | `add_log`, `get_logs` |
| Goals | `list_goals`, `create_goal`, `update_goal`, `get_goal`, `link_plan_to_goal`, `unlink_plan_from_goal` |
| Knowledge | `add_knowledge_entry`, `search_knowledge`, `list_knowledge_entries`, `update_knowledge_entry`, `delete_knowledge_entry` |
| Organizations | `list_organizations`, `get_organization`, `create_organization`, `update_organization` |
| Search | `search` |
| Tasks | `get_my_tasks` |

### Recommended Agent Workflow

```
1. suggest_next_tasks(plan_id)          → find what's ready
2. get_task_context(node_id, depth=2)   → load context
3. quick_status(task_id, "in_progress") → claim the task
4. [do the work]
5. add_log(task_id, "what I did")       → document progress
6. quick_status(task_id, "completed")   → done (auto-unblocks downstream)
```

---

## Authentication

Two methods:

1. **JWT Bearer** — `Authorization: Bearer <jwt>` (from login/register endpoints)
2. **API Key** — `Authorization: ApiKey <token>` (SHA-256 hashed, stored in `api_tokens` table)

API tokens support scoped permissions and are the recommended auth method for agents and CI/CD.

Middleware: `authenticate` (required) from `src/middleware/auth.middleware.v2.js`.

---

## Real-Time Collaboration

### WebSocket

WebSocket server at `/api/ws` provides:
- Plan change broadcasts (node created/updated/deleted)
- User presence tracking
- Typing indicators

Exponential backoff reconnection (max 10 attempts, up to 30s delay), ping/pong keepalive every 30s.

### Message Bus

PostgreSQL LISTEN/NOTIFY (`src/services/messageBus.js`) for internal event-driven messaging:
- `node.status.changed` → triggers status propagation and compaction
- `notifications` → fan-out to Slack, Webhook, Console adapters

---

## Database & ORM

### Drizzle ORM

Schema definitions in `src/db/schema/*.mjs` (ESM). Controllers are CommonJS. The bridge is `src/db/dal.cjs` — a Proxy that lazy-loads ESM DAL modules.

### Data Access Layer (DAL)

All database access goes through `src/db/dal/` modules. Controllers never import Drizzle or pg directly.

| DAL | Purpose |
|-----|---------|
| `plansDal` | Plan CRUD, access control, collaborators |
| `nodesDal` | Node CRUD, tree building, ancestry, search |
| `dependenciesDal` | Dependency edges, cycle detection, traversal, impact, critical path |
| `logsDal` | Node activity logs |
| `commentsDal` | Node comments |
| `goalsDal` | Goals and goal-plan links |
| `tokensDal` | API token management |
| `usersDal` | User accounts |
| `collaboratorsDal` | Plan collaborator roles |
| `decisionsDal` | Decision requests and resolutions |
| `organizationsDal` | Organizations |
| `searchDal` | Full-text and semantic search |
| `auditDal` | Audit trail |
| `heartbeatsDal` | Agent heartbeats |
| `agentsDal` | Agent registration |

### Migrations

Custom migration runner (`scripts/run-migrations.mjs`) that:
- Reads `.sql` files from `src/db/sql/` in numeric order
- Handles Drizzle's `--> statement-breakpoint` format
- Tracks applied migrations in `schema_migrations` table
- Each migration runs in a transaction

---

## Service Architecture

```
src/
├── index.js                    # Express app, middleware, route mounting, WebSocket init
├── config/
│   └── swagger.js              # OpenAPI/Swagger configuration
├── routes/
│   ├── plan.routes.js          # Plan CRUD
│   ├── node.routes.js          # Node CRUD + RPI chain creation
│   ├── dependency.routes.js    # Dependency graph endpoints
│   ├── reasoning.routes.js     # Bottleneck, RPI chains, schedule, alerts
│   ├── context.routes.js       # Progressive context + suggest + compact
│   ├── decision.routes.js      # Decision requests
│   ├── goal.routes.js          # Goals
│   ├── auth.routes.js          # Authentication
│   └── ...                     # Activity, collaboration, search, etc.
├── controllers/
│   ├── node.controller.v2.js   # Node operations + RPI chain
│   ├── dependency.controller.v2.js  # Dependency operations
│   └── ...
├── services/
│   ├── contextEngine.js        # Progressive context assembly + suggest next tasks
│   ├── compaction.js           # Research output compaction
│   ├── reasoning.js            # Status propagation, bottlenecks, scheduling
│   ├── messageBus.js           # PostgreSQL LISTEN/NOTIFY event bus
│   ├── notifications.v2.js     # Notification fan-out
│   └── ...
├── db/
│   ├── schema/*.mjs            # Drizzle ORM table definitions
│   ├── dal/*.mjs               # Data Access Layer modules
│   ├── dal.cjs                 # CJS/ESM bridge
│   ├── connection.mjs          # Database connection
│   └── sql/*.sql               # Migration files
├── middleware/
│   ├── auth.middleware.v2.js    # JWT + API key authentication
│   └── ...
├── adapters/
│   ├── slack.adapter.js        # Slack notifications
│   ├── webhook.adapter.js      # Webhook notifications
│   └── console.adapter.js      # Dev console output
└── websocket/
    ├── collaboration.js        # WebSocket server
    └── broadcast.js            # Plan change broadcasts
```

---

## API Endpoint Map

### Plans
| Method | Path | Description |
|--------|------|-------------|
| GET | `/plans` | List accessible plans |
| POST | `/plans` | Create plan |
| GET | `/plans/:id` | Get plan |
| PUT | `/plans/:id` | Update plan |
| DELETE | `/plans/:id` | Delete plan |

### Nodes
| Method | Path | Description |
|--------|------|-------------|
| GET | `/plans/:id/nodes` | List nodes (tree) |
| POST | `/plans/:id/nodes` | Create node |
| GET | `/plans/:id/nodes/:nodeId` | Get node |
| PUT | `/plans/:id/nodes/:nodeId` | Update node |
| DELETE | `/plans/:id/nodes/:nodeId` | Delete node |
| PUT | `/plans/:id/nodes/:nodeId/status` | Update status |
| POST | `/plans/:id/nodes/:nodeId/log` | Add log entry |
| POST | `/plans/:id/nodes/rpi-chain` | Create RPI chain |

### Dependencies
| Method | Path | Description |
|--------|------|-------------|
| POST | `/plans/:id/dependencies` | Create edge |
| DELETE | `/plans/:id/dependencies/:depId` | Delete edge |
| GET | `/plans/:id/dependencies` | List plan edges |
| GET | `/plans/:id/nodes/:nodeId/dependencies` | Node deps |
| GET | `/plans/:id/nodes/:nodeId/upstream` | Upstream traversal |
| GET | `/plans/:id/nodes/:nodeId/downstream` | Downstream traversal |
| GET | `/plans/:id/nodes/:nodeId/impact` | Impact analysis |
| GET | `/plans/:id/critical-path` | Critical path |

### Context
| Method | Path | Description |
|--------|------|-------------|
| GET | `/context/progressive` | Progressive context (depth 1-4) |
| GET | `/context/suggest` | Suggest next tasks |
| POST | `/context/compact` | Compact research output |

### Reasoning
| Method | Path | Description |
|--------|------|-------------|
| GET | `/plans/:id/bottlenecks` | Bottleneck detection |
| GET | `/plans/:id/rpi-chains` | RPI chain detection |
| GET | `/plans/:id/schedule` | Topological schedule |
| GET | `/plans/:id/decomposition-alerts` | Decomposition alerts |

### System
| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Health check |
| GET | `/api-docs` | Swagger UI |
| GET | `/api-docs-json` | OpenAPI spec |
