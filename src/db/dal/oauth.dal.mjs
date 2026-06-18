import { eq, lt, and, isNull } from 'drizzle-orm';
import { db } from '../connection.mjs';
import { oauthClients, oauthAuthCodes, oauthRefreshTokens } from '../schema/oauth.mjs';

// Data access for the hosted MCP OAuth authorization server. Reached only via
// the secret-guarded /internal/oauth endpoints (the MCP server has no DB).
export const oauthDal = {
  async registerClient(client) {
    const [row] = await db.insert(oauthClients).values(client).returning();
    return row;
  },

  async getClient(clientId) {
    const [row] = await db.select().from(oauthClients).where(eq(oauthClients.clientId, clientId)).limit(1);
    return row ?? null;
  },

  async createCode(record) {
    const [row] = await db.insert(oauthAuthCodes).values(record).returning();
    return row;
  },

  // Peek without consuming (used for the PKCE challenge lookup at /token).
  async getCode(code) {
    const [row] = await db.select().from(oauthAuthCodes).where(eq(oauthAuthCodes.code, code)).limit(1);
    if (!row) return null;
    if (new Date(row.expiresAt) < new Date()) return null;
    return row;
  },

  // One-time: returns the row and deletes it atomically. Null if missing/expired.
  async consumeCode(code) {
    return db.transaction(async (tx) => {
      const [row] = await tx.select().from(oauthAuthCodes).where(eq(oauthAuthCodes.code, code)).limit(1);
      if (!row) return null;
      await tx.delete(oauthAuthCodes).where(eq(oauthAuthCodes.code, code));
      if (new Date(row.expiresAt) < new Date()) return null;
      return row;
    });
  },

  // Housekeeping — drop expired codes (call periodically).
  async deleteExpiredCodes() {
    await db.delete(oauthAuthCodes).where(lt(oauthAuthCodes.expiresAt, new Date()));
  },

  // ── Refresh tokens (opaque, hashed, revocable) ─────────────────────────────
  async createRefreshToken(record) {
    const [row] = await db.insert(oauthRefreshTokens).values(record).returning();
    return row;
  },

  // Valid = exists, not revoked, not expired.
  async findValidRefreshToken(tokenHash) {
    const [row] = await db.select().from(oauthRefreshTokens)
      .where(and(eq(oauthRefreshTokens.tokenHash, tokenHash), isNull(oauthRefreshTokens.revokedAt)))
      .limit(1);
    if (!row) return null;
    if (new Date(row.expiresAt) < new Date()) return null;
    return row;
  },

  async revokeRefreshToken(tokenHash) {
    const [row] = await db.update(oauthRefreshTokens)
      .set({ revokedAt: new Date() })
      .where(and(eq(oauthRefreshTokens.tokenHash, tokenHash), isNull(oauthRefreshTokens.revokedAt)))
      .returning();
    return row ?? null;
  },

  // Revoke every active refresh token for a user (optionally scoped to a client)
  // — backs a "disconnect" action.
  async revokeRefreshTokensForUser(userId, clientId = null) {
    const cond = clientId
      ? and(eq(oauthRefreshTokens.userId, userId), eq(oauthRefreshTokens.clientId, clientId), isNull(oauthRefreshTokens.revokedAt))
      : and(eq(oauthRefreshTokens.userId, userId), isNull(oauthRefreshTokens.revokedAt));
    await db.update(oauthRefreshTokens).set({ revokedAt: new Date() }).where(cond);
  },
};
