import { eq, and, isNull, sql } from 'drizzle-orm';
import { db } from '../connection.mjs';
import { nodeClaims } from '../schema/claims.mjs';

export const claimsDal = {
  /**
   * Claim a node for an agent. Rejects if an active claim already exists
   * (not released and not expired).
   *
   * @param {string} nodeId
   * @param {string} planId
   * @param {string} agentId
   * @param {string} userId - authenticated user who creates the claim
   * @param {number} ttlMinutes - lease duration (default 30)
   * @param {string[]} beliefSnapshot - episode IDs that justified this commitment
   * @returns {object|null} The created claim, or null if already claimed
   */
  async claim(nodeId, planId, agentId, userId, ttlMinutes = 30, beliefSnapshot = []) {
    // Use a single INSERT ... WHERE NOT EXISTS to avoid race conditions.
    // The unique partial index on (node_id) WHERE released_at IS NULL
    // provides an additional safety net at the DB level.
    const expiresAt = new Date(Date.now() + ttlMinutes * 60 * 1000);

    try {
      const [created] = await db.insert(nodeClaims).values({
        nodeId,
        planId,
        agentId,
        expiresAt,
        createdBy: userId,
        beliefSnapshot,
      }).returning();

      return created;
    } catch (err) {
      // Unique constraint violation means an active claim already exists.
      // However the unique index only guards non-released rows — we also
      // need to handle the case where a claim exists but is expired.
      if (err.code === '23505') {
        // Check if the existing claim is expired
        const existing = await this.getActiveClaim(nodeId);
        if (existing) {
          // Genuinely active — reject
          return null;
        }
        // The existing row is expired — release it and retry
        await this.releaseExpiredForNode(nodeId);
        try {
          const [created] = await db.insert(nodeClaims).values({
            nodeId,
            planId,
            agentId,
            expiresAt,
            createdBy: userId,
            beliefSnapshot,
          }).returning();
          return created;
        } catch {
          return null;
        }
      }
      throw err;
    }
  },

  /**
   * Release a claim (set released_at = now).
   * Only the agent that holds the claim can release it.
   *
   * @param {string} nodeId
   * @param {string} agentId
   * @returns {object|null} The released claim, or null if not found
   */
  async release(nodeId, agentId) {
    const [released] = await db.update(nodeClaims)
      .set({ releasedAt: new Date() })
      .where(
        and(
          eq(nodeClaims.nodeId, nodeId),
          eq(nodeClaims.agentId, agentId),
          isNull(nodeClaims.releasedAt),
        )
      )
      .returning();
    return released ?? null;
  },

  /**
   * Get the active claim for a node (not expired, not released).
   *
   * @param {string} nodeId
   * @returns {object|null}
   */
  async getActiveClaim(nodeId) {
    const [claim] = await db.select()
      .from(nodeClaims)
      .where(
        and(
          eq(nodeClaims.nodeId, nodeId),
          isNull(nodeClaims.releasedAt),
          sql`${nodeClaims.expiresAt} > now()`,
        )
      )
      .limit(1);
    return claim ?? null;
  },

  /**
   * List all active claims in a plan.
   *
   * @param {string} planId
   * @returns {Array}
   */
  async listActiveClaimsByPlan(planId) {
    return db.select()
      .from(nodeClaims)
      .where(
        and(
          eq(nodeClaims.planId, planId),
          isNull(nodeClaims.releasedAt),
          sql`${nodeClaims.expiresAt} > now()`,
        )
      );
  },

  /**
   * Bulk release all expired claims (maintenance / cleanup).
   * Sets released_at = now() for any claim whose expires_at has passed.
   *
   * @returns {number} Number of claims released
   */
  async releaseExpired() {
    const released = await db.update(nodeClaims)
      .set({ releasedAt: new Date() })
      .where(
        and(
          isNull(nodeClaims.releasedAt),
          sql`${nodeClaims.expiresAt} <= now()`,
        )
      )
      .returning();
    return released.length;
  },

  /**
   * Release expired claims for a specific node.
   * Used internally when retrying after a constraint violation.
   *
   * @param {string} nodeId
   */
  async releaseExpiredForNode(nodeId) {
    await db.update(nodeClaims)
      .set({ releasedAt: new Date() })
      .where(
        and(
          eq(nodeClaims.nodeId, nodeId),
          isNull(nodeClaims.releasedAt),
          sql`${nodeClaims.expiresAt} <= now()`,
        )
      );
  },
};
