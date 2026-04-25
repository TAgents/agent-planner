# AgentPlanner API

[![License: BUSL-1.1](https://img.shields.io/badge/License-BUSL--1.1-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-16+-green.svg)](https://nodejs.org)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-17-blue.svg)](https://www.postgresql.org)

The backend API for [AgentPlanner](https://agentplanner.io) — a collaborative planning platform where humans and AI agents work together on hierarchical plans.

> **Cloud version:** [agentplanner.io](https://agentplanner.io) — sign up free, no setup required.  
> **Self-hosting:** Follow the instructions below.

## Features

- **Hierarchical plans** — phases, tasks, milestones with a flexible tree structure
- **Dependency graph** — cycle detection, upstream/downstream traversal, critical path, and impact analysis
- **Progressive context engine** — 4-layer depth with token budgeting for efficient agent context loading
- **RPI chains** — Research → Plan → Implement task decomposition with automatic dependency wiring
- **Knowledge graph** — temporal knowledge via Graphiti (entities, facts, relationships, contradictions)
- **Goal tracking** — health dashboard, briefings, bottleneck detection, and success criteria
- **Real-time collaboration** — WebSocket presence tracking and plan change broadcasts
- **MCP integration** — AI agents connect via stdio or HTTP/SSE transport
- **Task claim/lease** — TTL-based locking for multi-agent coordination
- **Decision queue** — structured agent-to-human handoffs with approve/redirect workflow
- **Organizations** — multi-tenant isolation with role-based access

## Self-Hosting

### Prerequisites

- Docker and Docker Compose
- Node.js 16+ (for running without Docker)
- An OpenAI API key (required for the knowledge graph / Graphiti)

### Quick Start with Docker Compose

**For most users (recommended): see [LOCAL_QUICKSTART.md](LOCAL_QUICKSTART.md)** — the blessed 5-minute path that brings up the full stack (postgres + api + frontend + graphiti + mcp) in one command, ready for the `ap` CLI or any MCP client.

For backend development with hot reload (separate use case), use the profile-based compose file:

```bash
git clone https://github.com/TAgents/agent-planner.git
cd agent-planner

# Copy and configure environment
cp .env.example .env
# Edit .env — set JWT_SECRET, OPENAI_API_KEY, and change default passwords

# Start PostgreSQL + API only (no frontend, no graphiti)
docker compose --profile core up -d

# Run database migrations
docker compose exec api npm run db:init
```

The API will be available at `http://localhost:3000`.

### Optional: Knowledge Graph (Graphiti + FalkorDB)

```bash
# Start with knowledge graph support
docker compose --profile core --profile knowledge up -d
```

Set `GRAPHITI_INTERNAL_URL=http://graphiti:8000` in your `.env` to enable it.

### Environment Variables

Copy `.env.example` to `.env` and configure:

| Variable | Description | Required |
|---|---|---|
| `DATABASE_URL` | PostgreSQL connection string | ✅ |
| `JWT_SECRET` | Secret for JWT token signing — **change this!** | ✅ |
| `OPENAI_API_KEY` | For knowledge graph (Graphiti) | For knowledge graph |
| `FRONTEND_URL` | Frontend origin for CORS | ✅ |
| `PORT` | API port (default: `3000`) | — |
| `ANTHROPIC_API_KEY` | For AI reasoning features | Optional |

See `.env.example` for the full list including database config.

### Running Without Docker

```bash
npm install

# Requires a running PostgreSQL 17 instance with pgvector
npm run db:init   # Apply migrations + create first user
npm run dev       # Development with hot reload
npm start         # Production
```

### Available Scripts

```bash
npm run dev          # Development server (nodemon)
npm start            # Production server
npm test             # Run all tests (unit + integration)
npm run db:init      # Apply DB migrations
npm run db:push      # Push Drizzle schema to database (dev)
npm run db:migrate   # Run migration files (production)
npm run db:studio    # Open Drizzle Studio (DB browser)
npm run docs:all     # Generate + validate OpenAPI docs
npm run lint         # ESLint
```

## Testing

### Unit Tests

Unit tests mock the DAL layer and test controllers, validation schemas, and services in isolation. No running database required.

```bash
npm test                                    # Run all tests (unit + integration)
npm run test:watch                          # Watch mode
npm run test:coverage                       # With coverage report
npx jest tests/unit/validation/schemas.test.js  # Run a single test file
```

### Integration Tests (API Smoke Suite)

The integration test suite exercises every major endpoint group against a running local API via HTTP. It covers auth, plans, nodes, dependencies, goals, claims, episode-links, and knowledge endpoints — 58 tests total.

**Prerequisites:**

1. Start the local stack:
   ```bash
   docker compose -f docker-compose.local.yml up -d --build
   ```

2. Generate an API token (JWT):
   ```bash
   export API_TOKEN=$(docker exec agent-planner-api-1 node -e "
     const jwt = require('jsonwebtoken');
     console.log(jwt.sign(
       { sub: '<USER_UUID>', email: '<EMAIL>' },
       process.env.JWT_SECRET,
       { expiresIn: '24h' }
     ));
   ")
   ```

3. Run the tests:
   ```bash
   API_TOKEN=$API_TOKEN npx jest tests/integration/api-smoke.test.js --runInBand
   ```

**Environment variables:**

| Variable | Default | Description |
|---|---|---|
| `API_TOKEN` | *(none)* | JWT or API key for authentication. **Required** — tests are skipped if not set. |
| `API_URL` | `http://localhost:3000` | Base URL of the running API. |

**What's tested:**

| Group | Tests | Coverage |
|---|---|---|
| Auth | 2 | Missing/invalid token rejection |
| Plans CRUD | 8 | Create, list, get, update, quality score, validation, delete |
| Nodes CRUD | 12 | Tree structure, details, coherence status, quality score, filtering |
| Dependencies | 7 | Create, duplicate detection, traversal (upstream/downstream), delete |
| Goals | 10 | CRUD, plan linking, knowledge gaps |
| Claims (BDI) | 5 | Claim with belief snapshot, conflict detection, release |
| Episode Links (BDI) | 8 | Link/unlink episodes, filtering by type, duplicate detection |
| Knowledge/Graphiti | 5 | Episode creation, graph search (auto-skipped if Graphiti unavailable) |

The suite creates its own test data and cleans up after itself. Each run uses unique IDs to avoid conflicts with existing data.

## Project Structure

```
agent-planner/
├── src/
│   ├── index.js              # Express app, middleware, route mounting, WebSocket
│   ├── controllers/          # Request handlers
│   ├── routes/               # Express routers
│   ├── services/             # Business logic
│   │   ├── contextEngine.js  # Progressive context assembly (4 layers)
│   │   ├── reasoning.js      # Status propagation, bottlenecks, scheduling
│   │   ├── compaction.js     # Research output compaction
│   │   └── messageBus.js     # PostgreSQL LISTEN/NOTIFY event bus
│   ├── db/
│   │   ├── schema/*.mjs      # Drizzle ORM table definitions
│   │   ├── dal/*.mjs         # Data Access Layer (18 modules)
│   │   ├── dal.cjs           # CJS/ESM bridge
│   │   └── sql/*.sql         # Migration files
│   ├── middleware/           # Auth, rate limiting
│   ├── adapters/             # Notification adapters (Slack, Webhook)
│   └── websocket/            # Real-time collaboration
├── docker/                   # Docker configs and init scripts
├── docker-compose.yml        # Base compose file
├── docker-compose.local.yml  # Local dev overrides
├── docker-compose.prod.yml   # Production overrides
├── docs/                     # Architecture, API reference, integration guides
└── tests/                    # Jest + Supertest test suites
```

## Authentication

The API uses two authentication methods:

**Bearer Token (JWT)**
```
Authorization: Bearer <jwt_token>
```

**API Key**
```
Authorization: ApiKey <api_token>
```

API tokens are created in the AgentPlanner UI under Settings → API Tokens. Tokens are stored as SHA-256 hashes.

## Database Schema

PostgreSQL 17 with pgvector via Drizzle ORM. Key tables:

- `users`, `organizations`, `plan_collaborators` — accounts and access
- `plans`, `plan_nodes` — hierarchical plan structure (includes BDI fields: `coherence_status`, `quality_score`)
- `node_dependencies` — dependency graph edges
- `node_claims` — TTL-based task lease/lock for multi-agent coordination
- `episode_node_links` — links Graphiti knowledge episodes to plan nodes (BDI belief tracking)
- `plan_node_logs`, `plan_comments` — activity and discussion
- `goals`, `goal_links`, `goal_evaluations` — goals with plan links and health tracking
- `decision_requests` — structured agent-to-human handoffs
- `api_tokens` — programmatic access tokens

Knowledge is stored in Graphiti (external temporal knowledge graph via FalkorDB), not in PostgreSQL.

Migrations live in `migrations/` with numeric prefixes. Schema definitions in `src/db/schema/*.mjs` (Drizzle ORM).

## Documentation

| Document | Description |
|---|---|
| [docs/GETTING_STARTED.md](docs/GETTING_STARTED.md) | End-to-end walkthrough for humans and agents |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | System design, context engine, dependency graph |
| [docs/CONCEPTS.md](docs/CONCEPTS.md) | Platform concepts deep dive |
| [docs/API.md](docs/API.md) | REST API endpoint reference |
| [docs/AGENT_INTEGRATION.md](docs/AGENT_INTEGRATION.md) | Agent integration guide (MCP, REST, Slack) |
| [docs/SLACK_INTEGRATION.md](docs/SLACK_INTEGRATION.md) | Slack notification setup |

## Related Projects

- **[agent-planner-mcp](https://github.com/TAgents/agent-planner-mcp)** — MCP server for AI agent integration (60+ tools)
- **[agent-planner-ui](https://github.com/TAgents/agent-planner-ui)** — React web interface

## Contributing

Issues and PRs welcome. Please open an issue first for significant changes.

## License

Business Source License 1.1 — see [LICENSE](LICENSE) for details.  
Source is freely available; production SaaS use requires a commercial license.  
The license converts to open source after the change date specified in the LICENSE file.

Cloud-hosted version available at [agentplanner.io](https://agentplanner.io).
