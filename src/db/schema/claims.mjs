import { pgTable, uuid, text, timestamp, index, unique } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { planNodes, plans } from './plans.mjs';
import { users } from './users.mjs';

// ─── Node Claims (agent task lease/lock) ─────────────────────────
// Prevents two agents from working on the same task simultaneously.
// A claim is "active" when released_at IS NULL and expires_at > now().
export const nodeClaims = pgTable('node_claims', {
  id: uuid('id').primaryKey().defaultRandom(),

  // The node (task) being claimed
  nodeId: uuid('node_id').notNull().references(() => planNodes.id, { onDelete: 'cascade' }),

  // Agent identifier (free-form text, e.g. "claude-agent-1")
  agentId: text('agent_id').notNull(),

  // Denormalised plan reference for efficient per-plan queries
  planId: uuid('plan_id').notNull().references(() => plans.id, { onDelete: 'cascade' }),

  // Timestamps
  claimedAt: timestamp('claimed_at', { withTimezone: true }).defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  releasedAt: timestamp('released_at', { withTimezone: true }),

  // The user who created the claim (via API auth)
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
}, (table) => [
  // Indexes for common query patterns
  index('idx_node_claims_node_id').on(table.nodeId),
  index('idx_node_claims_agent_id').on(table.agentId),
  index('idx_node_claims_expires_at').on(table.expiresAt),
  index('idx_node_claims_plan_id').on(table.planId),
]);
// NOTE: Partial unique constraint (one active claim per node) is enforced
// in the DAL via SELECT-before-INSERT, since Drizzle Kit doesn't support
// partial unique indexes. Add manually via migration if needed:
// CREATE UNIQUE INDEX node_claims_active_unique ON node_claims (node_id) WHERE released_at IS NULL;
