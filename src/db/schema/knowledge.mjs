import { pgTable, uuid, text, timestamp, jsonb, index, integer } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { users } from './users.mjs';

// ─── Knowledge Entries (with pgvector for semantic search) ───────
export const knowledgeEntries = pgTable('knowledge_entries', {
  id: uuid('id').primaryKey().defaultRandom(),
  ownerId: uuid('owner_id').notNull().references(() => users.id, { onDelete: 'cascade' }),

  // Scope: global | plan | task
  scope: text('scope').notNull().default('global'),
  scopeId: uuid('scope_id'),  // plan_id or task_id depending on scope

  // Content
  entryType: text('entry_type').notNull().default('note'),  // decision | learning | context | constraint | reference | note
  title: text('title').notNull(),
  content: text('content').notNull(),
  tags: text('tags').array().default([]),
  source: text('source'),  // agent | human | import

  // Vector embedding (1536 dims for OpenAI ada-002, adjust as needed)
  // Stored as vector type via pgvector — raw SQL for custom type
  // embedding: will be added via raw migration since Drizzle doesn't natively support vector

  metadata: jsonb('metadata').default({}),
  createdBy: text('created_by'),  // user name or agent name
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, (table) => [
  index('idx_knowledge_owner').on(table.ownerId),
  index('idx_knowledge_scope').on(table.scope, table.scopeId),
  index('idx_knowledge_type').on(table.entryType),
]);
