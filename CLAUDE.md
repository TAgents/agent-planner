# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

The repository root (`../CLAUDE.md`) describes the broader Talking Agents monorepo and shared architecture. This file is the backend-specific guide.

## What this is

`agent-planner` is the **REST API backend** for AgentPlanner — hierarchical plans, dependency graph, progressive context engine, Graphiti knowledge integration, and WebSocket collaboration. Node.js + Express + PostgreSQL 17 (pgvector) + Drizzle ORM. License BUSL-1.1.

## Commands

```bash
npm run dev                    # nodemon hot reload
npm start                      # production
npm run lint

# Tests (Jest + Supertest, 30s timeout)
npm test                       # all
npm run test:integration       # tests/integration only (--runInBand)
npm run test:e2e               # tests/e2e only (--runInBand)
npm run test:watch
npm run test:coverage
npm run test:ci                # --ci --maxWorkers=2
npx jest tests/integration/plans.test.js                   # single file
npx jest --testPathPattern="plans" -t "should create"      # by name
npx jest tests/integration/graphiti.test.js                # needs running stack + API_TOKEN env

# Database (Drizzle Kit, config: drizzle.config.mjs)
npm run db:push                # push schema directly (dev)
npm run db:generate            # generate migration from schema diff
npm run db:migrate             # apply migration files (prod)
npm run db:studio              # browser DB inspector

# OpenAPI / Swagger
npm run docs:generate          # build OpenAPI from JSDoc annotations
npm run docs:validate
npm run docs:all               # generate + validate (run after touching routes)
```

Swagger UI: `http://localhost:3000/api-docs` once the server is running.

### Docker Compose profiles (run from this directory)

```bash
docker compose --profile core up -d                       # postgres + api only
docker compose --profile core --profile knowledge up -d   # + falkordb + graphiti
docker compose -f docker-compose.local.yml up --build     # full stack (postgres 5433, api 3000, ui 3001, mcp 3100). Needs OPENAI_API_KEY.
docker compose -f docker-compose.dev.yml up               # same services, bind-mounts ../agent-planner-ui, ./, ../agent-planner-mcp for hot reload
docker compose -f docker-compose.prod.yml ...             # production compose
```

`LOCAL_QUICKSTART.md` is the blessed 5-minute path for new contributors.

## Architecture — layers and where logic lives

```
HTTP request
  → routes/*.routes.js              (Express router + Swagger JSDoc + middleware wiring)
    → controllers/*.controller.v2.js (thin: parse req → call service → return res; ~200 lines)
      → domains/<x>/services/        (business logic: validation, orchestration, notifications, broadcasting)
        → domains/<x>/repositories/  (domain-shaped data access facade)
          → db/dal/*.dal.mjs         (raw DB queries — the ONLY layer that touches the DB)
            → db/schema/*.mjs        (Drizzle table definitions)
```

**Rules of thumb:**
- Controllers must stay thin. If you're adding validation or fan-out logic, it belongs in a service.
- Never query the DB from a controller or service directly — always go through a DAL.
- The DAL is centralized in `db/dal/index.mjs` (ESM). CommonJS code reaches DAL via the lazy bridge `db/dal.cjs`.

**Domains** (`src/domains/`) — each owns its routes + controller + service + repository: `node`, `plan`, `decision`, `dependency`, `goal`, `knowledge`, `collaboration`, `search`, `agent`. `src/routes/`, `src/controllers/` hold the older/cross-cutting routes; new code should land in domain modules.

**Cross-cutting services** (`src/services/`):
- `contextEngine.js` — 4-layer progressive context (task → neighborhood → knowledge → extended) with `token_budget` (~4 chars/token)
- `compaction.js` — extracts decision/reasoning logs into structured summaries (used by RPI chains)
- `reasoning.js` — status propagation, bottleneck detection, topological sort, RPI chain detection
- `graphitiBridge.js` — MCP Streamable HTTP (JSON-RPC + SSE) to internal Graphiti container; auto-reconnects on session expiry; graceful degradation when Graphiti is unreachable
- `messageBus.js` — PostgreSQL LISTEN/NOTIFY event bus. Init once with `messageBus.init(DATABASE_URL)`, then `subscribe`/`publish`. Notification adapters subscribe to it.
- `coherenceEngine.js`, `planQualityEvaluator.js` — knowledge contradiction + plan quality scoring

**Adapters** (`src/adapters/`) — Slack / Webhook / Console / WebSocket notification fan-out, all driven by the message bus.

**Auth** (`src/middleware/auth.middleware.v2.js`):
- `authenticate` (required) and `optionalAuthenticate` (sets `req.user` if present)
- Two credential types: JWT (`Authorization: Bearer <jwt>`) and API tokens (SHA-256 hashed in `api_tokens`, header `Authorization: ApiKey <token>`)
- `planAccess.middleware.js` is the shared plan-membership check — reuse it instead of re-deriving access in controllers
- Rate limiting at the route level in four tiers: general, auth, search, token

**Validation** (`src/validation/`) — Zod schemas; wire them through controllers, not directly in routes.

**WebSocket** (`src/websocket/`) — broadcast on plan/node changes; presence is tracked in-process. Init happens in `src/index.js` after the HTTP server is up.

## Patterns that bite if missed

- **CJS/ESM bridge.** Backend mixes `.js` (CommonJS) and `.mjs` (ESM). DAL files are `.mjs` and reached from CJS via `db/dal.cjs` (lazy `import()` cache). When adding a new DAL, register it in `db/dal/index.mjs` so the bridge picks it up.
- **All knowledge is Graphiti now.** The old flat `knowledge_entries` table, `knowledgeDal`, and `add_knowledge_entry`/`search_knowledge` MCP tools are removed. Don't reintroduce them — write through `graphitiBridge.js`. Multi-tenancy uses `group_id = org_{org_id}`.
- **Migrations are append-only.** Drizzle generates files into `migrations/` with numeric prefixes. The custom runner `scripts/run-migrations.mjs` splits on `statement-breakpoint` markers. Never edit an applied migration — add a new one.
- **Controllers are `.v2.js`.** v1 is deleted; the suffix is historical. All new controllers keep the suffix for now.
- **Workspaces + Blueprints.** Goals and plans hang off a `workspace_id` (organization-scoped container). Blueprints are dehydrated reusable shapes (`scope: 'plan'` only in v1) that fork into a workspace via `POST /blueprints/:id/fork`. Run-state (claims, episodes, statuses, agent assignments) is excluded from blueprints. Schema: `migrations/0019_workspaces_and_blueprints.sql`. Sketch: `docs/WORKSPACE_BLUEPRINT_SKETCH.md`.
- **Task claims have a partial unique index** — one active (non-expired) claim per node. See `claimsDal` + `node_claims` schema; don't bypass with raw inserts.
- **`goal_type` is derived, not stored.** The desire/intention column was dropped in migration 0022; commitment = `promoted_at IS NOT NULL` (`committed` boolean on DAL rows). `goalsDal` still emits a derived `goalType` and accepts legacy `goalType` writes (translated to `promoted_at`) for API/UI/MCP compatibility. Don't reintroduce the column; new code should read `committed`.

## Adding an endpoint — checklist

1. Route in `src/routes/<x>.routes.js` (or `src/domains/<x>/routes/`) with `authenticate` and Swagger JSDoc.
2. Thin controller; service for logic; repository/DAL for data.
3. Zod validation schema in `src/validation/` and wire through the controller.
4. If the endpoint emits an event, publish on the message bus so adapters can react.
5. `npm run docs:all` to refresh OpenAPI.
6. Add an integration test under `tests/integration/`. Update the MCP server (`../agent-planner-mcp/src/tools.js`) if agents need to call it.

## Environment

Key env vars (full list in `.env.example`): `DATABASE_URL`, `JWT_SECRET`, `OPENAI_API_KEY`, `GRAPHITI_INTERNAL_URL` (set to `http://graphiti:8000` to enable knowledge graph), `FRONTEND_URL` (CORS), `PORT` (default 3000), `SLACK_BOT_TOKEN`, `DISCORD_TOKEN`, `ANTHROPIC_API_KEY`.

Tests load `.env.test`. `tests/setup/jest.setup.js` is the global Jest setup.
