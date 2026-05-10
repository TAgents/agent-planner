import { pgTable, uuid, text, timestamp, boolean, jsonb, index, unique } from 'drizzle-orm/pg-core';
import { users } from './users.mjs';
import { organizations } from './organizations.mjs';

// ─── Workspaces ──────────────────────────────────────────────────
// A live folder under an Organization. Owns goals and plans. Pure
// container — no semantic behavior beyond grouping.
export const workspaces = pgTable('workspaces', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id')
    .notNull()
    .references(() => organizations.id, { onDelete: 'cascade' }),
  ownerId: uuid('owner_id')
    .notNull()
    .references(() => users.id, { onDelete: 'restrict' }),
  title: text('title').notNull(),
  slug: text('slug').notNull(),
  description: text('description'),
  icon: text('icon'),
  isDefault: boolean('is_default').notNull().default(false),
  archivedAt: timestamp('archived_at', { withTimezone: true }),

  // Provenance: was this workspace forked from a blueprint?
  forkedFromBlueprintId: uuid('forked_from_blueprint_id'),
  forkedAt: timestamp('forked_at', { withTimezone: true }),

  metadata: jsonb('metadata').default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, (table) => [
  unique('workspaces_org_slug_unique').on(table.organizationId, table.slug),
  index('workspaces_org_idx').on(table.organizationId),
  index('workspaces_owner_idx').on(table.ownerId),
]);
