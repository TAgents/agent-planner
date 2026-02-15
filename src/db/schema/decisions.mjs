import { pgTable, uuid, text, timestamp, jsonb } from 'drizzle-orm/pg-core';
import { users } from './users.mjs';
import { plans } from './plans.mjs';
import { planNodes } from './plans.mjs';

// ─── Decision Requests ───────────────────────────────────────────
export const decisionRequests = pgTable('decision_requests', {
  id: uuid('id').primaryKey().defaultRandom(),
  planId: uuid('plan_id').notNull().references(() => plans.id, { onDelete: 'cascade' }),
  nodeId: uuid('node_id').references(() => planNodes.id, { onDelete: 'set null' }),

  // Requester
  requestedByUserId: uuid('requested_by_user_id').notNull().references(() => users.id),
  requestedByAgentName: text('requested_by_agent_name'),

  // Decision context
  title: text('title').notNull(),
  context: text('context').notNull(),
  options: jsonb('options').default([]),  // [{option, pros, cons, recommendation}]

  // Urgency: blocking | can_continue | informational
  urgency: text('urgency').notNull().default('can_continue'),

  // Status: pending | decided | expired | cancelled
  status: text('status').notNull().default('pending'),

  expiresAt: timestamp('expires_at', { withTimezone: true }),

  // Resolution
  decidedByUserId: uuid('decided_by_user_id').references(() => users.id),
  decision: text('decision'),
  rationale: text('rationale'),
  decidedAt: timestamp('decided_at', { withTimezone: true }),

  metadata: jsonb('metadata').default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});
