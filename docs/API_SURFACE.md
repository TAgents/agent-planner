# API Surface Inventory — Phase 1 classification

Generated mechanically from `src/index.js` mounts + `router.<method>` extraction,
with consumer evidence from grep over `agent-planner-ui/src`, `agent-planner-mcp/src`,
`agent-planner-devops`, and `agent-planner-skills`. See
[API_V1_CONSOLIDATION_PLAN.md](API_V1_CONSOLIDATION_PLAN.md) for the target design.

## Summary

| Classification | Count | Meaning |
|---|---|---|
| **v1** | 78 | Backs one of the ~70 planned public v1 routes (several existing endpoints feed one v1 facade) |
| **internal** | 132 | Kept for the UI / infra / external callers; undocumented, unversioned |
| **remove** | 11 | No consumer found and judged dead — Phase 5 deletion after telemetry check |
| **phantom** | 5 | Double-mount artifacts (same router mounted at two prefixes) — fixed by splitting the mount, not real endpoints |

Total extracted endpoints: **226** (route handler registrations × mounts).
Distinct planned v1 routes: **70**.

Consumer legend: `ui` = agent-planner-ui, `mcp` = agent-planner-mcp, `devops`, `skills`. Empty = no static reference found (may still be hit by external systems or constructed URLs — verify via tool_calls telemetry before deleting anything).


## /activity

| Method | Path | Class | v1 alias | Consumers | Note |
|---|---|---|---|---|---|
| GET | `/activity/feed` | internal |  | ui, mcp |  |
| GET | `/activity/plans/:id/activity` | internal |  | ui, mcp |  |
| GET | `/activity/plans/:id/nodes/:nodeId/activity` | internal |  | ui |  |
| POST | `/activity/plans/:id/nodes/:nodeId/detailed-log` | internal |  | ui |  |
| GET | `/activity/plans/:id/timeline` | internal |  | ui |  |

## /admin

| Method | Path | Class | v1 alias | Consumers | Note |
|---|---|---|---|---|---|
| GET | `/admin/stats` | internal |  |  | no consumer reference found — verify with telemetry before any future removal |
| GET | `/admin/users` | internal |  |  | no consumer reference found — verify with telemetry before any future removal |
| PUT | `/admin/users/:userId/admin` | internal |  |  | no consumer reference found — verify with telemetry before any future removal |

## /agent

| Method | Path | Class | v1 alias | Consumers | Note |
|---|---|---|---|---|---|
| GET | `/agent/briefing` | v1 | GET /v1/briefing | mcp |  |
| POST | `/agent/intentions` | internal |  | mcp |  |
| POST | `/agent/work-sessions` | v1 | POST /v1/tasks/claim-next | mcp |  |
| POST | `/agent/work-sessions/:sessionId/block` | internal |  | mcp |  |
| POST | `/agent/work-sessions/:sessionId/complete` | internal |  | mcp |  |

## /auth

| Method | Path | Class | v1 alias | Consumers | Note |
|---|---|---|---|---|---|
| POST | `/auth/change-password` | internal |  |  | no consumer reference found — verify with telemetry before any future removal |
| POST | `/auth/forgot-password` | internal |  | ui |  |
| POST | `/auth/github/callback` | internal |  |  | external caller: GitHub OAuth |
| POST | `/auth/google/callback` | internal |  |  | external caller: Google OAuth |
| POST | `/auth/login` | v1 | POST /v1/auth/login | ui |  |
| POST | `/auth/logout` | internal |  | ui |  |
| GET | `/auth/oauth/providers` | internal |  | ui |  |
| GET | `/auth/profile` | v1 | GET /v1/me | ui |  |
| PUT | `/auth/profile` | v1 | PATCH /v1/me | ui |  |
| POST | `/auth/refresh` | v1 | POST /v1/auth/refresh |  |  |
| POST | `/auth/register` | v1 | POST /v1/auth/register | ui |  |
| POST | `/auth/resend-verification` | internal |  | ui |  |
| POST | `/auth/reset-password` | internal |  | ui |  |
| GET | `/auth/token` | v1 | GET /v1/me/tokens | ui, mcp |  |
| POST | `/auth/token` | v1 | POST /v1/me/tokens | ui, mcp |  |
| DELETE | `/auth/token/:id` | v1 | DELETE /v1/me/tokens/:id | ui, mcp |  |
| POST | `/auth/verify-email` | internal |  | ui |  |

## /blueprints

| Method | Path | Class | v1 alias | Consumers | Note |
|---|---|---|---|---|---|
| GET | `/blueprints` | v1 | GET /v1/blueprints | ui, mcp |  |
| POST | `/blueprints` | internal |  | ui, mcp |  |
| DELETE | `/blueprints/:id` | v1 | DELETE /v1/blueprints/:id | ui, mcp |  |
| GET | `/blueprints/:id` | v1 | GET /v1/blueprints/:id | ui, mcp |  |
| PATCH | `/blueprints/:id` | internal |  | ui, mcp |  |
| POST | `/blueprints/:id/fork` | v1 | POST /v1/blueprints/:id/fork | ui, mcp |  |
| GET | `/blueprints/:id/forks` | internal |  | ui |  |
| POST | `/blueprints/from_plan/:planId` | v1 | POST /v1/blueprints/from-plan/:planId | ui, mcp |  |
| GET | `/blueprints/public` | internal |  | ui |  |
| GET | `/blueprints/public/:id` | internal |  | ui |  |

## /coherence

| Method | Path | Class | v1 alias | Consumers | Note |
|---|---|---|---|---|---|
| GET | `/coherence/pending` | internal |  | ui, mcp |  |
| GET | `/coherence/summary` | internal |  | ui |  |

## /context

| Method | Path | Class | v1 alias | Consumers | Note |
|---|---|---|---|---|---|
| GET | `/context` | internal |  | ui, mcp |  |
| POST | `/context/compact` | remove |  |  |  |
| GET | `/context/plan` | internal |  | mcp |  |
| GET | `/context/progressive` | v1 | GET /v1/tasks/:nodeId/context | mcp |  |
| GET | `/context/suggest` | internal |  | ui, mcp |  |

## /dashboard

| Method | Path | Class | v1 alias | Consumers | Note |
|---|---|---|---|---|---|
| GET | `/dashboard/active-goals` | internal |  | ui |  |
| GET | `/dashboard/pending` | v1 | GET /v1/decisions | ui, mcp |  |
| GET | `/dashboard/recent-plans` | internal |  | ui |  |
| GET | `/dashboard/summary` | internal |  | ui, skills |  |
| GET | `/dashboard/velocity` | internal |  | ui |  |

## /dependencies

| Method | Path | Class | v1 alias | Consumers | Note |
|---|---|---|---|---|---|
| GET | `/dependencies/cross-plan` | internal |  | ui, mcp |  |
| POST | `/dependencies/cross-plan` | internal |  | ui, mcp |  |
| POST | `/dependencies/external` | internal |  | mcp |  |

## /github

| Method | Path | Class | v1 alias | Consumers | Note |
|---|---|---|---|---|---|
| GET | `/github/repos` | internal |  | ui |  |
| GET | `/github/repos/:owner/:name` | internal |  | ui |  |
| GET | `/github/repos/:owner/:name/content` | internal |  | ui |  |
| POST | `/github/repos/:owner/:name/issues` | internal |  | ui |  |
| POST | `/github/repos/:owner/:name/issues/bulk` | internal |  | ui |  |
| GET | `/github/search` | internal |  | ui |  |
| GET | `/github/status` | internal |  | ui |  |

## /goals

| Method | Path | Class | v1 alias | Consumers | Note |
|---|---|---|---|---|---|
| GET | `/goals` | v1 | GET /v1/goals | ui, mcp, skills |  |
| POST | `/goals` | v1 | POST /v1/goals | ui, mcp, skills |  |
| GET | `/goals/:goalId/briefing` | internal |  | ui |  |
| DELETE | `/goals/:id` | v1 | DELETE /v1/goals/:id | ui, mcp, skills |  |
| GET | `/goals/:id` | v1 | GET /v1/goals/:id | ui, mcp, skills |  |
| PUT | `/goals/:id` | v1 | PATCH /v1/goals/:id | ui, mcp, skills |  |
| GET | `/goals/:id/achievers` | internal |  | mcp |  |
| POST | `/goals/:id/achievers` | internal |  | mcp |  |
| DELETE | `/goals/:id/achievers/:depId` | internal |  | mcp |  |
| GET | `/goals/:id/coherence` | internal |  | ui |  |
| GET | `/goals/:id/coverage` | internal |  | ui |  |
| GET | `/goals/:id/evaluations` | remove |  |  |  |
| POST | `/goals/:id/evaluations` | remove |  |  |  |
| GET | `/goals/:id/knowledge-gaps` | v1 | GET /v1/goals/:id/state (facade input) | ui, mcp |  |
| POST | `/goals/:id/links` | internal |  | mcp |  |
| DELETE | `/goals/:id/links/:linkId` | internal |  | mcp |  |
| GET | `/goals/:id/path` | remove |  |  |  |
| GET | `/goals/:id/portfolio` | internal |  | ui |  |
| GET | `/goals/:id/progress` | v1 | GET /v1/goals/:id/state (facade input) | mcp |  |
| POST | `/goals/:id/promote-to-intention` | v1 | POST /v1/goals/:id/promote | ui |  |
| GET | `/goals/:id/quality` | v1 | GET /v1/goals/:id/state (facade input) | ui, mcp |  |
| GET | `/goals/dashboard` | v1 | GET /v1/goals/dashboard | ui, mcp |  |
| GET | `/goals/tree` | internal |  | ui |  |

## /integrations

| Method | Path | Class | v1 alias | Consumers | Note |
|---|---|---|---|---|---|
| DELETE | `/integrations/slack` | internal |  | ui |  |
| GET | `/integrations/slack/callback` | internal |  |  | external caller: Slack OAuth |
| PUT | `/integrations/slack/channel` | internal |  | ui |  |
| GET | `/integrations/slack/channels` | internal |  | ui |  |
| GET | `/integrations/slack/install` | internal |  | ui |  |
| GET | `/integrations/slack/status` | internal |  | ui |  |
| POST | `/integrations/slack/test` | internal |  | ui |  |

## /invites

| Method | Path | Class | v1 alias | Consumers | Note |
|---|---|---|---|---|---|
| GET | `/invites/:id/invites` | phantom |  |  | double-mount artifact (shareRoutes mounted at /plans + /invites) |
| POST | `/invites/:id/share` | phantom |  |  | double-mount artifact (shareRoutes mounted at /plans + /invites) |
| DELETE | `/invites/:planId/invites/:inviteId` | phantom |  |  | double-mount artifact (shareRoutes mounted at /plans + /invites) |
| POST | `/invites/accept/:token` | v1 | POST /v1/invites/accept/:token |  |  |
| GET | `/invites/info/:token` | internal |  |  | no consumer reference found — verify with telemetry before any future removal |

## /knowledge

| Method | Path | Class | v1 alias | Consumers | Note |
|---|---|---|---|---|---|
| POST | `/knowledge/contradictions` | v1 | POST /v1/knowledge/search (facade input) | ui, mcp |  |
| GET | `/knowledge/coverage` | internal |  | ui |  |
| GET | `/knowledge/coverage-map` | internal |  | ui |  |
| POST | `/knowledge/entities` | v1 | POST /v1/knowledge/search (facade input) | ui, mcp |  |
| POST | `/knowledge/episode-task-links` | internal |  | ui |  |
| GET | `/knowledge/episodes` | v1 | GET /v1/knowledge/episodes | ui, mcp, skills |  |
| POST | `/knowledge/episodes` | v1 | POST /v1/knowledge/episodes | ui, mcp, skills |  |
| DELETE | `/knowledge/episodes/:episodeId` | v1 | DELETE /v1/knowledge/episodes/:id | ui, mcp |  |
| POST | `/knowledge/graph-search` | v1 | POST /v1/knowledge/search (facade input) | ui, mcp, skills |  |
| GET | `/knowledge/graphiti/status` | v1 | GET /v1/knowledge/status | ui, mcp, devops |  |

## /nodes

| Method | Path | Class | v1 alias | Consumers | Note |
|---|---|---|---|---|---|
| GET | `/nodes/:nodeId` | internal |  | ui, mcp |  |
| GET | `/nodes/:nodeId/agent-view` | internal |  | ui |  |

## /onboarding

| Method | Path | Class | v1 alias | Consumers | Note |
|---|---|---|---|---|---|
| GET | `/onboarding/recent-calls` | internal |  | ui |  |
| GET | `/onboarding/releases/mcpb/latest` | internal |  | ui |  |
| POST | `/onboarding/test-connection` | internal |  | ui |  |

## /organizations

| Method | Path | Class | v1 alias | Consumers | Note |
|---|---|---|---|---|---|
| GET | `/organizations` | v1 | GET /v1/orgs | ui, mcp |  |
| POST | `/organizations` | v1 | POST /v1/orgs | ui, mcp |  |
| DELETE | `/organizations/:id` | v1 | DELETE /v1/orgs/:id | ui, mcp |  |
| GET | `/organizations/:id` | v1 | GET /v1/orgs/:id | ui, mcp |  |
| PUT | `/organizations/:id` | v1 | PATCH /v1/orgs/:id | ui, mcp |  |
| GET | `/organizations/:id/members` | v1 | GET /v1/orgs/:id/members | ui, mcp |  |
| POST | `/organizations/:id/members` | v1 | POST /v1/orgs/:id/members | ui, mcp |  |
| GET | `/organizations/:id/plans` | internal |  | ui |  |
| DELETE | `/organizations/:orgId/members/:memberId` | v1 | DELETE /v1/orgs/:id/members/:userId | ui, mcp |  |
| PUT | `/organizations/:orgId/members/:memberId/role` | v1 | PATCH /v1/orgs/:id/members/:userId | ui, mcp |  |

## /plans

| Method | Path | Class | v1 alias | Consumers | Note |
|---|---|---|---|---|---|
| GET | `/plans` | v1 | GET /v1/plans | ui, mcp, skills |  |
| POST | `/plans` | v1 | POST /v1/plans | ui, mcp, skills |  |
| DELETE | `/plans/:id` | v1 | DELETE /v1/plans/:id | ui, mcp, skills |  |
| GET | `/plans/:id` | v1 | GET /v1/plans/:id | ui, mcp, skills |  |
| PUT | `/plans/:id` | v1 | PATCH /v1/plans/:id | ui, mcp, skills |  |
| GET | `/plans/:id/active-users` | internal |  | ui |  |
| GET | `/plans/:id/available-users` | internal |  | ui |  |
| GET | `/plans/:id/bottlenecks` | v1 | GET /v1/plans/:id/analysis (facade input) | ui, mcp |  |
| GET | `/plans/:id/coherence` | v1 | GET /v1/plans/:id/analysis (facade input) | ui, mcp |  |
| POST | `/plans/:id/coherence/check` | internal |  | ui, mcp |  |
| GET | `/plans/:id/collaborators` | v1 | GET /v1/plans/:id/collaborators | ui, mcp |  |
| POST | `/plans/:id/collaborators` | v1 | POST /v1/plans/:id/share (facade input) | ui, mcp |  |
| DELETE | `/plans/:id/collaborators/:userId` | internal |  | ui, mcp |  |
| GET | `/plans/:id/context` | internal |  | ui |  |
| GET | `/plans/:id/critical-path` | v1 | GET /v1/plans/:id/analysis (facade input) | ui, mcp |  |
| GET | `/plans/:id/decisions` | internal |  | ui, mcp |  |
| POST | `/plans/:id/decisions` | v1 | POST /v1/plans/:id/decisions | ui, mcp |  |
| DELETE | `/plans/:id/decisions/:decisionId` | internal |  | ui, mcp |  |
| GET | `/plans/:id/decisions/:decisionId` | internal |  | ui, mcp |  |
| PUT | `/plans/:id/decisions/:decisionId` | internal |  | ui, mcp |  |
| POST | `/plans/:id/decisions/:decisionId/cancel` | v1 | POST /v1/decisions/:id/cancel | ui |  |
| POST | `/plans/:id/decisions/:decisionId/resolve` | v1 | POST /v1/decisions/:id/resolve | ui, mcp |  |
| GET | `/plans/:id/decisions/pending-count` | remove |  |  |  |
| GET | `/plans/:id/decomposition-alerts` | remove |  |  |  |
| GET | `/plans/:id/dependencies` | internal |  | ui, mcp |  |
| POST | `/plans/:id/dependencies` | v1 | POST /v1/dependencies | ui, mcp |  |
| DELETE | `/plans/:id/dependencies/:depId` | v1 | DELETE /v1/dependencies/:id | ui, mcp |  |
| POST | `/plans/:id/fork` | v1 | POST /v1/plans/:id/fork | ui |  |
| PUT | `/plans/:id/github` | internal |  | ui |  |
| GET | `/plans/:id/invites` | internal |  |  | no consumer reference found — verify with telemetry before any future removal |
| GET | `/plans/:id/knowledge-loop/context` | internal |  | ui |  |
| POST | `/plans/:id/knowledge-loop/iterate` | internal |  | ui |  |
| POST | `/plans/:id/knowledge-loop/start` | internal |  | ui |  |
| GET | `/plans/:id/knowledge-loop/status` | internal |  | ui |  |
| POST | `/plans/:id/knowledge-loop/stop` | internal |  | ui |  |
| GET | `/plans/:id/nodes` | v1 | GET /v1/plans/:id/nodes | ui, mcp |  |
| POST | `/plans/:id/nodes` | v1 | POST /v1/plans/:id/nodes | ui, mcp |  |
| DELETE | `/plans/:id/nodes/:nodeId` | v1 | DELETE /v1/plans/:id/nodes/:nodeId | ui, mcp |  |
| GET | `/plans/:id/nodes/:nodeId` | v1 | GET /v1/plans/:id/nodes/:nodeId | ui, mcp |  |
| PUT | `/plans/:id/nodes/:nodeId` | v1 | PATCH /v1/plans/:id/nodes/:nodeId | ui, mcp |  |
| GET | `/plans/:id/nodes/:nodeId/active-users` | internal |  | ui |  |
| GET | `/plans/:id/nodes/:nodeId/activities` | internal |  | ui |  |
| GET | `/plans/:id/nodes/:nodeId/ancestry` | internal |  | ui |  |
| POST | `/plans/:id/nodes/:nodeId/assign` | internal |  | ui |  |
| DELETE | `/plans/:id/nodes/:nodeId/assign-agent` | internal |  | ui |  |
| POST | `/plans/:id/nodes/:nodeId/assign-agent` | internal |  | ui |  |
| GET | `/plans/:id/nodes/:nodeId/assignments` | internal |  | ui |  |
| DELETE | `/plans/:id/nodes/:nodeId/claim` | v1 | DELETE /v1/tasks/:nodeId/claim | ui, mcp |  |
| GET | `/plans/:id/nodes/:nodeId/claim` | internal |  | ui, mcp |  |
| POST | `/plans/:id/nodes/:nodeId/claim` | v1 | POST /v1/tasks/:nodeId/claim | ui, mcp |  |
| GET | `/plans/:id/nodes/:nodeId/comments` | internal |  | ui, mcp |  |
| POST | `/plans/:id/nodes/:nodeId/comments` | internal |  | ui, mcp |  |
| GET | `/plans/:id/nodes/:nodeId/context` | internal |  | ui |  |
| GET | `/plans/:id/nodes/:nodeId/dependencies` | v1 | GET /v1/plans/:id/nodes/:nodeId/dependencies | ui |  |
| GET | `/plans/:id/nodes/:nodeId/downstream` | internal |  | ui |  |
| GET | `/plans/:id/nodes/:nodeId/episode-links` | internal |  | ui |  |
| POST | `/plans/:id/nodes/:nodeId/episode-links` | internal |  | ui |  |
| DELETE | `/plans/:id/nodes/:nodeId/episode-links/:linkId` | internal |  |  | no consumer reference found — verify with telemetry before any future removal |
| GET | `/plans/:id/nodes/:nodeId/impact` | internal |  | ui, mcp |  |
| POST | `/plans/:id/nodes/:nodeId/log` | v1 | POST /v1/tasks/:nodeId/update (facade input) | ui, mcp |  |
| GET | `/plans/:id/nodes/:nodeId/logs` | internal |  | ui, mcp |  |
| POST | `/plans/:id/nodes/:nodeId/move` | v1 | POST /v1/plans/:id/nodes/:nodeId/move | ui, mcp |  |
| DELETE | `/plans/:id/nodes/:nodeId/request-agent` | internal |  | ui |  |
| POST | `/plans/:id/nodes/:nodeId/request-agent` | internal |  | ui |  |
| PUT | `/plans/:id/nodes/:nodeId/status` | v1 | POST /v1/tasks/:nodeId/update (facade input) | ui, mcp |  |
| GET | `/plans/:id/nodes/:nodeId/suggested-agents` | internal |  | ui |  |
| DELETE | `/plans/:id/nodes/:nodeId/unassign` | internal |  | ui |  |
| GET | `/plans/:id/nodes/:nodeId/upstream` | internal |  | ui |  |
| POST | `/plans/:id/nodes/rpi-chain` | internal |  |  | no consumer reference found — verify with telemetry before any future removal |
| POST | `/plans/:id/presence` | internal |  | ui |  |
| GET | `/plans/:id/progress` | internal |  | ui |  |
| GET | `/plans/:id/public` | internal |  | mcp |  |
| GET | `/plans/:id/rpi-chains` | internal |  |  | no consumer reference found — verify with telemetry before any future removal |
| GET | `/plans/:id/schedule` | remove |  |  |  |
| POST | `/plans/:id/share` | internal |  | ui |  |
| POST | `/plans/:id/view` | internal |  |  | no consumer reference found — verify with telemetry before any future removal |
| PUT | `/plans/:id/visibility` | v1 | POST /v1/plans/:id/share (facade input) | ui, mcp |  |
| DELETE | `/plans/:planId/invites/:inviteId` | internal |  |  | no consumer reference found — verify with telemetry before any future removal |
| POST | `/plans/accept/:token` | phantom |  |  | double-mount artifact (shareRoutes mounted at /plans + /invites) |
| GET | `/plans/info/:token` | phantom |  |  | double-mount artifact (shareRoutes mounted at /plans + /invites) |
| GET | `/plans/public` | internal |  | ui |  |
| GET | `/plans/public/:id` | internal |  | ui |  |
| GET | `/plans/public/:id/knowledge-digest` | internal |  | ui |  |
| GET | `/plans/public/:id/og.svg` | internal |  | ui |  |
| GET | `/plans/public/sitemap.xml` | internal |  |  | external caller: search engines |

## /search

| Method | Path | Class | v1 alias | Consumers | Note |
|---|---|---|---|---|---|
| GET | `/search` | v1 | GET /v1/search | ui, mcp |  |
| GET | `/search/plan/:plan_id` | internal |  | ui, mcp |  |
| GET | `/search/plans/:id/nodes/search` | remove |  |  |  |

## /stats

| Method | Path | Class | v1 alias | Consumers | Note |
|---|---|---|---|---|---|
| GET | `/stats` | internal |  |  | external caller: homepage/marketing |

## /upload

| Method | Path | Class | v1 alias | Consumers | Note |
|---|---|---|---|---|---|
| DELETE | `/upload/avatar` | internal |  | ui |  |
| POST | `/upload/avatar` | internal |  | ui |  |

## /users

| Method | Path | Class | v1 alias | Consumers | Note |
|---|---|---|---|---|---|
| GET | `/users` | internal |  | ui, mcp |  |
| GET | `/users/my-tasks` | internal |  |  | no consumer reference found — verify with telemetry before any future removal |
| GET | `/users/search` | internal |  | ui |  |

## /v2

| Method | Path | Class | v1 alias | Consumers | Note |
|---|---|---|---|---|---|
| POST | `/v2/agent/callback` | remove |  |  |  |
| GET | `/v2/agent/tools` | remove |  |  |  |
| POST | `/v2/agent/tools/:toolName` | remove |  |  |  |

## /workspaces

| Method | Path | Class | v1 alias | Consumers | Note |
|---|---|---|---|---|---|
| GET | `/workspaces` | v1 | GET /v1/workspaces | ui, mcp |  |
| POST | `/workspaces` | v1 | POST /v1/workspaces | ui, mcp |  |
| DELETE | `/workspaces/:id` | v1 | DELETE /v1/workspaces/:id | ui, mcp |  |
| GET | `/workspaces/:id` | v1 | GET /v1/workspaces/:id | ui, mcp |  |
| PATCH | `/workspaces/:id` | v1 | PATCH /v1/workspaces/:id | ui, mcp |  |
| POST | `/workspaces/:id/archive` | internal |  | ui, mcp |  |
| POST | `/workspaces/:id/restore` | internal |  | ui, mcp |  |

## Remove candidates (Phase 5)

- `GET /search/plans/:id/nodes/search` — no UI/MCP/devops/skills reference
- `POST /goals/:id/evaluations` — no UI/MCP/devops/skills reference
- `GET /goals/:id/evaluations` — no UI/MCP/devops/skills reference
- `GET /goals/:id/path` — no UI/MCP/devops/skills reference
- `GET /v2/agent/tools` — no UI/MCP/devops/skills reference
- `POST /v2/agent/tools/:toolName` — no UI/MCP/devops/skills reference
- `POST /v2/agent/callback` — no UI/MCP/devops/skills reference
- `POST /context/compact` — no UI/MCP/devops/skills reference
- `GET /plans/:id/decisions/pending-count` — no UI/MCP/devops/skills reference
- `GET /plans/:id/schedule` — no UI/MCP/devops/skills reference
- `GET /plans/:id/decomposition-alerts` — no UI/MCP/devops/skills reference

Deletion gate: zero hits in `tool_calls` telemetry over a 30-day production window.
