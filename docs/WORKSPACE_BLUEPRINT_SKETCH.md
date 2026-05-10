# Workspace + Blueprint — Schema Sketch

**Status:** v1.1 implemented on branch `feat/workspace-blueprint` (API, MCP, tests). Workspace-scope Blueprints (multi-plan/multi-goal payloads), frontend nav, and `NOT NULL` tightening are still pending — see Open questions at the end.

## The two concepts

```
Org
 └── Workspace  ←─ instantiate ─── Blueprint
      ├── Goals                   (template, public/private,
      └── Plans → Nodes            forkable, shareable)
                ↑
                └── save as ──→ new Blueprint
```

- **Workspace** — live folder under an Organization. Owns goals and plans. Pure container, no semantic behavior.
- **Blueprint** — dehydrated, reusable shape. Forks into a Workspace (or into a Plan inside an existing Workspace). Snapshots structure, not run-state.

Goal and Plan keep their current meaning. No "Initiative" noun.

## Schema

### `workspaces`

```js
// src/db/schema/workspaces.mjs
import { pgTable, uuid, text, timestamp, jsonb, index, unique } from 'drizzle-orm/pg-core';
import { users } from './users.mjs';
import { organizations } from './organizations.mjs';

export const workspaces = pgTable('workspaces', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id')
    .notNull()
    .references(() => organizations.id, { onDelete: 'cascade' }),
  ownerId: uuid('owner_id')
    .notNull()
    .references(() => users.id, { onDelete: 'restrict' }),
  title: text('title').notNull(),
  slug: text('slug').notNull(),                    // for URLs: /w/:slug
  description: text('description'),
  icon: text('icon'),                              // emoji or token
  isDefault: boolean('is_default').notNull().default(false),
  archivedAt: timestamp('archived_at', { withTimezone: true }),

  // Provenance: was this workspace forked from a blueprint?
  forkedFromBlueprintId: uuid('forked_from_blueprint_id'),
  forkedAt: timestamp('forked_at', { withTimezone: true }),

  metadata: jsonb('metadata').default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, (table) => [
  unique('workspaces_org_slug_unique').on(table.organizationId, table.slug),
  index('workspaces_org_idx').on(table.organizationId),
]);
```

### `blueprints`

```js
// src/db/schema/blueprints.mjs
import { pgTable, uuid, text, timestamp, varchar, integer, jsonb, index } from 'drizzle-orm/pg-core';
import { users } from './users.mjs';
import { organizations } from './organizations.mjs';

export const blueprints = pgTable('blueprints', {
  id: uuid('id').primaryKey().defaultRandom(),
  ownerId: uuid('owner_id')
    .notNull()
    .references(() => users.id, { onDelete: 'restrict' }),
  organizationId: uuid('organization_id')
    .references(() => organizations.id, { onDelete: 'set null' }),

  title: text('title').notNull(),
  description: text('description'),
  scope: text('scope').notNull(),                  // 'plan' | 'workspace'
  visibility: varchar('visibility', { length: 20 })
    .notNull().default('private'),                 // private | public | unlisted
  version: integer('version').notNull().default(1),

  // The dehydrated shape. JSON tree of goals/plans/nodes/dependencies.
  // Captures: titles, descriptions, agent_instructions, task_mode,
  //           parent/order, dep edges, success_criteria templates.
  // Excludes: claims, knowledge episodes, decisions, run-state status,
  //           assigned agents, comments, logs.
  payload: jsonb('payload').notNull(),

  // Optional: derived from a live workspace/plan
  sourceWorkspaceId: uuid('source_workspace_id'),
  sourcePlanId: uuid('source_plan_id'),

  // Marketplace / discovery
  forkCount: integer('fork_count').notNull().default(0),
  tags: text('tags').array().default([]),

  publishedAt: timestamp('published_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, (table) => [
  index('blueprints_owner_idx').on(table.ownerId),
  index('blueprints_visibility_idx').on(table.visibility),
]);
```

### FKs added to existing tables

Both additive, both nullable to keep migration painless.

```diff
 // src/db/schema/goals.mjs
 export const goals = pgTable('goals', {
   id: uuid('id').primaryKey().defaultRandom(),
   ...
   organizationId: uuid('organization_id').references(() => organizations.id, { onDelete: 'set null' }),
+  workspaceId: uuid('workspace_id')
+    .references(() => workspaces.id, { onDelete: 'set null' }),
   ...
 });

 // src/db/schema/plans.mjs
 export const plans = pgTable('plans', {
   id: uuid('id').primaryKey().defaultRandom(),
   ...
   organizationId: uuid('organization_id').references(() => organizations.id, { onDelete: 'set null' }),
+  workspaceId: uuid('workspace_id')
+    .references(() => workspaces.id, { onDelete: 'set null' }),
+  forkedFromBlueprintId: uuid('forked_from_blueprint_id')
+    .references(() => blueprints.id, { onDelete: 'set null' }),
+  forkedAt: timestamp('forked_at', { withTimezone: true }),
   ...
 });
```

Indexes:
```sql
CREATE INDEX goals_workspace_idx ON goals(workspace_id);
CREATE INDEX plans_workspace_idx ON plans(workspace_id);
```

## Migration plan

Strictly additive — no rename, no drop. Three steps:

1. **0042_workspaces_blueprints.sql** — create `workspaces` + `blueprints` tables, add nullable FKs to `goals` and `plans`.
2. **Backfill** — for each Organization, create a `Default` workspace; assign all existing goals + plans to it. Idempotent script.
3. **Tighten (later, separate migration)** — once UI + API + MCP are workspace-aware, make `workspace_id NOT NULL` on goals and plans. Until then, `NULL` means "uncategorized" and the UI shows it under a virtual "Inbox" workspace.

## API surface (minimum)

- `POST /workspaces` / `GET /workspaces` / `PATCH /workspaces/:id` / `DELETE /workspaces/:id`
- `GET /workspaces/:id/goals` and `/plans` (scoped lists; existing list endpoints gain `?workspace_id=` filter)
- `POST /blueprints` (from scratch or from a source workspace/plan)
- `POST /blueprints/:id/fork` — body: `{ target: 'new_workspace' | { workspace_id }, title? }` → returns new workspace or new plan
- `POST /workspaces/:id/save_as_blueprint`
- `POST /plans/:id/save_as_blueprint`

## MCP tools (additions, no rename)

- `list_workspaces`, `create_workspace`
- `list_blueprints`, `fork_blueprint`, `save_as_blueprint`
- Existing tools (`list_plans`, `list_goals`, `briefing`) gain optional `workspace_id` filter

## Blueprint payload shape (rough)

```json
{
  "version": 1,
  "scope": "workspace",
  "goals": [
    { "key": "g1", "title": "...", "type": "outcome", "success_criteria": {...}, "parent_goal_key": null }
  ],
  "plans": [
    {
      "key": "p1",
      "title": "...",
      "linked_goal_keys": ["g1"],
      "nodes": [
        { "key": "n1", "title": "...", "node_type": "phase", "parent_key": null, "order": 0 },
        { "key": "n2", "title": "...", "node_type": "task", "task_mode": "research",
          "parent_key": "n1", "order": 0, "agent_instructions": "..." }
      ],
      "dependencies": [
        { "source_key": "n2", "target_key": "n3", "type": "blocks" }
      ]
    }
  ]
}
```

Keys are local to the payload; fork generates fresh UUIDs.

## What Blueprint deliberately does NOT capture

- `node_claims` (run-state)
- Knowledge episodes / Graphiti graph (org-private knowledge)
- `plan_node_logs`, `decisions`, `goal_evaluations` (history)
- Status fields (`not_started` is the fork-time default for every node)
- Agent assignments, comments, integrations
- `quality_score`, `coherence_status` (assessed post-fork)

## Open questions

1. **Default workspace for solo users** — auto-create one named after the user's org so the flat case still works. Confirmed direction.
2. **Workspace permissions** — inherit from organization, or get their own collaborators table? Lean: inherit for v1; add `workspace_collaborators` only if a user asks for sub-org scoping.
3. **Goal hierarchy across workspaces** — `parent_goal_id` already exists. Should we forbid cross-workspace parents? Lean: yes, otherwise workspaces stop being folders.
4. **Blueprint versioning** — `version` field is in the schema but no `blueprint_versions` table yet. Defer until someone publishes a v2.
5. **Public Blueprint discovery** — surface in UI as a gallery, or only via direct link in v1? Lean: direct link only, gallery later.
6. **Fork semantics for a `plan`-scope blueprint** — does it always require a target workspace, or can it create one implicitly? Lean: require explicit target; "create new workspace" is the workspace-scope blueprint's job.

## Why this is the smaller move than the 4-noun reframe

- Two new tables, two nullable FKs. No rename of `plans` or `goals`. No MCP tool rename. No homepage rewrite.
- Cowork integration keeps working — its current calls to `list_plans` / `briefing` still return everything; the new `workspace_id` filter is opt-in.
- Reversible: dropping both tables and the FKs leaves the system in its current state.
