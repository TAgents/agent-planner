import { pgTable, uuid, text, timestamp, integer, boolean, varchar, jsonb, index, unique } from 'drizzle-orm/pg-core';
import { users } from './users.mjs';

// ─── Plan status/visibility enums as check constraints ───────────
// Using text + check rather than pgEnum for easier migration

// ─── Plans ───────────────────────────────────────────────────────
export const plans = pgTable('plans', {
  id: uuid('id').primaryKey().defaultRandom(),
  title: text('title').notNull(),
  description: text('description'),
  ownerId: uuid('owner_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  status: text('status').notNull().default('draft'),           // draft | active | completed | archived
  visibility: varchar('visibility', { length: 20 }).notNull().default('private'), // private | public | unlisted
  isPublic: boolean('is_public').notNull().default(false),     // legacy compat

  // GitHub integration
  githubRepoOwner: varchar('github_repo_owner', { length: 255 }),
  githubRepoName: varchar('github_repo_name', { length: 255 }),
  githubRepoUrl: text('github_repo_url'),
  githubRepoFullName: varchar('github_repo_full_name', { length: 512 }),

  // Stats
  viewCount: integer('view_count').notNull().default(0),
  lastViewedAt: timestamp('last_viewed_at', { withTimezone: true }),

  metadata: jsonb('metadata').default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

// ─── Plan Nodes (phases, tasks, milestones) ──────────────────────
export const planNodes = pgTable('plan_nodes', {
  id: uuid('id').primaryKey().defaultRandom(),
  planId: uuid('plan_id').notNull().references(() => plans.id, { onDelete: 'cascade' }),
  parentId: uuid('parent_id'),  // self-reference added via relations
  nodeType: text('node_type').notNull(),       // root | phase | task | milestone
  title: text('title').notNull(),
  description: text('description'),
  status: text('status').notNull().default('not_started'), // not_started | in_progress | completed | blocked
  orderIndex: integer('order_index').notNull().default(0),
  dueDate: timestamp('due_date', { withTimezone: true }),
  context: text('context'),
  agentInstructions: text('agent_instructions'),
  metadata: jsonb('metadata').default({}),

  // Agent request fields
  agentRequested: text('agent_requested'),           // start | review | help | continue
  agentRequestedAt: timestamp('agent_requested_at', { withTimezone: true }),
  agentRequestedBy: uuid('agent_requested_by').references(() => users.id),
  agentRequestMessage: text('agent_request_message'),

  // Agent assignment
  assignedAgentId: uuid('assigned_agent_id').references(() => users.id, { onDelete: 'set null' }),
  assignedAgentAt: timestamp('assigned_agent_at', { withTimezone: true }),
  assignedAgentBy: uuid('assigned_agent_by').references(() => users.id, { onDelete: 'set null' }),

  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, (table) => [
  index('plan_nodes_plan_id_idx').on(table.planId),
  index('plan_nodes_parent_id_idx').on(table.parentId),
  index('idx_plan_nodes_status').on(table.status),
  index('idx_plan_nodes_node_type').on(table.nodeType),
  unique('plan_nodes_unique_title_per_parent')
    .on(table.planId, table.parentId, table.title, table.nodeType)
    .nullsNotDistinct(),
]);

// ─── Plan Collaborators ──────────────────────────────────────────
export const planCollaborators = pgTable('plan_collaborators', {
  id: uuid('id').primaryKey().defaultRandom(),
  planId: uuid('plan_id').notNull().references(() => plans.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  role: text('role').notNull().default('viewer'),  // viewer | editor | admin
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

// ─── Plan Comments ───────────────────────────────────────────────
export const planComments = pgTable('plan_comments', {
  id: uuid('id').primaryKey().defaultRandom(),
  planNodeId: uuid('plan_node_id').notNull().references(() => planNodes.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  content: text('content').notNull(),
  commentType: text('comment_type').notNull().default('human'), // human | agent | system
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

// ─── Plan Node Labels ────────────────────────────────────────────
export const planNodeLabels = pgTable('plan_node_labels', {
  id: uuid('id').primaryKey().defaultRandom(),
  planNodeId: uuid('plan_node_id').notNull().references(() => planNodes.id, { onDelete: 'cascade' }),
  label: text('label').notNull(),
});

// ─── Plan Node Logs ──────────────────────────────────────────────
export const planNodeLogs = pgTable('plan_node_logs', {
  id: uuid('id').primaryKey().defaultRandom(),
  planNodeId: uuid('plan_node_id').notNull().references(() => planNodes.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  content: text('content').notNull(),
  logType: text('log_type').notNull(),  // progress | reasoning | challenge | decision
  metadata: jsonb('metadata').default({}),
  tags: text('tags').array().default([]),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});
