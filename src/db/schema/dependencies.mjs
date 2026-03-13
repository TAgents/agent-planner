import { pgTable, uuid, text, timestamp, integer, jsonb, index, unique, check } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { planNodes } from './plans.mjs';
import { users } from './users.mjs';

// ─── Node Dependencies (edge table for dependency graph) ────────
// Stores directed edges between plan nodes.
// Uses PostgreSQL recursive CTEs for graph traversal — no graph DB needed.
export const nodeDependencies = pgTable('node_dependencies', {
  id: uuid('id').primaryKey().defaultRandom(),

  // Source node (the dependency / prerequisite)
  sourceNodeId: uuid('source_node_id').notNull().references(() => planNodes.id, { onDelete: 'cascade' }),

  // Target node (the dependent — blocked/requires the source)
  targetNodeId: uuid('target_node_id').notNull().references(() => planNodes.id, { onDelete: 'cascade' }),

  // Edge type determines scheduling semantics
  // blocks: hard dep — target cannot start until source completes
  // requires: soft — target needs source output but can start
  // relates_to: informational — no scheduling constraint
  // enables: source unlocks target capability
  // achieves: task→goal link (Phase 7)
  dependencyType: text('dependency_type').notNull().default('blocks'),

  // Weight for critical path calculation (default 1)
  weight: integer('weight').notNull().default(1),

  // Arbitrary metadata (e.g., notes on why this dependency exists)
  metadata: jsonb('metadata').default({}),

  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, (table) => [
  // Prevent duplicate edges of the same type
  unique('node_deps_unique_edge').on(table.sourceNodeId, table.targetNodeId, table.dependencyType),

  // No self-references
  check('node_deps_no_self_ref', sql`${table.sourceNodeId} != ${table.targetNodeId}`),

  // Indexes for both directions of traversal
  index('idx_node_deps_source').on(table.sourceNodeId),
  index('idx_node_deps_target').on(table.targetNodeId),
  index('idx_node_deps_source_type').on(table.sourceNodeId, table.dependencyType),
  index('idx_node_deps_target_type').on(table.targetNodeId, table.dependencyType),
]);
