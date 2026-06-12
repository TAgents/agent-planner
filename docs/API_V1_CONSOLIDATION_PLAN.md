# API v1 Consolidation Plan — 231 endpoints → ~55 public

**Status:** Phase 3 complete — `/v1` router mounted + dual OpenAPI specs; next: Phase 4 MCP client migration
**Branch:** `api-v1-consolidation` (phases may split into separate PRs)
**Origin:** Architecture review (2026-06-12) — the REST surface accumulated through
four pivots and now exposes ~231 endpoints, while the MCP layer proves the same
product fits in 36 intent-shaped tools. The MCP facade is the better-designed
API; this plan makes a v1 public surface shaped like it.

## Goals

1. **One public, versioned, documented API** (`/v1/...`, ~55 endpoints) that we
   commit to: stable shapes, OpenAPI docs, deprecation policy.
2. **Everything else becomes internal**: still mounted (the UI depends on it),
   but undocumented, unversioned, free to change or delete without notice.
3. **No behavior rewrites.** v1 routes alias existing controllers/services.
   The agent-loop facades (`/agent/briefing`, work-sessions) already implement
   the hard parts.
4. **Truly dead endpoints get deleted**, verified against UI/MCP usage and
   `tool_calls` telemetry.

## Non-goals

- Rewriting business logic or changing response shapes (beyond thin wrappers).
- Breaking the UI: it keeps using internal routes indefinitely.
- Breaking published MCP clients: `agent-planner-mcp`'s `api-client.js`
  migrates to `/v1` in its own release; old paths keep working until a
  deliberate sunset.

## Design rules for v1

- **Intent-shaped over CRUD-shaped** where agents are the consumer: one call
  answers one whole question (mirrors MCP tools `briefing`, `goal_state`,
  `claim_next_task`, `update_task`, `queue_decision`).
- Plain CRUD where resources are genuinely resource-like (plans, nodes, goals,
  workspaces, blueprints, members).
- `snake_case` request/response fields, `as_of` timestamps on read bundles,
  structured errors `{ error, code? }`.
- Every v1 route: `authenticate` + explicit access check + Swagger JSDoc with
  the `[v1]` tag.

## The proposed v1 surface (~55)

### Auth & identity (8)
| Method | Path | Aliases |
|---|---|---|
| POST | /v1/auth/register | /auth/register |
| POST | /v1/auth/login | /auth/login |
| POST | /v1/auth/refresh | /auth/refresh |
| GET | /v1/me | /auth/profile |
| PATCH | /v1/me | /auth/profile (PUT) |
| GET | /v1/me/tokens | /auth/token |
| POST | /v1/me/tokens | /auth/token |
| DELETE | /v1/me/tokens/:id | /auth/token/:id |

### Organizations & workspaces (10)
| Method | Path | Aliases |
|---|---|---|
| GET/POST | /v1/orgs | /organizations |
| GET/PATCH/DELETE | /v1/orgs/:id | /organizations/:id |
| GET/POST | /v1/orgs/:id/members | /organizations/:id/members |
| PATCH/DELETE | /v1/orgs/:id/members/:userId | role + remove |
| GET/POST | /v1/workspaces | /workspaces |
| GET/PATCH/DELETE | /v1/workspaces/:id | /workspaces/:id (+archive/restore folded into PATCH) |

### Goals (8)
| Method | Path | Aliases |
|---|---|---|
| GET/POST | /v1/goals | /goals |
| GET/PATCH/DELETE | /v1/goals/:id | /goals/:id |
| POST | /v1/goals/:id/promote | /goals/:id/promote |
| GET | /v1/goals/dashboard | /goals/dashboard (health rollup) |
| GET | /v1/goals/:id/state | NEW facade — bundles /goals/:id + quality + progress + knowledge-gaps + briefing (mirrors MCP `goal_state`) |

### Plans & nodes (13)
| Method | Path | Aliases |
|---|---|---|
| GET/POST | /v1/plans | /plans |
| GET/PATCH/DELETE | /v1/plans/:id | /plans/:id |
| POST | /v1/plans/:id/fork | /plans/:id/fork |
| GET/POST | /v1/plans/:id/nodes | /plans/:id/nodes |
| GET/PATCH/DELETE | /v1/plans/:id/nodes/:nodeId | /plans/:id/nodes/:nodeId |
| POST | /v1/plans/:id/nodes/:nodeId/move | move |
| GET | /v1/plans/:id/analysis | NEW facade — bundles critical-path + bottlenecks + rpi-chains + coherence (mirrors MCP `plan_analysis`) |

### Work loop (6) — the agent-first heart
| Method | Path | Aliases |
|---|---|---|
| GET | /v1/briefing | /agent/briefing (mission control bundle) |
| POST | /v1/tasks/claim-next | agentLoop work-session start / claim_next_task |
| GET | /v1/tasks/:nodeId/context | /context/progressive (depth 1-4 + token_budget) |
| POST | /v1/tasks/:nodeId/update | atomic status+log+release+learning (mirrors MCP `update_task`) |
| POST | /v1/tasks/:nodeId/claim | /plans/:id/nodes/:nodeId/claim (explicit claim) |
| DELETE | /v1/tasks/:nodeId/claim | release |

### Decisions (4)
| Method | Path | Aliases |
|---|---|---|
| GET | /v1/decisions | pending queue across accessible plans (/dashboard/pending) |
| POST | /v1/plans/:id/decisions | queue a decision |
| POST | /v1/decisions/:id/resolve | resolve (approve/defer/reject, materialize subtasks) |
| POST | /v1/decisions/:id/cancel | cancel |

### Dependencies (3)
| Method | Path | Aliases |
|---|---|---|
| POST | /v1/dependencies | create (intra- or cross-plan) |
| DELETE | /v1/dependencies/:id | remove |
| GET | /v1/plans/:id/nodes/:nodeId/dependencies | up+down bundled (impact lives in /v1/plans/:id/analysis) |

### Knowledge (5)
| Method | Path | Aliases |
|---|---|---|
| GET/POST | /v1/knowledge/episodes | episodes (org-scoped) |
| DELETE | /v1/knowledge/episodes/:id | delete |
| POST | /v1/knowledge/search | NEW facade — facts + entities + episodes + contradictions in one call (mirrors MCP `recall_knowledge`) |
| GET | /v1/knowledge/status | graphiti availability |

### Blueprints (5)
| Method | Path | Aliases |
|---|---|---|
| GET | /v1/blueprints | list (own + public) |
| GET/DELETE | /v1/blueprints/:id | read/delete |
| POST | /v1/blueprints/from-plan/:planId | snapshot |
| POST | /v1/blueprints/:id/fork | instantiate into workspace |

### Sharing & search (4)
| Method | Path | Aliases |
|---|---|---|
| POST | /v1/plans/:id/share | atomic visibility + collaborators (mirrors MCP `share_plan`) |
| GET | /v1/plans/:id/collaborators | list |
| POST | /v1/invites/accept/:token | accept invite |
| GET | /v1/search | global search |

**Total: ~56.** Everything not listed is internal.

## Phases

### Phase 1 — Inventory & classification *(this branch)*
- Generate `docs/API_SURFACE.md`: every mounted endpoint, classified
  `v1 | internal | remove`, with consumer evidence (UI service files, MCP
  api-client, devops scripts).
- Deliverable: the classification table + this plan committed.

### Phase 2 — v1 router skeleton *(this branch — DONE)*
- `src/routes/v1/index.js`: one router that re-mounts existing handlers under
  `/v1` paths. Zero logic changes; thin param-mapping wrappers where path
  shapes differ (e.g. `/v1/tasks/:nodeId/...` resolves plan from node).
- New facades (`goal_state`, `plan_analysis`, `knowledge/search`, task update)
  implemented by composing existing services — port the composition logic from
  `agent-planner-mcp/src/tools/bdi/*.js` server-side.
- Mount in `src/index.js` under `/v1` with `generalLimiter`.
- **Shipped:** `src/routes/v1/` (forward helper + 10 group files, every route
  Swagger-tagged `[v1]`), `src/services/v1Facades.js` (plan analysis,
  knowledge search, task update, share plan), goal quality/gaps/progress
  extracted to `src/domains/goal/services/goalState.service.js` (goals routes
  now call the service), `:id` params UUID-constrained where internal routers
  have literal sibling paths (`/plans/public`, `/goals/tree`,
  `/blueprints/public` are not reachable through v1). Smoke test:
  `tests/integration/v1-routes.test.js` (52 tests, DB-free).

### Phase 3 — OpenAPI split *(DONE)*
- `npm run docs:generate` produces **two** specs: `openapi.v1.json` (only
  routes tagged `[v1]`) and the existing full internal spec.
- Swagger UI serves v1 by default at `/api-docs`; internal spec at
  `/api-docs/internal`.
- **Shipped:** `src/utils/v1Spec.js` (shared `extractV1Spec` used by both the
  runtime UI and `scripts/generate-docs.js`), `docs/openapi.v1.json` (70
  operations, strictly validated — `docs:validate` now fails on any
  undocumented v1 operation, internal spec is lenient/report-only). Also
  fixed a malformed `@swagger` comment in `blueprint.routes.js` that was
  spraying 140 bogus numeric path keys into the spec.

### Phase 4 — MCP client migration *(agent-planner-mcp repo)*
- Point `api-client.js` at `/v1` paths; replace client-side fan-outs with the
  new server-side facades where they exist (briefing already does this).
- Release as a minor version; old backend paths still work.

### Phase 5 — Deletions & deprecation headers
- Endpoints classified `remove` in Phase 1 get deleted after a telemetry check
  (`tool_calls` table, 30-day window on prod).
- Internal endpoints that duplicate v1 exactly get `Deprecation` response
  headers pointing at the v1 path.

## Verification per phase
- Unit + integration tests green after each phase.
- Phase 2: integration test exercising each v1 route group (alias smoke test).
- Phase 4: MCP `npm test` + `validate:mcp-loop` against a local stack.

## Risks / notes
- PR #52 (goal_type removal) may land during this work — rebase before Phase 2.
- Nginx on the VM maps `/api/` → API root, so hosted v1 URLs are
  `https://agentplanner.io/api/v1/...`. No nginx change needed.
- The UI must not be migrated to v1 in this effort — internal routes remain
  its contract. Migrating the UI is optional future work.
