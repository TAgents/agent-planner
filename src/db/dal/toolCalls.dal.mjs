import { eq, desc } from 'drizzle-orm';
import { db } from '../connection.mjs';
import { toolCalls } from '../schema/toolCalls.mjs';

/**
 * Telemetry write path for inbound MCP / REST tool calls.
 * Writes are best-effort: callers should NOT await `record()` on the
 * request path — pass it through fire-and-forget. Telemetry never
 * gates a user-visible response.
 */
export const toolCallsDal = {
  /**
   * Insert one tool-call telemetry row.
   * Returns the created row, or null if the insert failed (logged).
   */
  async record({
    tokenId = null,
    organizationId = null,
    toolName,
    clientLabel = null,
    userAgent = null,
    ip = null,
    durationMs = null,
    responseStatus = null,
  }) {
    if (!toolName) return null;
    try {
      const [created] = await db
        .insert(toolCalls)
        .values({
          tokenId,
          organizationId,
          toolName,
          clientLabel,
          userAgent,
          ip,
          durationMs,
          responseStatus,
        })
        .returning();
      return created;
    } catch (err) {
      // Telemetry must never break the request path. Log and swallow.
      // eslint-disable-next-line no-console
      console.error('[toolCallsDal.record] insert failed:', err.message);
      return null;
    }
  },

  /**
   * Most recent calls for a single API token. Backs the per-token
   * "recent activity" expand row in Settings → Integrations.
   */
  async listByToken(tokenId, { limit = 20 } = {}) {
    return db
      .select()
      .from(toolCalls)
      .where(eq(toolCalls.tokenId, tokenId))
      .orderBy(desc(toolCalls.createdAt))
      .limit(limit);
  },

  /**
   * Most recent calls org-wide. Backs the Activity stream and
   * Mission Control summaries.
   */
  async recentByOrg(organizationId, { limit = 50 } = {}) {
    return db
      .select()
      .from(toolCalls)
      .where(eq(toolCalls.organizationId, organizationId))
      .orderBy(desc(toolCalls.createdAt))
      .limit(limit);
  },
};
