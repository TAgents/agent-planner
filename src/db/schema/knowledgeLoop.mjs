import { pgTable, uuid, text, timestamp, integer, jsonb, doublePrecision, index } from 'drizzle-orm/pg-core';
import { plans } from './plans.mjs';
import { goals } from './goals.mjs';
import { users } from './users.mjs';

// ─── Knowledge Loop Runs (BDI Phase 4) ───────────────────────────
// Tracks iterative plan improvement cycles driven by agents.
// Each run contains multiple iterations where the agent evaluates
// plan quality and proposes modifications.
export const knowledgeLoopRuns = pgTable('knowledge_loop_runs', {
  id: uuid('id').primaryKey().defaultRandom(),

  planId: uuid('plan_id').notNull().references(() => plans.id, { onDelete: 'cascade' }),
  goalId: uuid('goal_id').references(() => goals.id, { onDelete: 'set null' }),

  // running | converged | stopped | failed
  status: text('status').notNull().default('running'),

  maxIterations: integer('max_iterations').notNull().default(10),

  // Array of iteration records (see JSONB structure in plan doc)
  iterations: jsonb('iterations').default([]),

  // Quality scores at start and end
  qualityBefore: doublePrecision('quality_before'),
  qualityAfter: doublePrecision('quality_after'),

  // Who started the loop
  startedBy: uuid('started_by').references(() => users.id, { onDelete: 'set null' }),

  startedAt: timestamp('started_at', { withTimezone: true }).defaultNow(),
  completedAt: timestamp('completed_at', { withTimezone: true }),

  metadata: jsonb('metadata').default({}),
}, (table) => [
  index('idx_kl_runs_plan_id').on(table.planId),
  index('idx_kl_runs_goal_id').on(table.goalId),
  index('idx_kl_runs_status').on(table.status),
]);
