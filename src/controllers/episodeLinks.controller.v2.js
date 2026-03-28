/**
 * Episode Links Controller v2 — Link Graphiti episodes to plan nodes.
 * Part of the BDI Architecture layer.
 */
const dal = require('../db/dal.cjs');
const { checkPlanAccess } = require('../middleware/planAccess.middleware');

/** Convert camelCase link to snake_case for API output */
const snakeEpisodeLink = (l) => ({
  id: l.id,
  episode_id: l.episodeId,
  node_id: l.nodeId,
  link_type: l.linkType,
  created_at: l.createdAt,
});

const VALID_LINK_TYPES = ['supports', 'contradicts', 'informs'];

/**
 * POST /plans/:id/nodes/:nodeId/episode-links
 * Link a Graphiti episode to a task node.
 */
const linkEpisode = async (req, res, next) => {
  try {
    const { id: planId, nodeId } = req.params;
    const userId = req.user.id;
    const { episode_id, link_type = 'informs' } = req.body;

    if (!episode_id) {
      return res.status(400).json({ error: 'episode_id is required' });
    }

    if (!VALID_LINK_TYPES.includes(link_type)) {
      return res.status(400).json({ error: `Invalid link_type. Must be one of: ${VALID_LINK_TYPES.join(', ')}` });
    }

    if (!(await checkPlanAccess(planId, userId))) {
      return res.status(403).json({ error: 'You do not have access to this plan' });
    }

    const node = await dal.nodesDal.findById(nodeId);
    if (!node || node.planId !== planId) {
      return res.status(404).json({ error: 'Node not found in this plan' });
    }

    try {
      const link = await dal.episodeLinksDal.link(episode_id, nodeId, link_type);
      return res.status(201).json(snakeEpisodeLink(link));
    } catch (err) {
      // Drizzle wraps pg errors — check both err.code and err.cause.code
      const pgCode = err.code || err?.cause?.code;
      if (pgCode === '23505' || (err.message && err.message.includes('unique'))) {
        return res.status(409).json({ error: 'This episode is already linked to this node with this link type' });
      }
      throw err;
    }
  } catch (err) {
    next(err);
  }
};

/**
 * GET /plans/:id/nodes/:nodeId/episode-links
 * List episode links for a task node.
 */
const getEpisodeLinks = async (req, res, next) => {
  try {
    const { id: planId, nodeId } = req.params;
    const userId = req.user.id;
    const { link_type } = req.query;

    if (!(await checkPlanAccess(planId, userId))) {
      return res.status(403).json({ error: 'You do not have access to this plan' });
    }

    const node = await dal.nodesDal.findById(nodeId);
    if (!node || node.planId !== planId) {
      return res.status(404).json({ error: 'Node not found in this plan' });
    }

    const links = await dal.episodeLinksDal.listByNode(nodeId, link_type || undefined);
    return res.json(links.map(snakeEpisodeLink));
  } catch (err) {
    next(err);
  }
};

/**
 * DELETE /plans/:id/nodes/:nodeId/episode-links/:linkId
 * Remove an episode link.
 */
const unlinkEpisode = async (req, res, next) => {
  try {
    const { id: planId, linkId } = req.params;
    const userId = req.user.id;

    if (!(await checkPlanAccess(planId, userId))) {
      return res.status(403).json({ error: 'You do not have access to this plan' });
    }

    const deleted = await dal.episodeLinksDal.unlink(linkId);
    if (!deleted) {
      return res.status(404).json({ error: 'Episode link not found' });
    }

    return res.json(snakeEpisodeLink(deleted));
  } catch (err) {
    next(err);
  }
};

module.exports = { linkEpisode, getEpisodeLinks, unlinkEpisode };
