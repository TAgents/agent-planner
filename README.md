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

```bash
git clone https://github.com/TAgents/agent-planner.git
cd agent-planner

# Copy and configure environment
cp .env.example .env
# Edit .env — set JWT_SECRET, OPENAI_API_KEY, and change default passwords

# Start PostgreSQL + API
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
npm test             # Run test suite
npm run db:init      # Apply DB migrations
npm run lint         # ESLint
```

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
- `plans`, `plan_nodes` — hierarchical plan structure
- `node_dependencies` — dependency graph edges
- `plan_node_logs`, `plan_comments` — activity and discussion
- `goals` — goals with plan links and health tracking
- `knowledge_entries` — vector-embedded knowledge store
- `decisions` — decision requests and resolutions
- `api_tokens` — programmatic access tokens
- `schema_migrations` — migration tracking

Migrations live in `src/db/sql/` with numeric prefixes. Running `npm run db:init` applies only new migrations (idempotent).

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
