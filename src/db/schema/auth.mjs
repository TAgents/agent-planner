import { pgTable, uuid, text, timestamp, boolean } from 'drizzle-orm/pg-core';
import { users } from './users.mjs';

// ─── API Tokens ──────────────────────────────────────────────────
export const apiTokens = pgTable('api_tokens', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  tokenHash: text('token_hash').notNull(),
  permissions: text('permissions').array().default(['read']),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  lastUsed: timestamp('last_used', { withTimezone: true }),
  revoked: boolean('revoked').notNull().default(false),
});

// ─── Pending Invites ─────────────────────────────────────────────
export const pendingInvites = pgTable('pending_invites', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull(),
  planId: uuid('plan_id').notNull(),
  role: text('role').notNull().default('viewer'),
  invitedBy: uuid('invited_by').notNull().references(() => users.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
});
