import { pgTable, uuid, text, timestamp, index, unique } from 'drizzle-orm/pg-core';
import { planNodes } from './plans.mjs';

// ─── Episode-Node Links (Graphiti episode ↔ plan task) ──────────
// Bridges Graphiti knowledge episodes to PostgreSQL plan nodes.
// Episode IDs are Graphiti-internal UUIDs (text, NOT PostgreSQL FKs).
export const episodeNodeLinks = pgTable('episode_node_links', {
  id: uuid('id').primaryKey().defaultRandom(),

  // Graphiti episode UUID (text, not a PostgreSQL FK)
  episodeId: text('episode_id').notNull(),

  // The plan node this episode relates to
  nodeId: uuid('node_id').notNull().references(() => planNodes.id, { onDelete: 'cascade' }),

  // How the episode relates to the task
  // supports: evidence supporting the task approach
  // contradicts: evidence against the task approach
  // informs: general context/information
  linkType: text('link_type').notNull().default('informs'),

  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (table) => [
  unique('episode_node_links_unique').on(table.episodeId, table.nodeId, table.linkType),
  index('idx_episode_node_links_node_id').on(table.nodeId),
  index('idx_episode_node_links_episode_id').on(table.episodeId),
  index('idx_episode_node_links_type').on(table.linkType),
]);
