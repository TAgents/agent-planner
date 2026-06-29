import { eq, lt, desc, and, gte, lte, sql } from 'drizzle-orm';
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

  /**
   * Most recent calls across ALL orgs, with optional filters + pagination.
   * Backs the admin activity feed (superadmin oversight only — bypasses org
   * scoping). Returns { entries, total } where total ignores limit/offset.
   *
   * @param {object} opts
   * @param {number} [opts.limit=50]
   * @param {number} [opts.offset=0]
   * @param {string} [opts.toolName]  exact match on tool_name
   * @param {number} [opts.responseStatus]  exact match on response_status
   * @param {string|Date} [opts.since]  createdAt >= since
   * @param {string|Date} [opts.until]  createdAt <= until
   */
  async listRecentAll({ limit = 50, offset = 0, toolName, responseStatus, errorsOnly = false, since, until } = {}) {
    const conds = [];
    if (toolName) conds.push(eq(toolCalls.toolName, toolName));
    if (responseStatus != null) conds.push(eq(toolCalls.responseStatus, Number(responseStatus)));
    if (errorsOnly) conds.push(gte(toolCalls.responseStatus, 400));
    if (since) conds.push(gte(toolCalls.createdAt, new Date(since)));
    if (until) conds.push(lte(toolCalls.createdAt, new Date(until)));
    const where = conds.length ? and(...conds) : undefined;

    const entries = await db
      .select()
      .from(toolCalls)
      .where(where)
      .orderBy(desc(toolCalls.createdAt))
      .limit(limit)
      .offset(offset);

    const [{ count }] = await db.select({ count: sql`count(*)::int` })
      .from(toolCalls)
      .where(where);

    return { entries, total: count };
  },

  /**
   * Delete telemetry rows older than `days` days. Used by the
   * retention background job to keep the table from growing unbounded.
   *
   * @param {number} days - Rows older than this are removed. Must be > 0.
   * @returns {Promise<number>} Number of rows deleted.
   */
  async purgeOlderThan(days) {
    if (!Number.isFinite(days) || days <= 0) {
      throw new Error(`purgeOlderThan: invalid days argument: ${days}`);
    }
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const deleted = await db
      .delete(toolCalls)
      .where(lt(toolCalls.createdAt, cutoff))
      .returning({ id: toolCalls.id });
    return deleted.length;
  },
};
