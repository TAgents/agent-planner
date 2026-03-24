import { pgTable, uuid, text, timestamp, integer, jsonb, unique } from 'drizzle-orm/pg-core';
import { users } from './users.mjs';
import { organizations } from './organizations.mjs';

// ─── Goals (v2) ──────────────────────────────────────────────────
export const goals = pgTable('goals', {
  id: uuid('id').primaryKey().defaultRandom(),
  title: text('title').notNull(),
  description: text('description'),
  ownerId: uuid('owner_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  organizationId: uuid('organization_id').references(() => organizations.id, { onDelete: 'set null' }),
  type: text('type').notNull(),            // outcome | constraint | metric | principle
  status: text('status').notNull().default('active'),  // active | achieved | paused | abandoned
  // BDI desire/intention distinction
  goalType: text('goal_type').notNull().default('desire'),  // desire | intention
  promotedAt: timestamp('promoted_at', { withTimezone: true }),  // when desire became intention
  successCriteria: jsonb('success_criteria'),
  priority: integer('priority').default(0),
  parentGoalId: uuid('parent_goal_id'),    // self-ref for hierarchy
  // Coherence tracking — compared to updatedAt to detect staleness
  coherenceCheckedAt: timestamp('coherence_checked_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

// ─── Goal Links (generic: plan, task, agent, workflow) ───────────
export const goalLinks = pgTable('goal_links', {
  id: uuid('id').primaryKey().defaultRandom(),
  goalId: uuid('goal_id').notNull().references(() => goals.id, { onDelete: 'cascade' }),
  linkedType: text('linked_type').notNull(),   // plan | task | agent
  linkedId: uuid('linked_id').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (table) => ({
  uniqueLink: unique().on(table.goalId, table.linkedType, table.linkedId),
}));

// ─── Goal Evaluations ───────────────────────────────────────────
export const goalEvaluations = pgTable('goal_evaluations', {
  id: uuid('id').primaryKey().defaultRandom(),
  goalId: uuid('goal_id').notNull().references(() => goals.id, { onDelete: 'cascade' }),
  evaluatedAt: timestamp('evaluated_at', { withTimezone: true }).defaultNow(),
  evaluatedBy: text('evaluated_by').notNull(),
  score: integer('score'),
  reasoning: text('reasoning'),
  suggestedActions: jsonb('suggested_actions'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

// Legacy compat — keep planGoals export name but point to goalLinks concept
// (removed old planGoals table — migration handles rename)
