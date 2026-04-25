# Local Quickstart

Get the AgentPlanner stack running locally and connect the `ap` CLI in under 5 minutes (after the first build).

This is the **blessed local-dev path**. It runs the entire stack in Docker — postgres, falkordb, graphiti, api, frontend, mcp — with one command. If you want hot-reload backend development, use `docker-compose.yml` (with profiles) instead; this guide is for users who want a working stack to point a CLI or agent at.

## Prerequisites

- Docker Desktop (or Docker Engine + Compose v2)
- An OpenAI API key (optional but recommended — required for the knowledge graph)

## 1. Clone and configure

```bash
git clone https://github.com/TAgents/agent-planner.git
cd agent-planner
cp .env.example .env
```

Edit `.env` and set:

```
OPENAI_API_KEY=sk-...   # optional; without it the knowledge graph won't work, but plans/tasks will
JWT_SECRET=...          # change from the default
```

## 2. Start the stack

```bash
docker compose -f docker-compose.local.yml up --build
```

First build: 5–10 minutes (npm install, frontend build, image pulls). Subsequent starts: under 30 seconds.

When you see all services reporting healthy, the stack is up:

| Service | URL | Purpose |
|---|---|---|
| API | http://localhost:3000 | REST API + Swagger at `/api-docs` |
| Frontend | http://localhost:3001 | Web UI for registration + token management |
| MCP | http://localhost:3100 | HTTP-mode MCP server (optional) |
| Postgres | localhost:5433 | Database (mapped to host) |

Graphiti and FalkorDB run internally and are not exposed to the host.

## 3. Create an account and an API token

1. Open http://localhost:3001
2. Register a new account (any email/password — no verification in local mode)
3. Go to **Settings → API Tokens**
4. Click **Create token**, give it a name like `local-dev`, copy the token

## 4. Install and connect the CLI

```bash
# install the CLI (publishes the same package as the MCP server)
npm install -g agent-planner-mcp

# log in against your local backend
agent-planner-mcp login --api-url http://localhost:3000 --token <paste-token-here>
```

You should see:

```
Saved credentials to /Users/<you>/.agentplanner/config.json
API URL: http://localhost:3000
```

If you have exactly one plan in the org, it auto-selects it as the default. Otherwise pass `--plan-id` later.

> **Working from a clone of `agent-planner-mcp`?** Run `npm install && npm link` inside that repo instead of the global install. The same `agent-planner-mcp` binary will be on your PATH.

## 5. Verify with the CLI

```bash
agent-planner-mcp tasks                    # queue view (will be empty until you create a plan)
agent-planner-mcp next --plan-id <id>      # smart picker (resume → recommend → fallback)
```

Or use the bundled smoke-test script for an end-to-end check:

```bash
./scripts/smoke-localhost.sh <your-api-token>
```

The script verifies all health endpoints, creates a throwaway plan, and confirms the CLI can pull its context.

## What's running

```
+---------------------------------------------+
|  Frontend (3001)  →  React UI               |
|  API (3000)       →  Node/Express + JWT     |
|  MCP (3100)       →  HTTP-mode MCP server   |
|  Postgres (5433)  →  pg17 + pgvector        |
|  Graphiti (-)     →  Knowledge graph (MCP)  |
|  FalkorDB (-)     →  Graph DB for Graphiti  |
+---------------------------------------------+
```

## Common issues

| Symptom | Fix |
|---|---|
| API healthcheck never goes green | Check `docker compose -f docker-compose.local.yml logs api` — usually a missing migration. Run `docker compose -f docker-compose.local.yml exec api npm run db:push`. |
| `ap login` returns 401 | Token was for the wrong backend. Tokens from agentplanner.io don't work against localhost; create a new one in your local UI. |
| Knowledge graph features fail silently | `OPENAI_API_KEY` not set in `.env`. All other features still work; learning writes return errors but don't block status updates. |
| Port already in use | Edit the published ports in `docker-compose.local.yml` (3000, 3001, 3100, 5433) or stop the conflicting service. |

## When to use what

| Goal | Compose file |
|---|---|
| Run the stack locally to point a CLI/agent at | **`docker-compose.local.yml`** (this guide) |
| Develop the backend with hot reload | `docker-compose.yml` (uses `--profile core --profile knowledge`) |
| Production deployment to a VM | `docker-compose.prod.yml` |

## Next steps

- See `agent-planner-mcp/README.md` for the full CLI command reference (`tasks`, `next`, `context`, `start`, `blocked`, `done`, `--fresh`)
- See `docs/GETTING_STARTED.md` for the human-side walkthrough (creating goals, plans, dependencies via the UI)
- See `docs/VISION.md` for the agent-first philosophy
