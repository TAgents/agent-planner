# AgentPlanner v2 — Architecture Design Document

## 1. Overview

AgentPlanner v2 replaces Supabase with direct Postgres (via Drizzle ORM) and adds Hatchet as the workflow engine and event bus. The result is a fully portable, self-hostable platform that runs with `docker compose`.

```
┌─────────────────────────────────────────────────────────────┐
│                     docker compose                          │
│                                                             │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌────────────┐  │
│  │ Postgres │  │ Hatchet  │  │  API     │  │  Frontend  │  │
│  │  (data)  │◄─┤ (engine) │◄─┤ (Node)   │  │  (React)   │  │
│  └──────────┘  └──────────┘  └──────────┘  └────────────┘  │
│       ▲              ▲             ▲                         │
│       │              │             │                         │
│       └──────────────┴─────────────┘                        │
│                                                             │
│  ┌──────────────────────────────────────────────────────┐   │
│  │              Hatchet Workers (adapters)               │   │
│  │  ┌─────────┐ ┌─────────┐ ┌──────────┐ ┌───────────┐ │   │
│  │  │  Slack  │ │ Webhook │ │ OpenClaw │ │  Discord  │ │   │
│  │  └─────────┘ └─────────┘ └──────────┘ └───────────┘ │   │
│  └──────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

## 2. Key Architectural Decisions

### 2.1 Postgres + Drizzle ORM (replacing Supabase)

**Why:** Supabase locks us to their client library, auth system, and hosting. Direct Postgres is portable to any cloud, VPS, or local machine.

**Approach:**
- **Drizzle ORM** for type-safe schema definitions and queries
- **Drizzle Kit** for migrations (replacing the current SQL file approach)
- All 27 current SQL migrations consolidated into a single Drizzle schema
- Connection pooling via `pg` Pool (already used in `db/init.js`)

**Current Supabase usage to replace:**

| Usage | Count | Replacement |
|-------|-------|-------------|
| `.from('table').select/insert/update/delete` | ~220 calls across 15 controllers | Drizzle query builder via DAL layer |
| `supabase.auth.setSession/getUser` | 3 calls in auth middleware | Custom JWT + passport.js |
| `supabaseAdmin.auth.admin.*` | 2 calls in db/init.js | Direct user table management |
| Supabase Realtime (websockets) | 0 (already custom WS) | No change needed |
| Supabase Storage | 1 controller (uploads) | Local filesystem or S3-compatible |

### 2.2 Hatchet — Workflow Engine & Event Bus

**Why:** Hatchet gives us durable task execution, event-driven workflows, and a pub/sub system — all backed by the same Postgres instance. No extra infra (Redis, RabbitMQ, etc.).

**How it fits:**

```
User clicks "Ask Agent" 
  → API creates agent_request record
  → API triggers Hatchet event: "agent.request.created"
  → Hatchet dispatches to registered adapter workflows:
      - Slack adapter → posts to configured Slack channel
      - Webhook adapter → POSTs to webhook URL
      - OpenClaw adapter → sends via OpenClaw session
  → Agent responds (via any channel)
  → Response flows back through Hatchet event: "agent.response.received"
  → API updates the agent_request record
```

**Hatchet deployment:** `hatchet-lite` Docker image (single container, uses our Postgres).

**Key Hatchet features we'll use:**
- **Tasks** — atomic functions (send Slack message, POST webhook, etc.)
- **DAG workflows** — compose multi-step agent interactions
- **Event triggers** — `run-on-event` for pub/sub messaging
- **Cron runs** — scheduled health checks, cleanup jobs
- **Durable execution** — retry failed deliveries automatically
- **Child spawning** — fan-out to multiple adapters simultaneously

### 2.3 Data Access Layer (DAL)

Instead of replacing Supabase calls inline, introduce a DAL that encapsulates all database access:

```
src/
  dal/
    index.ts          # re-exports all DALs
    plans.dal.ts      # plans + plan_nodes + plan_collaborators
    users.dal.ts      # users + auth
    goals.dal.ts      # goals + plan_goals
    activity.dal.ts   # plan_comments + plan_node_logs
    agents.dal.ts     # agent_heartbeats + decision_requests + node_assignments
    tokens.dal.ts     # api_tokens
```

Controllers call DAL functions instead of Supabase directly:

```javascript
// Before (v1)
const { data, error } = await supabaseAdmin
  .from('plans')
  .select('*')
  .eq('id', planId)
  .single();

// After (v2)
const plan = await plansDal.findById(planId);
```

### 2.4 Auth — Custom JWT + passport.js

Replace Supabase Auth with:

1. **GitHub OAuth** via passport.js (already the primary login method)
2. **Email/password** via bcrypt + custom JWT issuance
3. **API tokens** — already custom, no Supabase dependency
4. **JWT verification** — replace `supabase.auth.getUser()` with `jsonwebtoken.verify()`

Auth middleware flow:
```
Request → Check Authorization header
  → Bearer token? → Verify JWT signature → Load user from DB
  → x-api-key? → Look up in api_tokens table → Load user from DB
  → No auth? → 401
```

### 2.5 Messaging Adapter Interface

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
```

Each adapter is a Hatchet worker that:
1. Registers workflows for outbound message types
2. Listens for inbound events from its platform
3. Translates between AgentPlanner's internal format and the platform's API

## 3. Database Schema (Drizzle)

### Core tables (keep):
- `users` — add password_hash, remove Supabase UID dependency
- `plans`, `plan_nodes`, `plan_collaborators`, `plan_comments`
- `plan_node_logs`, `plan_node_labels`
- `goals`, `plan_goals`
- `api_tokens`, `user_sessions` (new, replaces Supabase sessions)
- `decision_requests`, `node_assignments`, `agent_heartbeats`
- `audit_logs`

### New tables:
- `messaging_integrations` — adapter configs per user/org (replaces `slack_integrations`)
- `message_deliveries` — delivery tracking for all adapters
- `hatchet_events` — event log (optional, Hatchet tracks internally)

### Drop tables:
- `webhook_deliveries` — replaced by `message_deliveries`
- `knowledge_stores`, `knowledge_entries` — removed in pre-v2 cleanup
- `plan_stars`, `plan_templates`, `pending_invites` — removed
- `organizations`, `organization_members` — removed
- `email_verification_tokens`, `password_reset_tokens` — simplify

## 4. Migration Path

### Phase 2 approach (Supabase → Postgres):
1. Create Drizzle schema matching current tables
2. Build DAL layer with same function signatures
3. Replace Supabase calls in controllers one-by-one (biggest files first: node.controller 54 calls, plan.controller 52 calls)
4. Replace auth middleware last (most sensitive)
5. Remove `@supabase/supabase-js` dependency
6. Test against same Postgres instance (Supabase uses Postgres underneath)

### Data migration:
- Export from Supabase Postgres → Import to self-managed Postgres
- Auth users: export from `auth.users` → import to `users` table with hashed passwords
- No data transformation needed — same Postgres, same schema

## 5. Docker Compose Architecture

```yaml
services:
  postgres:
    image: postgres:18.1-alpine
    volumes:
      - pgdata:/var/lib/postgresql/data
    
  hatchet:
    image: ghcr.io/hatchet-dev/hatchet/hatchet-lite:latest
    depends_on: [postgres]
    environment:
      DATABASE_URL: postgres://...
    
  api:
    build: ./api
    depends_on: [postgres, hatchet]
    environment:
      DATABASE_URL: postgres://...
      HATCHET_CLIENT_TOKEN: ...
    
  worker:
    build: ./worker
    depends_on: [hatchet]
    # Runs messaging adapters as Hatchet workers
    
  frontend:
    build: ./frontend
    depends_on: [api]

volumes:
  pgdata:
```

## 6. Technology Summary

| Component | v1 (Current) | v2 (Target) |
|-----------|-------------|-------------|
| Database | Supabase (managed Postgres) | Direct Postgres + Drizzle ORM |
| Auth | Supabase Auth | passport.js + custom JWT |
| Migrations | Raw SQL files in src/db/sql/ | Drizzle Kit |
| Task queue | None (synchronous) | Hatchet |
| Event bus | None | Hatchet events |
| Messaging | Direct Slack API calls | Hatchet adapter workers |
| Storage | Supabase Storage | Local FS / S3-compatible |
| Deployment | Supabase Cloud + Cloud Run | docker compose (anywhere) |

## 7. Risk Assessment

| Risk | Mitigation |
|------|-----------|
| Hatchet adds operational complexity | hatchet-lite single container, shares our Postgres |
| Auth migration breaks existing users | JWT token format stays same, just change issuer |
| DAL layer is large refactor (~220 Supabase calls) | Do it incrementally, controller by controller |
| Drizzle migration from raw SQL | One-time schema generation from existing DB |
| Hatchet is relatively new | MIT licensed, can fall back to BullMQ if needed |
