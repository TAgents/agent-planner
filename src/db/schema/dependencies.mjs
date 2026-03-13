import { pgTable, uuid, text, timestamp, integer, jsonb, index, unique, check } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { planNodes } from './plans.mjs';
import { users } from './users.mjs';
import { goals } from './goals.mjs';

// ─── Node Dependencies (edge table for dependency graph) ────────
// Stores directed edges between plan nodes, or from nodes to goals.
// Uses PostgreSQL recursive CTEs for graph traversal — no graph DB needed.
export const nodeDependencies = pgTable('node_dependencies', {
  id: uuid('id').primaryKey().defaultRandom(),

  // Source node (the dependency / prerequisite)
  sourceNodeId: uuid('source_node_id').notNull().references(() => planNodes.id, { onDelete: 'cascade' }),

  // Target node (the dependent — blocked/requires the source)
  // Nullable: for 'achieves' edges, target is a goal instead
  targetNodeId: uuid('target_node_id').references(() => planNodes.id, { onDelete: 'cascade' }),

  // Target goal — for 'achieves' edges (task→goal link)
  // Mutually exclusive with targetNodeId
  targetGoalId: uuid('target_goal_id').references(() => goals.id, { onDelete: 'cascade' }),

  // Edge type determines scheduling semantics
  // blocks: hard dep — target cannot start until source completes
  // requires: soft — target needs source output but can start
  // relates_to: informational — no scheduling constraint
  // enables: source unlocks target capability
  // achieves: task→goal link — source task contributes to target goal
  dependencyType: text('dependency_type').notNull().default('blocks'),

  // Weight for critical path calculation (default 1)
  weight: integer('weight').notNull().default(1),

  // Arbitrary metadata (e.g., notes on why this dependency exists)
  metadata: jsonb('metadata').default({}),

  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, (table) => [
  // Prevent duplicate node→node edges of the same type
  unique('node_deps_unique_edge').on(table.sourceNodeId, table.targetNodeId, table.dependencyType),

  // Prevent duplicate node→goal edges of the same type
  unique('node_deps_unique_goal_edge').on(table.sourceNodeId, table.targetGoalId, table.dependencyType),

  // Exactly one target must be set (node XOR goal)
  check('node_deps_target_xor', sql`(${table.targetNodeId} IS NOT NULL AND ${table.targetGoalId} IS NULL) OR (${table.targetNodeId} IS NULL AND ${table.targetGoalId} IS NOT NULL)`),

  // No self-references (only applies when targetNodeId is set)
  check('node_deps_no_self_ref', sql`${table.targetNodeId} IS NULL OR ${table.sourceNodeId} != ${table.targetNodeId}`),

  // Indexes for both directions of traversal
  index('idx_node_deps_source').on(table.sourceNodeId),
  index('idx_node_deps_target').on(table.targetNodeId),
  index('idx_node_deps_target_goal').on(table.targetGoalId),
  index('idx_node_deps_source_type').on(table.sourceNodeId, table.dependencyType),
  index('idx_node_deps_target_type').on(table.targetNodeId, table.dependencyType),
  index('idx_node_deps_target_goal_type').on(table.targetGoalId, table.dependencyType),
]);
