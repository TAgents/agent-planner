import { pgTable, uuid, text, timestamp, jsonb } from 'drizzle-orm/pg-core';
import { users } from './users.mjs';
import { plans } from './plans.mjs';
import { planNodes } from './plans.mjs';

// ─── Agent Heartbeats ────────────────────────────────────────────
export const agentHeartbeats = pgTable('agent_heartbeats', {
  userId: uuid('user_id').primaryKey().references(() => users.id, { onDelete: 'cascade' }),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
  status: text('status').notNull().default('online'),  // online | active | idle | offline
  currentPlanId: uuid('current_plan_id').references(() => plans.id, { onDelete: 'set null' }),
  currentTaskId: uuid('current_task_id').references(() => planNodes.id, { onDelete: 'set null' }),
  metadata: jsonb('metadata').default({}),
});

// ─── Handoffs ────────────────────────────────────────────────────
export const handoffs = pgTable('handoffs', {
  id: uuid('id').primaryKey().defaultRandom(),
  planId: uuid('plan_id').notNull().references(() => plans.id, { onDelete: 'cascade' }),
  nodeId: uuid('node_id').notNull().references(() => planNodes.id, { onDelete: 'cascade' }),
  fromAgentId: uuid('from_agent_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  toAgentId: uuid('to_agent_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  message: text('message'),
  status: text('status').notNull().default('pending'),  // pending | accepted | rejected
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
});
