# API Surface — Post Pre-v2 Cleanup

Generated: 2026-02-14

This document lists every remaining route, controller, and service after the pre-v2 cleanup.
Use this as the migration checklist for the Drizzle/Hatchet v2 refactor.

## Route Files

| Route File | Mount Path | Purpose | v2 Status |
|---|---|---|---|
| auth.routes.js | `/auth` | Login, register, password reset, OAuth | **keep** |
| plan.routes.js | `/plans` | CRUD plans, visibility, view count | **keep** (migrate to Drizzle) |
| node.routes.js | `/plans` | CRUD nodes, tree ops, status, logs, assignments | **keep** (migrate to Drizzle) |
| activity.routes.js | `/activity` | Activity feed | **keep** |
| search.routes.js | `/search` | Full-text search across plans/nodes | **keep** |
| token.routes.js | `/tokens` | API token CRUD for MCP access | **keep** |
| upload.routes.js | `/upload` | File uploads (avatars, attachments) | **keep** |
| user.routes.js | `/users` | User profile, preferences, my-tasks polling | **keep** |
| collaboration.routes.js | `/plans` | Real-time collaboration, collaborator management | **keep** |
| stats.routes.js | `/stats` | Platform-level stats | **modify** (simplify) |
| github.routes.js | `/github` | GitHub repo linking | **keep** |
| share.routes.js | `/plans`, `/invites` | Plan sharing by email | **keep** |
| goal.routes.js | `/goals` | Goal tracking (OKR-style) | **modify** (remove org scope) |
| context.routes.js | `/context` | Agent context loading (leaf-up) | **keep** (core MCP feature) |
| decision.routes.js | `/plans` | Human-in-the-loop decision requests | **keep** |
| dashboard.routes.js | `/dashboard` | Home page aggregated data | **keep** |
| handoff.routes.js | `/plans`, `/` | Agent-to-agent task handoff | **keep** |
| heartbeat.routes.js | `/` | Agent heartbeat/polling | **keep** |

## Controller Files

| Controller | Used By | Purpose | v2 Status |
|---|---|---|---|
| auth.controller.js | auth.routes | Authentication logic | **keep** |
| plan.controller.js | plan.routes | Plan CRUD, search, public plans | **keep** |
| node.controller.js | node.routes | Node CRUD, tree operations | **keep** |
| activity.controller.js | activity.routes | Activity feed queries | **keep** |
| activities.controller.js | node.routes | Node-level activity (logs, comments) | **keep** (consider merging with activity.controller) |
| assignment.controller.js | node.routes | Task assignments | **keep** |
| search.controller.js | search.routes | Search logic | **keep** |
| token.controller.js | token.routes | API token management | **keep** |
| upload.controller.js | upload.routes | File upload handling | **keep** |
| user.controller.js | user.routes | User profile, agent task polling | **keep** |
| collaboration.controller.js | collaboration.routes | WebSocket collaboration | **keep** |
| stats.controller.js | stats.routes | Platform stats | **modify** |
| github.controller.js | github.routes | GitHub integration | **keep** |
| decision.controller.js | decision.routes | Decision request CRUD | **keep** |
| handoff.controller.js | handoff.routes | Agent handoff logic | **keep** |
| heartbeat.controller.js | heartbeat.routes | Agent heartbeat | **keep** |

## Services

| Service | Purpose | v2 Status |
|---|---|---|
| email.js | Send emails (invites, sharing) | **keep** |
| invites.js | Plan invitation logic | **keep** |
| notifications.js | In-app + push notifications | **modify** (add Hatchet integration) |

## Removed in This Cleanup

- **Routes:** debug, ai, webhook, chat, prompt, template, analytics, import-export, organization, knowledge
- **Controllers:** debug, ai, chat, prompt, star
- **Services:** embedding, decision-knowledge
- **Dependencies:** @anthropic-ai/sdk

## Frontend Pages (Remaining)

| Page | API Dependencies | v2 Status |
|---|---|---|
| Dashboard | `/dashboard` | **keep** |
| PlansList | `/plans` | **keep** |
| PlanVisualization | `/plans/:id`, nodes, decisions, activity | **keep** |
| Goals | `/goals` | **modify** (remove org scope) |
| AgentDashboard | `/users/my-tasks`, agent requests | **keep** |
| Settings (API Tokens) | `/tokens` | **keep** |
| IntegrationsSettings | static content | **keep** |
| ProfileSettings | `/users/profile` | **keep** |
| ExplorePlansPage | `/plans/public` | **keep** |
| Landing | static | **keep** |
