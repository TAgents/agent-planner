import { pgTable, uuid, text, timestamp, date, jsonb } from 'drizzle-orm/pg-core';
import { users } from './users.mjs';
import { plans } from './plans.mjs';

// ─── Goals ───────────────────────────────────────────────────────
export const goals = pgTable('goals', {
  id: uuid('id').primaryKey().defaultRandom(),
  ownerId: uuid('owner_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  description: text('description'),
  successMetrics: jsonb('success_metrics').default([]),  // [{metric, target, current, unit}]
  timeHorizon: date('time_horizon'),
  status: text('status').notNull().default('active'),    // active | achieved | at_risk | abandoned
  createdBy: uuid('created_by').notNull().references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

// ─── Plan ↔ Goal links ──────────────────────────────────────────
export const planGoals = pgTable('plan_goals', {
  id: uuid('id').primaryKey().defaultRandom(),
  planId: uuid('plan_id').notNull().references(() => plans.id, { onDelete: 'cascade' }),
  goalId: uuid('goal_id').notNull().references(() => goals.id, { onDelete: 'cascade' }),
  linkedAt: timestamp('linked_at', { withTimezone: true }).defaultNow(),
  linkedBy: uuid('linked_by').references(() => users.id),
});
