import { pgTable, uuid, text, timestamp, varchar, integer, jsonb, index } from 'drizzle-orm/pg-core';
import { users } from './users.mjs';
import { organizations } from './organizations.mjs';

// ─── Blueprints ──────────────────────────────────────────────────
// Dehydrated, reusable shape. Forks into a Workspace (scope='workspace')
// or into a Plan inside a Workspace (scope='plan'). Captures structure
// only — claims, knowledge episodes, logs, decisions, statuses, and
// agent assignments are excluded.
export const blueprints = pgTable('blueprints', {
  id: uuid('id').primaryKey().defaultRandom(),
  ownerId: uuid('owner_id')
    .notNull()
    .references(() => users.id, { onDelete: 'restrict' }),
  organizationId: uuid('organization_id')
    .references(() => organizations.id, { onDelete: 'set null' }),

  title: text('title').notNull(),
  description: text('description'),
  scope: text('scope').notNull(),                          // 'plan' | 'workspace'
  visibility: varchar('visibility', { length: 20 })
    .notNull().default('private'),                         // private | public | unlisted
  version: integer('version').notNull().default(1),

  payload: jsonb('payload').notNull(),

  sourceWorkspaceId: uuid('source_workspace_id'),
  sourcePlanId: uuid('source_plan_id'),

  forkCount: integer('fork_count').notNull().default(0),
  tags: text('tags').array().default([]),

  // Gallery curation (v1.1) — see scripts/curate-blueprints.mjs.
  // tier: 'featured' | 'community' | 'experimental' | 'example'
  tier: text('tier'),
  audience: text('audience').array().default([]),
  useCase: text('use_case').array().default([]),
  durationLabel: text('duration_label'),
  outcome: text('outcome'),
  whyFork: text('why_fork'),

  publishedAt: timestamp('published_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, (table) => [
  index('blueprints_owner_idx').on(table.ownerId),
  index('blueprints_visibility_idx').on(table.visibility),
  index('blueprints_scope_idx').on(table.scope),
  index('blueprints_tier_idx').on(table.tier),
]);
