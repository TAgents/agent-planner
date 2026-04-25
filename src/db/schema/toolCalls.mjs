import { pgTable, uuid, text, integer, timestamp, index } from 'drizzle-orm/pg-core';
import { apiTokens } from './auth.mjs';
import { organizations } from './organizations.mjs';

// ─── Tool Calls (MCP/REST tool invocation telemetry) ──────────────
// One row per inbound tool/API call, written by the auth/MCP layer.
// Powers the Settings → Integrations dashboard (recent calls per token,
// connection liveness) and the per-org Activity surface in the v1 UI.
//
// Indexed on (token_id, created_at DESC) so the common query
// "show me the last N calls from this connection" is a fast index seek.
export const toolCalls = pgTable('tool_calls', {
  id: uuid('id').primaryKey().defaultRandom(),

  // The API token that made the call. SET NULL on token delete so we
  // keep historical telemetry even if a token is revoked + purged.
  tokenId: uuid('token_id').references(() => apiTokens.id, { onDelete: 'set null' }),

  // Denormalised tenant reference for fast org-scoped reads. Cascade
  // delete with the org since telemetry isn't useful without context.
  organizationId: uuid('organization_id').references(() => organizations.id, { onDelete: 'cascade' }),

  // Logical name of the tool/endpoint called. For MCP: tool name
  // (e.g. "claim_next_task"). For REST: route key (e.g. "GET /plans/:id").
  toolName: text('tool_name').notNull(),

  // Free-form client label so the dashboard can show which client made
  // the call: "Claude Desktop", "Claude Code", "Cursor", "ChatGPT", etc.
  // Best-effort — may be null for legacy/unidentified callers.
  clientLabel: text('client_label'),

  userAgent: text('user_agent'),
  ip: text('ip'),

  // Server-side measured wall-clock duration in milliseconds.
  durationMs: integer('duration_ms'),

  // HTTP-equivalent response status (200, 4xx, 5xx). For MCP errors,
  // map to the closest HTTP status (e.g. 500 for tool exception).
  responseStatus: integer('response_status'),

  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  // Most-common query pattern: "last N calls for token X" → range scan.
  // (token_id, created_at DESC) covers token-scoped history fetches.
  index('idx_tool_calls_token_created').on(table.tokenId, table.createdAt.desc()),

  // Org-wide activity surface (Mission Control, Settings → Integrations
  // top-of-page summaries) needs efficient reads scoped to a tenant.
  index('idx_tool_calls_org_created').on(table.organizationId, table.createdAt.desc()),
]);
