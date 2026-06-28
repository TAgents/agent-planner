# Unified Timeline — architecture & migration

> Status: design (approved direction, pre-implementation).
> Decision record for collapsing audit events, task logs, and comments into one
> spine, and the foundation for AgentPlanner's positioning as the **control plane
> for governed agent work**.

## Why

AgentPlanner's defensible layer is **trust, continuity, and accountability** of
agent work — not task trees. The durable product object is the **Execution
Trace**: every action tied to a plan node, every approval traceable to a person /
policy / surface, every context use explainable, every model change measurable.

Today the raw material for that already exists, modeled three+ ways:

| Concern | Table | Scope | Mutability | Type field |
|---|---|---|---|---|
| Audit events | `audit_logs` | polymorphic, **dormant** (0 writers) | append | `action` |
| Task narrative | `plan_node_logs` | node-only | append | `log_type` (progress/reasoning/decision/challenge) |
| Comments | `plan_comments` | node-only | mutable | `comment_type` (human/agent/system) |
| Tool telemetry | `tool_calls` | org/token | append | `tool_name` |

`plan_node_logs` and `plan_comments` are structurally the same table (content +
userId + a type discriminator), node-scoped, differing only in mutability. They,
and audit events, are one concept modeled separately. We unify them.

## The model — one table, three kinds

A single `timeline_entries` table is the spine. Every row is "something that
happened, attached to a subject, by an actor, at a time."

```
timeline_entries
  id              uuid pk
  created_at      timestamptz
  org_id          uuid                         -- tenant scoping

  kind            text   -- event | log | comment   (discriminator)
  entry_type      text   -- event: verb (node.status.changed, decision.resolved, …)
                         -- log:   progress | reasoning | decision | challenge
                         -- comment: human | agent | system

  -- Polymorphic subject
  subject_type    text   -- node | plan | goal | workspace | org
  subject_id      uuid

  -- Denormalized scope (filled from the subject's ancestry) so "everything
  -- about X" is an index seek for any X the user cares about.
  node_id         uuid null
  plan_id         uuid null
  goal_id         uuid null
  workspace_id    uuid null

  -- Actor
  actor_type      text   -- human | agent | system
  actor_id        uuid null
  actor_name      text null

  -- Content (comments + logs) / structured detail (events)
  content         text null
  payload         jsonb default '{}'   -- events: before/after, args, evidence refs

  -- Provenance envelope (mostly events; the trust property)
  provenance      jsonb default '{}'   -- surface, client_label, ip, token_id,
                                       -- work_mode, policy_id, model, runtime, prompt_hash

  correlation_id  uuid null            -- stitches one run into a Trace
  parent_id       uuid null            -- threading (reserved; flat for now)
  tags            text[] default '{}'

  edited_at       timestamptz null     -- only ever set for comments
  deleted_at      timestamptz null     -- soft delete; only ever set for comments
```

Indexes: `(plan_id, created_at desc)`, `(goal_id, …)`, `(workspace_id, …)`,
`(node_id, …)`, `(org_id, created_at desc)`, `(correlation_id)`,
`(actor_id, created_at desc)`, partial `WHERE deleted_at IS NULL`.

### Two product objects, one table
- **Trace** = entries grouped by `correlation_id` (the Execution Trace).
- **Thread** = comments grouped by `subject_id` (+ `parent_id` once threaded).

### Multi-level comments come for free
`subject_type` is polymorphic, so commenting on a plan, goal, or workspace is the
same write with a different subject. No node-only constraint.

## Mutability is domain policy, not storage

Enforced in `timeline.service`, not the DB:
- `event` / `log` → **insert-only**. No update/delete path is exposed.
- `comment` → author may edit (`edited_at`) / soft-delete (`deleted_at`).

**Escape hatch:** if enterprise compliance later needs a tamper-evident ledger,
split `kind='event'` rows into a separate append-only table. Because callers go
through `timeline.service`, that storage change touches no controllers, UI, or
tests. This is the entire reason for doing it in clean layers now.

## Clean-architecture layering

```
domains/timeline/
  routes/        GET /timeline                     (filter: subject, scope, kind, actor, correlation_id; paginated)
                 GET /timeline/traces/:correlationId
                 POST   /timeline/comments         (subject_type + subject_id + content)
                 PATCH  /timeline/comments/:id
                 DELETE /timeline/comments/:id      (soft)
  controllers/   thin HTTP
  services/      timeline.service.js
                   recordEvent(verb, {subject, actor, provenance, payload, correlationId})
                   addComment / editComment / deleteComment   (+ authz + mutability policy)
                   addLog
                   query(filters)            -- the single read path
                   resolveScope(subjectType, subjectId) -> {node_id, plan_id, goal_id, workspace_id}
  repositories/  timeline.repository.js
db/dal/          timeline.dal.mjs
```

- **The message bus is the audit spine.** Every mutation path publishes a domain
  event; one subscriber calls `timelineService.recordEvent()`. (Today only
  `node.status.changed` + `episode.created` are published — Phase 2 expands this.)
- **`activity.controller` collapses** into `timeline.service.query()` — one read
  path replaces the hand-rolled UNION of logs + comments + decisions.

## Deliberately OUT of the unified table
- **`tool_calls`** stays as raw high-volume telemetry (every inbound call incl.
  reads). Only *material* (state-changing) calls are promoted to a timeline
  `event`, referencing the `tool_calls` row — so the Trace isn't drowned in `GET`s.
- **Graphiti episodes** stay separate (curated / semantic). The timeline *feeds*
  curated learnings; it is not the knowledge graph.

## Provenance envelope (the trust property)
`provenance` jsonb on every event:
`surface` (ui|mcp|api|cron) · `client_label` · `ip` · `token_id` ·
`work_mode` (shadow|suggest|assist|autonomous) · `policy_id` · `model` ·
`runtime` · `prompt_hash`. `work_mode=shadow` ⇒ event recorded with
`payload.executed=false` (shadow mode becomes trivial: agents emit intent events
that never execute).

## Migration (clean cut — no external users)
1. Create `timeline_entries` + the timeline domain (service/repo/dal) with the
   read path and comment write path.
2. Backfill: `plan_node_logs` → `kind=log` (`subject_type=node`),
   `plan_comments` → `kind=comment`; denormalize scope (node→plan→workspace→org).
3. Repoint comment/log controllers + the activity feed to `timeline.service`.
4. Drop `plan_node_logs` / `plan_comments`; retire dormant `audit_logs` into events.

## Phasing (mirrors the AgentPlanner plan)
1. **Timeline core** — schema/migration, DAL, repository, service (+ mutability
   policy, scope resolver), unit tests.
2. **Write spine** — publish events from all mutation sites; subscriber →
   `recordEvent`; promote material tool calls.
3. **Migrate logs + comments** — backfill, repoint controllers, drop old tables.
4. **Read API + Timeline UI** — `GET /timeline`, collapse the activity feed, one
   timeline component; comment box at node/plan/goal/workspace.
5. **Trace + provenance** — `correlation_id` stamping through a run, the Trace
   view, full provenance envelope. The "one lovable loop": agent run → captured
   trace → human review.

Non-goals for now: threaded replies (column reserved), eval/promote UI, full
event-sourcing (state-as-projection), tamper-evident ledger split.
