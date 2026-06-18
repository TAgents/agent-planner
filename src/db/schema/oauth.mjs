import { pgTable, text, uuid, jsonb, timestamp, index } from 'drizzle-orm/pg-core';

// ─── OAuth authorization-server state ────────────────────────────────────────
// Durable storage for the hosted MCP's OAuth 2.1 AS (claude.ai / Claude Design
// connectors). The MCP server reaches these via secret-guarded /internal/oauth
// endpoints — it has no direct DB access of its own.
//
// There is intentionally NO token table: the OAuth access_token IS the user's
// AgentPlanner JWT, so /mcp validates it statelessly and restarts never drop
// authenticated connections.

// Dynamically-registered OAuth clients (RFC 7591). Long-lived — a connector
// registers once and reuses its client_id across sessions.
export const oauthClients = pgTable('oauth_clients', {
  clientId: text('client_id').primaryKey(),
  clientSecret: text('client_secret'),                 // null for public (PKCE) clients
  clientName: text('client_name'),
  redirectUris: jsonb('redirect_uris').notNull().default([]),
  grantTypes: jsonb('grant_types').default([]),
  responseTypes: jsonb('response_types').default([]),
  scope: text('scope'),
  tokenEndpointAuthMethod: text('token_endpoint_auth_method').default('client_secret_basic'),
  metadata: jsonb('metadata').default({}),
  clientIdIssuedAt: timestamp('client_id_issued_at', { withTimezone: true }).defaultNow(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

// One-time PKCE authorization codes (~5 min TTL). Holds the user's short-lived
// AP JWT/refresh captured at consent; the row is deleted the moment the code is
// exchanged. (Hardening: encrypt the AP tokens at rest or mint-at-consume.)
export const oauthAuthCodes = pgTable('oauth_auth_codes', {
  code: text('code').primaryKey(),
  clientId: text('client_id').notNull(),
  codeChallenge: text('code_challenge'),
  codeChallengeMethod: text('code_challenge_method').default('S256'),
  redirectUri: text('redirect_uri').notNull(),
  scopes: jsonb('scopes').default([]),
  userId: uuid('user_id'),
  // Legacy: previously held the user's AP JWT. No longer written — tokens are
  // now minted from user_id at exchange time (see oauth_refresh_tokens).
  apAccessToken: text('ap_access_token'),
  apRefreshToken: text('ap_refresh_token'),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (t) => [
  index('oauth_auth_codes_expires_idx').on(t.expiresAt),
]);

// Opaque, revocable OAuth refresh tokens. The access token is a short-lived
// (1h) AP JWT validated statelessly on /mcp; the refresh token is the durable,
// revocable credential. Only the sha256 hash is stored (never the raw token),
// and it's bound to the issuing client_id. Revoke (or expiry) here kills the
// connection within the access-token TTL.
export const oauthRefreshTokens = pgTable('oauth_refresh_tokens', {
  tokenHash: text('token_hash').primaryKey(),
  clientId: text('client_id').notNull(),
  userId: uuid('user_id').notNull(),
  scopes: jsonb('scopes').default([]),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (t) => [
  index('oauth_refresh_tokens_user_client_idx').on(t.userId, t.clientId),
]);
