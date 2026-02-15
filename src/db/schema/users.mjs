import { pgTable, uuid, text, timestamp, varchar, pgEnum } from 'drizzle-orm/pg-core';

// ─── Users ───────────────────────────────────────────────────────
export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').unique().notNull(),
  name: text('name'),
  passwordHash: text('password_hash'), // null for OAuth-only users
  avatarUrl: text('avatar_url'),

  // GitHub OAuth
  githubId: varchar('github_id', { length: 255 }),
  githubUsername: varchar('github_username', { length: 255 }),
  githubAvatarUrl: text('github_avatar_url'),
  githubProfileUrl: text('github_profile_url'),

  // Agent metadata
  capabilityTags: text('capability_tags').array().default([]),

  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});
