# AgentPlanner v2 — Service Architecture Design Document

> **Status:** Draft  
> **Created:** 2026-02-14  
> **Depends on:** [v2-architecture.md](./v2-architecture.md) (core platform decisions)

---

## Table of Contents

1. [Overview](#1-overview)
2. [Service Map](#2-service-map)
3. [Goals System](#3-goals-system--first-class-driving-entities)
4. [Knowledge System](#4-knowledge-system--memories--context)
5. [Workflow Management & Visualization](#5-workflow-management--visualization)
6. [Modularity — Docker Compose Profiles](#6-modularity--docker-compose-profiles)
7. [OpenClaw Integration](#7-openclaw-integration)
8. [System Topology](#8-system-topology--how-it-all-connects)
9. [Messaging Adapter Interface](#9-messaging-adapter-interface)
10. [Security & Auth](#10-security--auth)
11. [API Route Namespace](#11-api-route-namespace)

---

## 1. Overview

The v2 service architecture extends the core platform — **Postgres**, **Hatchet**, **API**, and **Frontend** — with modular, opt-in components:

- **Messaging adapters** — Slack, Discord, webhooks via Hatchet workers
- **OpenClaw agent runtime** — autonomous agent execution
- **Knowledge system** — memory sync, semantic search, context visualization

Every component beyond the core is **optional**. Docker Compose profiles make the stack pluggable: spin up only what you need, from a minimal planning tool to a full agent-powered platform.

### Design Principles

| Principle | How |
|-----------|-----|
| **Single source of truth** | Postgres for all state — plans, goals, knowledge, auth |
| **Event-driven** | Hatchet as the nervous system; services communicate via events |
| **Pluggable** | Docker Compose profiles; no hard dependencies between optional services |
| **API-first** | All mutations go through the Node.js API; no direct DB access from clients |
| **Extractable modules** | Knowledge, goals, workflows start as API modules; can become microservices later |

---

## 2. Service Map

```
docker compose
│
├── postgres            Postgres 16 + pgvector         (shared data layer)
├── hatchet             Hatchet Lite                   (workflow engine + event bus)
├── api                 Node.js API                    (core: plans, goals, knowledge, auth, DAL)
├── frontend            React SPA                      (unified UI shell)
│
├── [messaging profile]
│   └── worker          Hatchet worker                 (Slack/Discord/webhook adapters)
│
├── [openclaw profile]
│   └── openclaw        OpenClaw gateway               (agent runtime)
│
└── [knowledge profile]
    └── knowledge-worker  Hatchet worker               (memory sync + embeddings)
```

### Service Responsibilities

| Service | Role | Depends On | Profile |
|---------|------|-----------|---------|
| **postgres** | Data storage, pgvector embeddings | — | core |
| **hatchet** | Workflow orchestration, event bus, cron | postgres | core |
| **api** | REST API, DAL, auth, WebSocket | postgres, hatchet | core |
| **frontend** | UI shell, dashboards | api | core |
| **worker** | Messaging adapter workflows | hatchet, api | `messaging` |
| **openclaw** | Agent runtime (OpenClaw gateway) | api | `openclaw` |
| **knowledge-worker** | Memory sync, embedding generation | postgres, hatchet | `knowledge` |

### Port Assignments

| Service | Internal Port | External Port |
|---------|--------------|---------------|
| postgres | 5432 | 5432 |
| hatchet | 8080 (API), 7077 (gRPC) | 8080, 7077 |
| api | 3000 | 3000 |
| frontend | 80 | 3001 |
| openclaw | 7680 | 7680 |

---

## 3. Goals System — First-Class Driving Entities

Goals are not labels on plans — they're the **steering wheel** for agents. Every plan, task, and agent action traces back to a goal. Goals form hierarchies, get evaluated over time, and drive what agents prioritize.

### 3.1 Data Model

```sql
-- Goals: the driving entities
CREATE TABLE goals (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title           TEXT NOT NULL,
    description     TEXT,
    owner_id        UUID NOT NULL REFERENCES users(id),
    type            TEXT NOT NULL CHECK (type IN ('outcome', 'constraint', 'metric', 'principle')),
    status          TEXT NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active', 'achieved', 'paused', 'abandoned')),
    success_criteria JSONB,          -- structured criteria for evaluation
    priority        INTEGER DEFAULT 0,
    parent_goal_id  UUID REFERENCES goals(id),  -- hierarchy
    created_at      TIMESTAMPTZ DEFAULT now(),
    updated_at      TIMESTAMPTZ DEFAULT now()
);

-- Links: connect goals to anything
CREATE TABLE goal_links (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    goal_id         UUID NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
    linked_type     TEXT NOT NULL CHECK (linked_type IN ('plan', 'task', 'agent', 'workflow')),
    linked_id       UUID NOT NULL,
    created_at      TIMESTAMPTZ DEFAULT now(),
    UNIQUE(goal_id, linked_type, linked_id)
);

-- Evaluations: periodic scoring by agents or humans
CREATE TABLE goal_evaluations (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    goal_id         UUID NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
    evaluated_at    TIMESTAMPTZ DEFAULT now(),
    evaluated_by    TEXT NOT NULL,       -- agent id or 'human:<user_id>'
    score           INTEGER CHECK (score BETWEEN 0 AND 100),
    reasoning       TEXT,
    suggested_actions JSONB,            -- [{action, priority, description}]
    created_at      TIMESTAMPTZ DEFAULT now()
);
```

### 3.2 Goal Types

| Type | Purpose | Example |
|------|---------|---------|
| **outcome** | Desired end state | "Launch MVP by March" |
| **constraint** | Boundary that must hold | "Stay under $500/mo infra" |
| **metric** | Measurable target | "99.9% uptime" |
| **principle** | Ongoing guideline | "Always write tests first" |

### 3.3 Agent Integration

When Hatchet dispatches a task to an agent, it injects the relevant active goals as context:

```typescript
// In Hatchet workflow step
const taskGoals = await goalsDal.getLinkedGoals('task', taskId);
const planGoals = await goalsDal.getLinkedGoals('plan', task.planId);

const agentContext = {
  task,
  goals: [...taskGoals, ...planGoals].map(g => ({
    title: g.title,
    type: g.type,
    criteria: g.success_criteria,
    priority: g.priority,
  })),
};

// Dispatch to agent with goal context
await hatchet.event('agent.task.dispatch', { ...agentContext });
```

**Cron evaluation workflow:** Agents periodically evaluate goals and report progress:

```typescript
// Registered as Hatchet cron: "0 */6 * * *" (every 6 hours)
const goalEvaluationWorkflow = hatchet.workflow('goal.evaluate', {
  steps: [
    {
      name: 'fetch-active-goals',
      fn: async (ctx) => {
        return await goalsDal.findByStatus('active');
      },
    },
    {
      name: 'evaluate-each',
      fn: async (ctx) => {
        for (const goal of ctx.steps['fetch-active-goals'].output) {
          await hatchet.event('agent.goal.evaluate', { goal });
        }
      },
    },
  ],
});
```

### 3.4 API Endpoints

```
GET    /api/goals                    — list goals (filterable by status, type, owner)
POST   /api/goals                    — create goal
GET    /api/goals/:id                — get goal with links and recent evaluations
PUT    /api/goals/:id                — update goal
DELETE /api/goals/:id                — soft-delete (set status=abandoned)

POST   /api/goals/:id/links          — link goal to plan/task/agent/workflow
DELETE /api/goals/:id/links/:linkId   — remove link

POST   /api/goals/:id/evaluations     — submit evaluation
GET    /api/goals/:id/evaluations     — evaluation history

GET    /api/goals/tree                — full hierarchy tree for owner
```

### 3.5 UI: Goals Dashboard

```
┌─────────────────────────────────────────────────────────────┐
│  Goals Dashboard                                [+ New Goal] │
├──────────────────────┬──────────────────────────────────────┤
│                      │                                      │
│  Goal Hierarchy      │  Selected Goal: "Launch MVP"         │
│                      │                                      │
│  ▼ Launch MVP        │  Type: outcome    Status: active     │
│    ├─ Build API      │  Priority: ████████░░ 80             │
│    ├─ Design UI      │                                      │
│    └─ Write Tests    │  ── Linked Items ──                  │
│  ▼ Stay Under Budget │  Plan: "Q1 Roadmap"                  │
│    └─ Optimize Infra │  Tasks: 12 linked (8 done, 4 open)  │
│  ► Code Quality      │                                      │
│                      │  ── Evaluation Timeline ──           │
│                      │  Feb 14  Agent  72/100 ██████▓░░░   │
│                      │  Feb 12  Human  65/100 █████▓░░░░   │
│                      │  Feb 10  Agent  58/100 ████▓░░░░░   │
│                      │                                      │
│                      │  ── Progress ──                      │
│                      │  ▁▂▃▃▅▅▆▇ (sparkline)               │
└──────────────────────┴──────────────────────────────────────┘
```

---

## 4. Knowledge System — Memories & Context

The knowledge system captures, indexes, and surfaces context from all sources: agent memories (OpenClaw), user notes, documents, and agent-generated insights.

### 4.1 Data Model

```sql
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE knowledge_items (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source      TEXT NOT NULL CHECK (source IN ('openclaw', 'agent', 'user', 'document')),
    content     TEXT NOT NULL,
    embedding   vector(1536),           -- OpenAI text-embedding-3-small
    metadata    JSONB DEFAULT '{}',     -- {file_path, agent_id, tags[], topic}
    plan_id     UUID REFERENCES plans(id),
    created_at  TIMESTAMPTZ DEFAULT now(),
    updated_at  TIMESTAMPTZ DEFAULT now()
);

-- Indexes for performance
CREATE INDEX idx_knowledge_embedding ON knowledge_items
    USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
CREATE INDEX idx_knowledge_source ON knowledge_items(source);
CREATE INDEX idx_knowledge_plan ON knowledge_items(plan_id);
CREATE INDEX idx_knowledge_metadata ON knowledge_items USING gin(metadata);
```

### 4.2 Semantic Search

```typescript
// dal/knowledge.dal.ts
async function search(query: string, opts?: { limit?: number; planId?: string; source?: string }) {
  const embedding = await generateEmbedding(query);

  return db.execute(sql`
    SELECT id, source, content, metadata, plan_id,
           1 - (embedding <=> ${embedding}::vector) AS similarity
    FROM knowledge_items
    WHERE (${ opts?.planId ? sql`plan_id = ${opts.planId} AND` : sql`` } TRUE)
      AND (${ opts?.source ? sql`source = ${opts.source} AND` : sql`` } TRUE)
    ORDER BY embedding <=> ${embedding}::vector
    LIMIT ${opts?.limit ?? 20}
  `);
}
```

### 4.3 OpenClaw Memory Sync

The **knowledge-worker** runs as a Hatchet cron workflow, syncing OpenClaw memory files into the knowledge store:

```
┌──────────────┐     cron (every 15m)     ┌───────────────────┐
│   OpenClaw   │ ──── read workspace ────→ │ Knowledge Worker  │
│  /workspace  │                           │                   │
│  memory/     │                           │  1. Diff files    │
│  MEMORY.md   │                           │  2. Parse content │
│  *.md        │                           │  3. Embed via API │
└──────────────┘                           │  4. Upsert to DB  │
                                           └───────────────────┘
```

```typescript
const memorySyncWorkflow = hatchet.workflow('knowledge.sync-openclaw', {
  on: { cron: '*/15 * * * *' },
  steps: [
    {
      name: 'scan-workspace',
      fn: async (ctx) => {
        const files = await scanOpenClawWorkspace('/openclaw/workspace');
        const existing = await knowledgeDal.getBySource('openclaw');
        return diffFiles(files, existing);
      },
    },
    {
      name: 'embed-and-upsert',
      fn: async (ctx) => {
        const { added, modified, deleted } = ctx.steps['scan-workspace'].output;
        for (const file of [...added, ...modified]) {
          const embedding = await generateEmbedding(file.content);
          await knowledgeDal.upsert({
            source: 'openclaw',
            content: file.content,
            embedding,
            metadata: { file_path: file.path, tags: extractTags(file.content) },
          });
        }
        for (const file of deleted) {
          await knowledgeDal.deleteByMetadata({ file_path: file.path });
        }
      },
    },
  ],
});
```

### 4.4 API Endpoints

```
GET    /api/knowledge              — list items (paginated, filterable)
POST   /api/knowledge              — create item (auto-embeds)
GET    /api/knowledge/:id          — get single item
PUT    /api/knowledge/:id          — update (re-embeds)
DELETE /api/knowledge/:id          — delete

POST   /api/knowledge/search       — semantic search { query, limit?, planId?, source? }
GET    /api/knowledge/graph        — similarity graph data { threshold?, planId? }
```

### 4.5 UI Views

**Timeline View** — Chronological feed of all knowledge items:
```
┌─────────────────────────────────────────────────────────────┐
│  Knowledge Timeline            [Search...] [Filter ▾]       │
├─────────────────────────────────────────────────────────────┤
│  🤖 openclaw  •  14 Feb 16:00                               │
│  Memory update: Completed API refactor for goals system.    │
│  Tags: api, goals, refactor                                 │
│  ─────────────────────────────────────────────────────────  │
│  👤 user  •  14 Feb 14:30                                   │
│  Decision: Use pgvector over Pinecone for cost reasons.     │
│  Linked to: Q1 Infrastructure Plan                          │
│  ─────────────────────────────────────────────────────────  │
│  📄 document  •  14 Feb 10:00                               │
│  Imported: API Design Guidelines (v3)                       │
└─────────────────────────────────────────────────────────────┘
```

**Graph View** — Nodes connected by semantic similarity:
```
                    ┌──────────┐
               ┌────┤ pgvector │
               │    │ decision │
               │    └──────────┘
        ┌──────┴───┐         ┌────────────┐
        │ infra    │─────────┤ cost       │
        │ planning │         │ analysis   │
        └──────┬───┘         └────────────┘
               │    ┌──────────┐
               └────┤ database │
                    │ schema   │
                    └──────────┘
```

---

## 5. Workflow Management & Visualization

Hatchet provides the workflow engine; AgentPlanner surfaces it in the UI for visibility and control.

### 5.1 What We Surface

| View | Data Source | Description |
|------|-----------|-------------|
| **Templates** | Code-defined workflows | Available workflow patterns (adapter dispatch, goal eval, sync) |
| **Active Runs** | Hatchet status API | Currently executing workflows with step progress |
| **Run History** | Hatchet status API | Past runs with success/failure, duration, retries |
| **Event Log** | Hatchet events | Stream of events flowing through the system |

### 5.2 API Proxy Layer

The API proxies Hatchet's admin API to avoid exposing Hatchet directly:

```typescript
// routes/workflows.routes.ts
router.get('/api/workflows/runs', auth, async (req, res) => {
  const runs = await hatchetAdmin.listWorkflowRuns({
    status: req.query.status,
    limit: req.query.limit ?? 50,
  });
  res.json(runs);
});

router.get('/api/workflows/runs/:runId', auth, async (req, res) => {
  const run = await hatchetAdmin.getWorkflowRun(req.params.runId);
  res.json(run);
});

router.get('/api/workflows/templates', auth, async (req, res) => {
  const workflows = await hatchetAdmin.listWorkflows();
  res.json(workflows);
});
```

### 5.3 UI: Workflow Panel

```
┌─────────────────────────────────────────────────────────────┐
│  Workflows                                                   │
├──────────┬──────────────────────────────────────────────────┤
│          │                                                  │
│ Templates│  Run: agent.task.dispatch #a3f2                  │
│ ─────────│  Status: ● Running         Started: 2m ago      │
│ ○ Agent  │                                                  │
│   Dispatch│  Steps:                                         │
│ ○ Goal   │  ✅ fetch-task          0.2s                     │
│   Eval   │  ✅ inject-goals        0.5s                     │
│ ○ Memory │  ⏳ dispatch-to-agent   running...               │
│   Sync   │  ○ process-response     pending                  │
│ ○ Slack  │  ○ update-plan          pending                  │
│   Notify │                                                  │
│          │  [Cancel Run]  [Retry]                           │
└──────────┴──────────────────────────────────────────────────┘
```

**Future:** Visual DAG editor for composing custom workflows.

---

## 6. Modularity — Docker Compose Profiles

### 6.1 Profile Layout

```yaml
services:
  # ── Core (always on) ─────────────────────────────────────
  postgres:
    image: postgres:16-alpine
    volumes:
      - pgdata:/var/lib/postgresql/data
    environment:
      POSTGRES_DB: agentplanner
      POSTGRES_USER: agentplanner
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U agentplanner"]
      interval: 5s

  hatchet:
    image: ghcr.io/hatchet-dev/hatchet/hatchet-lite:latest
    depends_on:
      postgres:
        condition: service_healthy
    environment:
      DATABASE_URL: postgres://agentplanner:${POSTGRES_PASSWORD}@postgres:5432/agentplanner

  api:
    build: ./api
    depends_on:
      postgres:
        condition: service_healthy
      hatchet:
        condition: service_started
    environment:
      DATABASE_URL: postgres://agentplanner:${POSTGRES_PASSWORD}@postgres:5432/agentplanner
      HATCHET_CLIENT_TOKEN: ${HATCHET_TOKEN}
      JWT_SECRET: ${JWT_SECRET}
    ports:
      - "3000:3000"

  frontend:
    build: ./frontend
    depends_on: [api]
    ports:
      - "3001:80"

  # ── Messaging Profile ───────────────────────────────────
  worker:
    build: ./worker
    depends_on: [hatchet, api]
    profiles: [messaging]
    environment:
      HATCHET_CLIENT_TOKEN: ${HATCHET_TOKEN}
      SLACK_BOT_TOKEN: ${SLACK_BOT_TOKEN:-}
      DISCORD_TOKEN: ${DISCORD_TOKEN:-}

  # ── OpenClaw Profile ────────────────────────────────────
  openclaw:
    image: ghcr.io/openclaw/openclaw:latest
    profiles: [openclaw]
    depends_on: [api]
    volumes:
      - openclaw-workspace:/workspace
    environment:
      OPENCLAW_API_URL: http://api:3000

  # ── Knowledge Profile ───────────────────────────────────
  knowledge-worker:
    build: ./knowledge-worker
    profiles: [knowledge]
    depends_on:
      postgres:
        condition: service_healthy
      hatchet:
        condition: service_started
    volumes:
      - openclaw-workspace:/openclaw/workspace:ro
    environment:
      DATABASE_URL: postgres://agentplanner:${POSTGRES_PASSWORD}@postgres:5432/agentplanner
      HATCHET_CLIENT_TOKEN: ${HATCHET_TOKEN}
      OPENAI_API_KEY: ${OPENAI_API_KEY}

volumes:
  pgdata:
  openclaw-workspace:
```

### 6.2 Usage

```bash
# Minimal — just the planning tool
docker compose up

# With messaging adapters (Slack, Discord, webhooks)
docker compose --profile messaging up

# With OpenClaw agent runtime
docker compose --profile openclaw up

# Full stack — everything
docker compose --profile messaging --profile openclaw --profile knowledge up

# Production with detach
docker compose --profile messaging --profile openclaw --profile knowledge up -d
```

### 6.3 Profile Dependencies

```
knowledge ──requires──→ openclaw (for workspace volume)
                    ──→ core

messaging ──requires──→ core

openclaw ──requires──→ core
```

> **Note:** The knowledge worker reads from the OpenClaw workspace volume. If OpenClaw isn't running, the sync workflow gracefully skips (no files to diff).

---

## 7. OpenClaw Integration

### 7.1 Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                       AgentPlanner                           │
│                                                              │
│  ┌─────────┐    events     ┌─────────┐     REST     ┌─────┐ │
│  │ Hatchet │──────────────→│ OpenClaw│────────────→ │ API │ │
│  │         │←──────────────│ Adapter │←────────────│     │ │
│  └─────────┘               └────┬────┘             └─────┘ │
│                                 │                            │
│                         ┌───────▼───────┐                    │
│                         │   OpenClaw    │                    │
│                         │   Gateway     │                    │
│                         │               │                    │
│                         │  ┌─────────┐  │                    │
│                         │  │ Agent   │  │                    │
│                         │  │ Session │  │                    │
│                         │  └─────────┘  │                    │
│                         │  /workspace   │                    │
│                         └───────────────┘                    │
└──────────────────────────────────────────────────────────────┘
```

### 7.2 Inbound: Dispatching Tasks to Agents

```
API creates task
  → Hatchet event: "agent.task.dispatch"
  → OpenClaw adapter workflow:
      1. Fetch task details + goal context
      2. Format prompt with task + goals + knowledge context
      3. Send to OpenClaw gateway API
      4. OpenClaw creates agent session
      5. Agent executes task
```

### 7.3 Outbound: Agent Reports Back

The OpenClaw agent uses **MCP tools** or the **REST API** to interact with AgentPlanner:

```typescript
// Agent can call these via MCP or REST:
POST /api/plans/:planId/nodes/:nodeId/complete    // mark task done
POST /api/goals/:goalId/evaluations               // evaluate a goal
POST /api/knowledge                                // log knowledge/insight
PUT  /api/plans/:planId/nodes/:nodeId              // update task details
```

### 7.4 Memory Sync Flow

```
OpenClaw agent writes to /workspace/memory/2026-02-14.md
                                    │
                         ┌──────────▼──────────┐
                         │  Knowledge Worker   │
                         │  (cron: */15 * * *) │
                         │                     │
                         │  1. Scan /workspace │
                         │  2. Diff with DB    │
                         │  3. Embed new/changed│
                         │  4. Upsert to DB    │
                         └──────────┬──────────┘
                                    │
                         ┌──────────▼──────────┐
                         │     Postgres        │
                         │  knowledge_items    │
                         │  + pgvector index   │
                         └─────────────────────┘
```

### 7.5 Configuration

```yaml
# OpenClaw gateway config (openclaw.yaml)
gateway:
  api_url: http://api:3000
  api_token: ${AGENTPLANNER_API_TOKEN}
  workspace: /workspace
  
  # MCP tools registered for agent use
  tools:
    - agentplanner-plans
    - agentplanner-goals
    - agentplanner-knowledge
```

---

## 8. System Topology — How It All Connects

### 8.1 Conceptual Flow

```
Goals ───drive───→ Plans ───generate───→ Tasks
  ↑                                        │
  │                Workflows               │
  │           (Hatchet orchestrates)       ↓
  │                                     Agents
  │                                   (OpenClaw)
  └──evaluate───── Knowledge ←──learn──┘
```

### 8.2 Data Flow

```
┌─────────┐     ┌─────────┐     ┌──────────┐     ┌──────────┐
│  User   │────→│   API   │────→│ Postgres │←────│ Hatchet  │
│(Frontend│←────│ (Hub)   │←────│ (Truth)  │     │(Nervous  │
│  + WS)  │     │         │     │          │     │ System)  │
└─────────┘     └────┬────┘     └──────────┘     └────┬─────┘
                     │                                 │
              ┌──────┴──────┐                   ┌──────┴──────┐
              │   Events    │                   │  Workflows  │
              └──────┬──────┘                   └──────┬──────┘
                     │                                 │
         ┌───────────┼───────────┐          ┌──────────┼──────────┐
         ▼           ▼           ▼          ▼          ▼          ▼
    ┌─────────┐ ┌─────────┐ ┌────────┐ ┌────────┐ ┌────────┐ ┌───────┐
    │  Slack  │ │ Discord │ │Webhook │ │OpenClaw│ │Goal    │ │Memory │
    │ Adapter │ │ Adapter │ │Adapter │ │Adapter │ │Eval    │ │Sync   │
    └─────────┘ └─────────┘ └────────┘ └────────┘ └────────┘ └───────┘
```

### 8.3 Component Roles Summary

| Component | Role |
|-----------|------|
| **API** | The hub — all reads/writes funnel through here |
| **Hatchet** | The nervous system — orchestrates async work, events, cron |
| **Postgres** | Single source of truth — all state lives here |
| **Frontend** | The eyes — unified view of plans, goals, knowledge, workflows |
| **Workers** | The hands — execute side effects (messaging, sync, evaluation) |
| **OpenClaw** | The brain — autonomous agent execution |

---

## 9. Messaging Adapter Interface

> Carried forward from [v2-architecture.md](./v2-architecture.md).

### 9.1 Adapter Interface

```typescript
interface MessagingAdapter {
  name: string;

  // Lifecycle
  initialize(config: AdapterConfig): Promise<void>;
  shutdown(): Promise<void>;

  // Outbound
  sendAgentRequest(request: AgentRequest): Promise<DeliveryResult>;
  sendDecisionNotification(decision: Decision): Promise<DeliveryResult>;
  sendMessage(userId: string, message: string): Promise<DeliveryResult>;

  // Inbound (registered as Hatchet event handlers)
  onAgentResponse?(response: AgentResponse): Promise<void>;
}

interface AdapterConfig {
  adapter: string;            // 'slack' | 'discord' | 'webhook' | 'openclaw'
  credentials: Record<string, string>;
  options?: Record<string, unknown>;
}

interface DeliveryResult {
  success: boolean;
  externalId?: string;        // platform-specific message ID
  error?: string;
}
```

### 9.2 Event Flow

```
Outbound:
  API → event("adapter.send.{type}") → Hatchet → Worker → Adapter → External Platform

Inbound:
  External Platform → Webhook/WS → Worker → event("agent.response.received") → Hatchet → API

Event Types:
  adapter.send.agent-request        — dispatch agent request to adapters
  adapter.send.decision             — notify about decision needed
  adapter.send.message              — generic message delivery
  agent.response.received           — agent replied (from any adapter)
  agent.task.dispatch               — task assigned to agent
  agent.goal.evaluate               — goal evaluation requested
  knowledge.sync.triggered          — memory sync cycle started
```

### 9.3 Adapter Data Model

```sql
CREATE TABLE messaging_integrations (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES users(id),
    adapter     TEXT NOT NULL,          -- 'slack', 'discord', 'webhook', 'openclaw'
    config      JSONB NOT NULL,         -- encrypted credentials + options
    enabled     BOOLEAN DEFAULT true,
    created_at  TIMESTAMPTZ DEFAULT now(),
    updated_at  TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE message_deliveries (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    integration_id  UUID REFERENCES messaging_integrations(id),
    event_type      TEXT NOT NULL,
    payload         JSONB NOT NULL,
    status          TEXT DEFAULT 'pending'
                    CHECK (status IN ('pending', 'sent', 'failed', 'retrying')),
    external_id     TEXT,
    attempts        INTEGER DEFAULT 0,
    last_error      TEXT,
    created_at      TIMESTAMPTZ DEFAULT now(),
    delivered_at    TIMESTAMPTZ
);
```

---

## 10. Security & Auth

### 10.1 Auth Architecture

> Migration from Supabase Auth → custom JWT + passport.js (see [v2-architecture.md](./v2-architecture.md) §2.4).

```
Request
  │
  ├── Authorization: Bearer <JWT>
  │     → jsonwebtoken.verify(token, JWT_SECRET)
  │     → Load user from DB
  │
  ├── x-api-key: <token>
  │     → Lookup in api_tokens table
  │     → Load user from DB
  │
  └── No auth → 401 Unauthorized
```

### 10.2 Service-to-Service Auth

Internal services (worker, knowledge-worker, openclaw) authenticate to the API using **service tokens**:

```yaml
# Generated at startup, stored in env
API_SERVICE_TOKEN: ${SERVICE_TOKEN}
```

```typescript
// Service requests include:
headers: {
  'Authorization': `Service ${SERVICE_TOKEN}`,
  'X-Service-Name': 'knowledge-worker',
}
```

### 10.3 Security Boundaries

| Boundary | Protection |
|----------|-----------|
| Frontend → API | JWT auth, CORS |
| Worker → API | Service token |
| OpenClaw → API | Service token + scoped permissions |
| Knowledge Worker → Postgres | Direct connection (internal network) |
| External → Hatchet | Not exposed externally; API proxies |

### 10.4 Secrets Management

```bash
# .env (never committed)
POSTGRES_PASSWORD=...
JWT_SECRET=...
HATCHET_TOKEN=...
SERVICE_TOKEN=...
OPENAI_API_KEY=...
SLACK_BOT_TOKEN=...
DISCORD_TOKEN=...
```

---

## 11. API Route Namespace

```
/api/auth/*          — login, register, tokens, OAuth callbacks
/api/plans/*         — plans, nodes, collaborators, comments
/api/goals/*         — goals, evaluations, links, hierarchy
/api/knowledge/*     — knowledge items, search, graph
/api/workflows/*     — workflow runs, templates, event log
/api/agents/*        — agent management, heartbeats, sessions
/api/admin/*         — system config, adapter management, health
```

### Route Details

| Route | Methods | Description |
|-------|---------|-------------|
| `/api/auth/login` | POST | Email/password login → JWT |
| `/api/auth/github` | GET | GitHub OAuth initiation |
| `/api/auth/github/callback` | GET | GitHub OAuth callback |
| `/api/auth/tokens` | GET, POST, DELETE | API token management |
| `/api/plans` | GET, POST | List/create plans |
| `/api/plans/:id` | GET, PUT, DELETE | Single plan CRUD |
| `/api/plans/:id/nodes` | GET, POST | Plan nodes |
| `/api/plans/:id/nodes/:nodeId` | GET, PUT, DELETE | Single node CRUD |
| `/api/plans/:id/collaborators` | GET, POST, DELETE | Plan sharing |
| `/api/goals` | GET, POST | List/create goals |
| `/api/goals/:id` | GET, PUT, DELETE | Single goal CRUD |
| `/api/goals/:id/links` | GET, POST, DELETE | Goal ↔ entity links |
| `/api/goals/:id/evaluations` | GET, POST | Evaluation history |
| `/api/goals/tree` | GET | Hierarchical goal tree |
| `/api/knowledge` | GET, POST | List/create knowledge items |
| `/api/knowledge/:id` | GET, PUT, DELETE | Single item CRUD |
| `/api/knowledge/search` | POST | Semantic search |
| `/api/knowledge/graph` | GET | Similarity graph data |
| `/api/workflows/runs` | GET | List workflow runs |
| `/api/workflows/runs/:id` | GET | Single run details |
| `/api/workflows/templates` | GET | Available workflow templates |
| `/api/agents` | GET, POST | List/register agents |
| `/api/agents/:id/heartbeat` | POST | Agent heartbeat |
| `/api/admin/health` | GET | System health check |
| `/api/admin/adapters` | GET, POST, PUT, DELETE | Adapter config management |

---

## Appendix: Technology Stack

| Layer | Technology | Notes |
|-------|-----------|-------|
| Database | Postgres 16 + pgvector | Single instance, shared |
| ORM | Drizzle ORM | Type-safe schema + queries |
| Migrations | Drizzle Kit | Schema-driven migrations |
| Workflows | Hatchet Lite | Durable execution, events, cron |
| API | Node.js + Express | REST + WebSocket |
| Auth | passport.js + jsonwebtoken | GitHub OAuth + email/password |
| Frontend | React | SPA with goals, knowledge, workflow dashboards |
| Agent Runtime | OpenClaw | Optional, profile-gated |
| Embeddings | OpenAI text-embedding-3-small | 1536 dimensions |
| Vector Search | pgvector (ivfflat) | Cosine similarity |
| Containerization | Docker Compose | Profiles for modularity |
