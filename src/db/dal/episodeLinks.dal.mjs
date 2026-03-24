import { eq, and, inArray } from 'drizzle-orm';
import { db } from '../connection.mjs';
import { episodeNodeLinks } from '../schema/episodeLinks.mjs';

export const episodeLinksDal = {
  /**
   * Link a Graphiti episode to a plan node.
   *
   * @param {string} episodeId - Graphiti episode UUID
   * @param {string} nodeId - Plan node UUID
   * @param {string} linkType - supports | contradicts | informs
   * @returns {object} The created link
   */
  async link(episodeId, nodeId, linkType = 'informs') {
    const [created] = await db.insert(episodeNodeLinks).values({
      episodeId,
      nodeId,
      linkType,
    }).returning();
    return created;
  },

  /**
   * Remove a specific link by ID.
   *
   * @param {string} id - Link UUID
   * @returns {object|null} The deleted link, or null if not found
   */
  async unlink(id) {
    const [deleted] = await db.delete(episodeNodeLinks)
      .where(eq(episodeNodeLinks.id, id))
      .returning();
    return deleted ?? null;
  },

  /**
   * Remove all links for a node.
   *
   * @param {string} nodeId
   * @returns {number} Number of links removed
   */
  async unlinkAllForNode(nodeId) {
    const deleted = await db.delete(episodeNodeLinks)
      .where(eq(episodeNodeLinks.nodeId, nodeId))
      .returning();
    return deleted.length;
  },

  /**
   * List links for a node, optionally filtered by link type.
   *
   * @param {string} nodeId
   * @param {string} [linkType] - Optional filter
   * @returns {Array}
   */
  async listByNode(nodeId, linkType) {
    const conditions = [eq(episodeNodeLinks.nodeId, nodeId)];
    if (linkType) conditions.push(eq(episodeNodeLinks.linkType, linkType));
    return db.select().from(episodeNodeLinks).where(and(...conditions));
  },

  /**
   * List all nodes linked to an episode (for coherence checks:
   * "which tasks depend on this episode?").
   *
   * @param {string} episodeId - Graphiti episode UUID
   * @returns {Array}
   */
  async listByEpisode(episodeId) {
    return db.select().from(episodeNodeLinks)
      .where(eq(episodeNodeLinks.episodeId, episodeId));
  },

  /**
   * Batch query: list links for multiple nodes.
   *
   * @param {string[]} nodeIds
   * @returns {Array}
   */
  async listByNodeIds(nodeIds) {
    if (nodeIds.length === 0) return [];
    return db.select().from(episodeNodeLinks)
      .where(inArray(episodeNodeLinks.nodeId, nodeIds));
  },
};
