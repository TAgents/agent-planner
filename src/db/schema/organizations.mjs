import { pgTable, uuid, text, timestamp, boolean, unique, index } from 'drizzle-orm/pg-core';
import { users } from './users.mjs';

// ─── Organizations ───────────────────────────────────────────────
export const organizations = pgTable('organizations', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  slug: text('slug').unique().notNull(),
  description: text('description'),
  isPersonal: boolean('is_personal').notNull().default(false),
  avatarUrl: text('avatar_url'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, (table) => [
  index('idx_organizations_slug').on(table.slug),
]);

// ─── Organization Members ────────────────────────────────────────
export const organizationMembers = pgTable('organization_members', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  role: text('role').notNull().default('member'),  // owner | admin | member
  joinedAt: timestamp('joined_at', { withTimezone: true }).defaultNow(),
}, (table) => [
  unique('organization_members_org_user_unique').on(table.organizationId, table.userId),
  index('idx_org_members_org').on(table.organizationId),
  index('idx_org_members_user').on(table.userId),
]);
