# AgentPlanner — Core Concepts

## Overview

AgentPlanner is an agent orchestration platform where AI agents autonomously plan and execute work toward human-defined goals. The API, UI, and MCP server form a shared workspace where agents and humans collaborate through structured plans, dependencies, and a persistent knowledge graph.

The key insight: **agents drive, humans steer**. Humans define what success looks like. Agents figure out how to get there — breaking down goals into plans, researching approaches, logging decisions, and executing tasks. Humans review, redirect, and approve at key gates.

---

## The Hierarchy: Goals → Plans → Nodes

Everything in the platform is organized into a three-level hierarchy:

```
Goal: "Launch auth service by Q2"
 └── Plan: "Auth Service Implementation"
      └── root
           ├── Phase: "Research & Design"
           │    ├── Task: "Research OAuth providers"
           │    ├── Task: "Design token schema"
           │    └── Milestone: "Design approved"
           └── Phase: "Implementation"
                ├── Task: "Implement JWT middleware"
                ├── Task: "Build login flow"
                └── Milestone: "Auth service deployed"
```

### Goals

Goals are the top-level outcomes humans care about. They represent *what* success looks like, not *how* to achieve it. One or more plans can be linked to a goal; the platform tracks goal health automatically based on linked plan progress.

| Status | Meaning |
|---|---|
| `active` | Currently being pursued |
| `achieved` | Success criteria met |
| `paused` | Temporarily on hold |
| `abandoned` | No longer relevant |

**Goal health** (computed automatically):

| Health | Condition |
|---|---|
| `on_track` | Linked plans progressing, no critical bottlenecks |
| `at_risk` | Stale tasks, bottlenecks, or slow progress detected |
| `stale` | No activity within threshold period |

> **In the UI:** Goals dashboard shows health cards with drill-down to bottlenecks and critical paths.
>
> **For agents:** `check_goals_health()` returns the same dashboard data programmatically.

### Plans

Plans are hierarchical trees of work linked to goals. Each plan has a root node, under which all other nodes are organized.

| Visibility | Who can see it |
|---|---|
| `private` | Owner and collaborators only |
| `public` | Anyone |
| `unlisted` | Accessible via direct link, not listed publicly |

Plan statuses: `draft`, `active`, `completed`, `archived`.

### Nodes

Nodes are the building blocks of plans. Every node has a type, a status, and a position in the tree (via `parent_id`).

| Node Type | Purpose | Example |
|---|---|---|
| `root` | Auto-created tree root (one per plan, cannot delete) | — |
| `phase` | Grouping container for related tasks | "Research & Design" |
| `task` | A unit of work an agent or human performs | "Implement JWT middleware" |
| `milestone` | Checkpoint or deliverable marking progress | "Design approved" |

---

## Task Statuses

Every task moves through a set of statuses as work progresses:

| Status | Meaning |
|---|---|
| `not_started` | Default. No work begun. |
| `in_progress` | Actively being worked on. |
| `completed` | Work finished and verified. |
| `blocked` | Cannot proceed — always add a log explaining why. |
| `plan_ready` | Planning complete, awaiting human review before implementation. |

**Status flow:**

```
                          ┌──────────┐
                          │not_started│
                          └─────┬────┘
                                │
                                ▼
              ┌────────── in_progress ──────────┐
              │                │                │
              ▼                ▼                ▼
          blocked         completed        plan_ready
              │                               │
              │                               │ (human approves)
              └──► in_progress ◄──────────────┘
```

**Auto-unblocking:** When a blocking task is completed, downstream tasks that were `blocked` are automatically set to `not_started`, making them available for work.

---

## Task Modes & RPI Workflow

Task modes control how a task fits into a structured workflow:

| Mode | Purpose |
|---|---|
| `free` | Default. No workflow constraint. Use for simple, standalone tasks. |
| `research` | Investigation and discovery. Logs are auto-compacted when completed. |
| `plan` | Design based on research findings. Mark `plan_ready` for human review. |
| `implement` | Execution based on approved plan. Receives compacted research + plan context. |

### RPI Chains (Research → Plan → Implement)

For complex work, the platform supports a structured three-step workflow:

```
┌──────────┐    blocks    ┌──────────┐    blocks    ┌───────────┐
│ Research  │────────────►│   Plan   │────────────►│ Implement │
│ (research)│             │  (plan)  │             │(implement)│
└──────────┘             └──────────┘             └───────────┘
      │                        │                        │
  Investigate            Design solution          Execute the plan
  Log findings           Mark plan_ready          Auto-receives
  Auto-compacted         Human reviews            compacted context
```

**When to use RPI vs. free tasks:**
- **Simple work** (fix a typo, update a config) → `free` task
- **Complex work** (build a feature, design an architecture) → RPI chain

**Compaction:** When a `research` task completes, its logs are automatically summarized into a structured format. The `implement` task receives this compacted context through the progressive context engine, so agents don't need to re-read raw research logs.

> **For agents:** Use `create_rpi_chain()` to create all three tasks with blocking dependencies in one call.

---

## Dependencies

Dependencies define ordering and relationships between tasks:

| Type | Semantics | Scheduling impact |
|---|---|---|
| `blocks` | Source must complete before target can start | Hard constraint. Forms the critical path. |
| `requires` | Target needs output from source | Soft constraint. Can potentially start in parallel. |
| `relates_to` | Informational link | No scheduling constraint. |

**Cycle detection** is automatic — the system rejects any dependency that would create a circular chain.

**Critical path:** The longest chain of `blocks` edges through incomplete nodes. This is the minimum time to completion.

**Impact analysis:** Ask "what if?" about any task:
- *Delay* — what gets pushed back?
- *Block* — what gets stuck?
- *Remove* — what becomes unblocked?

Each reports both direct and transitive effects.

```
Example dependency graph:

  [Research Auth] ──blocks──► [Plan Auth] ──blocks──► [Implement Auth]
                                                            │
  [Setup CI] ──────blocks──────────────────────────────────►│
                                                     [Deploy Auth]
                                                            │
                                        relates_to──► [Update Docs]
```

> **For agents:** `analyze_impact()` and `get_critical_path()` provide programmatic access.

---

## Progressive Context

The context engine assembles relevant information for a task in four progressive layers, each adding more detail:

| Depth | Layer | What's included |
|---|---|---|
| 1 | **Task focus** | Node details, recent logs, agent instructions |
| 2 | **Neighborhood** | + Parent, siblings, direct dependencies (upstream/downstream) |
| 3 | **Knowledge** | + Plan-scoped knowledge from Graphiti, research outputs from RPI siblings |
| 4 | **Extended** | + Full plan overview, complete ancestry, linked goals, transitive dependencies |

**Token budgeting:** Pass `token_budget` to cap the response size (~4 chars/token heuristic). The engine prioritizes the most relevant information within budget.

**When to use each depth:**
- **Depth 1** — Quick status check, simple standalone tasks
- **Depth 2** — Most common. Understand a task in context of its neighbors (recommended default)
- **Depth 3** — When you need knowledge and prior research findings
- **Depth 4** — When you need the full picture (goal alignment, cross-plan dependencies)

> **For agents:** `get_task_context(node_id, depth)` is the primary entry point.

---

## Knowledge Graph

The platform includes a temporal knowledge graph (powered by Graphiti) that persists learnings, decisions, and context across tasks and plans.

**Key properties:**
- **Temporal** — every entry records *what*, *when*, and *by whom*
- **Cross-plan** — knowledge from one plan is available in all others within the same organization
- **Entity extraction** — the system automatically identifies entities (technologies, people, patterns) and their relationships
- **Contradiction detection** — flags when newer information conflicts with older facts

| Knowledge type | When to use |
|---|---|
| `decision` | Choices made — capture the *why* (survives compaction) |
| `learning` | Useful discoveries during research or implementation |
| `context` | Background information relevant to the work |
| `constraint` | Rules, limitations, or requirements that must be respected |

> **For agents:** `add_learning()` to record, `recall_knowledge()` to search, `check_contradictions()` before acting on old information.

---

## Task Claims

Claims prevent multiple agents from working on the same task simultaneously.

| Concept | Detail |
|---|---|
| **Claim** | Exclusive lock on a task. One active claim per task. |
| **TTL** | Claims auto-expire after a timeout to prevent deadlocks. |
| **Release** | Explicitly release when done or switching tasks. |

**Flow:** Claim → Work → Release (or TTL expiry)

> **For agents:** Always `claim_task()` before starting work. Always `release_task()` when done. If you don't release, the TTL will eventually free it, but explicit release is preferred.

---

## Organizations

Organizations provide multi-tenancy. Each org gets:
- **Isolated knowledge namespace** — knowledge graph entries are scoped to the org
- **Shared plans** — members collaborate on plans within the org
- **Role-based access** — `owner`, `admin`, `member`

---

## Human-Agent Interaction Model

The platform provides several mechanisms for humans to steer agent behavior without micromanaging:

| Mechanism | How it works |
|---|---|
| **Decision queue** | Agents flag questions or choices; humans review and decide |
| **`plan_ready` gate** | Agents mark plan tasks as `plan_ready`; humans approve before implementation proceeds |
| **Agent activity stream** | Real-time feed of what agents are doing (logs, status changes, claims) |
| **Steering actions** | Approve, redirect, block, or re-prioritize tasks |

**When to intervene vs. let the agent run:**
- Agent is on track and logging clearly → let it run
- Agent is blocked or asking a question → respond via decision queue
- Agent's approach is wrong → set task to `blocked` with a log explaining why, or change the task mode
- Agent needs to skip a step → complete or remove the task manually

> **In the UI:** The Dashboard is mission control — goal health, pending decisions, and agent activity in one view.
>
> **For agents:** `check_goals_health()` for the big picture, `suggest_next_tasks()` for what to work on next.

---

## Further Reading

- **[GETTING_STARTED.md](GETTING_STARTED.md)** — Step-by-step quickstart for humans and agents
- **[SKILL.md](../../agent-planner-mcp/SKILL.md)** — Complete MCP tool reference (for agents)
- **[AGENT_GUIDE.md](../../agent-planner-mcp/AGENT_GUIDE.md)** — Agent quick reference card
- **[API.md](API.md)** — REST API reference (for developers)
- **[VISION.md](../../docs/VISION.md)** — Full platform philosophy
