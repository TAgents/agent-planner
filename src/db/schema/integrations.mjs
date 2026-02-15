import { pgTable, uuid, text, timestamp, boolean } from 'drizzle-orm/pg-core';
import { users } from './users.mjs';

// ─── Slack Integrations ──────────────────────────────────────────
export const slackIntegrations = pgTable('slack_integrations', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  teamId: text('team_id').notNull(),
  teamName: text('team_name').notNull(),
  botToken: text('bot_token').notNull(),  // encrypted at app level
  channelId: text('channel_id'),
  channelName: text('channel_name'),
  installedAt: timestamp('installed_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  isActive: boolean('is_active').notNull().default(true),
});

// ─── Webhook Settings ────────────────────────────────────────────
export const webhookSettings = pgTable('webhook_settings', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  url: text('url').notNull(),
  enabled: boolean('enabled').notNull().default(true),
  events: text('events').array().default([]),
  secret: text('secret'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});
