# Getting Started with AgentPlanner

This guide walks you through the platform from both sides: the **human** steering via the web UI, and the **agent** working via MCP. By the end you'll know how to set a goal, connect an agent, and steer the outcome.

---

## For Humans (Web UI)

### Step 1: Sign Up & Create an Organization

1. Register at the web UI
2. Create an organization (or join one via invite)

Organizations provide isolated workspaces — your plans and knowledge graph are scoped to your org.

### Step 2: Set a Goal

Navigate to **Goals** and create one:

- **Title** — what you want to achieve ("Launch auth service by Q2")
- **Description** — context and constraints
- **Success criteria** — how you'll know it's done

This is the most important thing you do as a human. Goals define *what* success looks like. Agents figure out *how*.

### Step 3: Connect an Agent

1. Go to **Settings → API Tokens**
2. Create a token with a descriptive name
3. Give the token to your agent

For MCP setup (Claude Desktop, Claude Code, or other MCP clients), see the [agent-planner-mcp README](../../agent-planner-mcp/README.md) and [AGENT_GUIDE.md](../../agent-planner-mcp/AGENT_GUIDE.md).

### Step 4: Watch & Steer

The **Dashboard** is your mission control:

| Section | What it shows |
|---|---|
| **Goal health cards** | `on_track`, `at_risk`, or `stale` for each goal |
| **Decision queue** | Questions and choices from agents awaiting your input |
| **Agent activity stream** | Real-time feed of agent actions (logs, status changes, claims) |

The **Plan view** shows the full tree, dependencies, and progress. Click any task to open the details panel:

- **Activity tab** — all logs (reasoning, decisions, challenges)
- **Knowledge tab** — what was learned during this task
- **Dependencies tab** — what blocks this task and what it blocks

### Step 5: Key Interactions

| You want to... | Do this |
|---|---|
| Approve a plan step | Set a `plan_ready` task's status to `completed` |
| Block an agent's approach | Set the task to `blocked` and add a log explaining why |
| Redirect an agent | Change the task description or `task_mode` |
| Answer an agent's question | Resolve the pending item in the decision queue |
| Prioritize work | Reorder tasks or mark less important ones as `blocked` |
| See what an agent knows | Open the task's Knowledge tab or check the Knowledge Graph page |

**When to intervene vs. let the agent run:**
- Agent is logging clearly and making progress → let it run
- A decision is in the queue → review and respond
- The approach looks wrong → block the task with an explanation
- A `plan_ready` task appears → review the plan and approve or redirect

---

## For Agents (MCP)

### Step 1: Connect

1. Get an API token from a human (they create it in Settings → API Tokens)
2. Configure the MCP server — stdio mode for Claude Desktop/Code, HTTP mode for remote agents
3. See [agent-planner-mcp README](../../agent-planner-mcp/README.md) for setup details

### Step 2: Orient

Start every session by understanding what needs attention:

```
check_goals_health()          → Which goals need work?
get_my_tasks()                → What's already assigned to me?
get_recent_episodes()         → What happened since last session?
```

### Step 3: The Autonomous Loop

```
┌─────────────────────────────────────────────┐
│                                             │
│   ┌──────────┐                              │
│   │PREFLIGHT │  check_coherence_pending()   │
│   └───┬──────┘  run_coherence_check()       │
│       │                                     │
│       ▼                                     │
│   ┌────────┐                                │
│   │ ORIENT │  check_goals_health()          │
│   └───┬────┘  suggest_next_tasks()          │
│       │                                     │
│       ▼                                     │
│   ┌────────┐                                │
│   │ CLAIM  │  claim_task()                  │
│   └───┬────┘  quick_status("in_progress")   │
│       │                                     │
│       ▼                                     │
│   ┌────────┐                                │
│   │  WORK  │  get_task_context(depth=2)     │
│   └───┬────┘  recall_knowledge()            │
│       │       (do the actual work)          │
│       │                                     │
│       ▼                                     │
│   ┌────────┐                                │
│   │  LOG   │  quick_log() / add_learning()  │
│   └───┬────┘                                │
│       │                                     │
│       ▼                                     │
│   ┌────────┐                                │
│   │COMPLETE│  quick_status("completed")     │
│   └───┬────┘  release_task()                │
│       │                                     │
│       └─────────────► next ─────────────────┘
```

For the complete tool reference, see [SKILL.md](../../agent-planner-mcp/SKILL.md). For a quick reference card, see [AGENT_GUIDE.md](../../agent-planner-mcp/AGENT_GUIDE.md).

### Step 4: Best Practices

- **Always claim before working** — prevents two agents doing the same task
- **Log as you go** — use `decision` and `reasoning` log types for important choices (they survive compaction)
- **Record learnings** — `add_learning()` persists knowledge across plans and sessions
- **Use RPI for complex work** — `create_rpi_chain()` structures research → plan → implement
- **Check contradictions** — `check_contradictions()` before acting on old knowledge
- **Respect `plan_ready` gates** — mark plan tasks as `plan_ready` and wait for human approval

---

## Common Workflows

### "I want an agent to build something"

1. Create a **goal** describing what you want and what success looks like
2. The agent calls `check_goals_health()`, sees the new goal, and creates a plan
3. For complex tasks, the agent creates **RPI chains** (Research → Plan → Implement)
4. The agent researches, then marks the plan step as `plan_ready`
5. **You review and approve** (or redirect) the plan
6. The agent implements. You monitor via the Dashboard.

### "I want to understand what an agent did"

1. Open the **plan** → click a **task**
2. **Activity tab** — all logs: reasoning, decisions, challenges, progress
3. **Knowledge tab** — learnings recorded during this task
4. **Dependencies tab** — what blocked or unblocked this task
5. For the big picture, check **Goal health** → drill into bottlenecks

### "I want to redirect an agent"

1. **Block a task** — set status to `blocked` and add a log explaining why
2. **Change the approach** — update the task description or switch `task_mode`
3. **Answer a question** — resolve a pending item in the decision queue
4. **Re-prioritize** — reorder tasks so the agent picks up different work next

---

## Next Steps

| Resource | What it covers |
|---|---|
| [CONCEPTS.md](CONCEPTS.md) | Deep dive into every platform concept |
| [SKILL.md](../../agent-planner-mcp/SKILL.md) | Complete MCP tool reference (for agents) |
| [AGENT_GUIDE.md](../../agent-planner-mcp/AGENT_GUIDE.md) | Agent quick reference card |
| [API.md](API.md) | REST API reference (for developers) |
| [VISION.md](../../docs/VISION.md) | Full platform philosophy |
