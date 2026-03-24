/**
 * Claims Controller v2 — Task claim/lease for multi-agent coordination.
 * Prevents two agents from working on the same task simultaneously.
 */
const dal = require('../db/dal.cjs');

/**
 * Check plan access via DAL
 */
const checkPlanAccess = async (planId, userId) => {
  const { hasAccess } = await dal.plansDal.userHasAccess(planId, userId);
  return hasAccess;
};

/** Convert camelCase claim to snake_case for API output */
const snakeClaim = (c) => ({
  id: c.id,
  node_id: c.nodeId,
  agent_id: c.agentId,
  plan_id: c.planId,
  claimed_at: c.claimedAt,
  expires_at: c.expiresAt,
  released_at: c.releasedAt,
  created_by: c.createdBy,
  belief_snapshot: c.beliefSnapshot,
});

/**
 * POST /plans/:id/nodes/:nodeId/claim
 * Claim a task for an agent.
 */
const claimTask = async (req, res, next) => {
  try {
    const { id: planId, nodeId } = req.params;
    const userId = req.user.id;
    const { agent_id, ttl_minutes, belief_snapshot } = req.body;

    if (!agent_id) {
      return res.status(400).json({ error: 'agent_id is required' });
    }

    // Check plan access
    if (!(await checkPlanAccess(planId, userId))) {
      return res.status(403).json({ error: 'You do not have access to this plan' });
    }

    // Check node exists and belongs to plan
    const node = await dal.nodesDal.findById(nodeId);
    if (!node || node.planId !== planId) {
      return res.status(404).json({ error: 'Node not found in this plan' });
    }

    // Attempt to claim
    const ttl = ttl_minutes && Number(ttl_minutes) > 0 ? Number(ttl_minutes) : 30;
    const snapshot = Array.isArray(belief_snapshot) ? belief_snapshot : [];
    const claim = await dal.claimsDal.claim(nodeId, planId, agent_id, userId, ttl, snapshot);

    if (!claim) {
      // Already claimed — fetch the existing claim for the error response
      const existing = await dal.claimsDal.getActiveClaim(nodeId);
      return res.status(409).json({
        error: 'Task is already claimed by another agent',
        existing_claim: existing ? snakeClaim(existing) : null,
      });
    }

    return res.status(201).json(snakeClaim(claim));
  } catch (err) {
    next(err);
  }
};

/**
 * DELETE /plans/:id/nodes/:nodeId/claim
 * Release a task claim.
 */
const releaseTask = async (req, res, next) => {
  try {
    const { id: planId, nodeId } = req.params;
    const userId = req.user.id;
    const { agent_id } = req.body;

    if (!agent_id) {
      return res.status(400).json({ error: 'agent_id is required' });
    }

    // Check plan access
    if (!(await checkPlanAccess(planId, userId))) {
      return res.status(403).json({ error: 'You do not have access to this plan' });
    }

    const released = await dal.claimsDal.release(nodeId, agent_id);
    if (!released) {
      return res.status(404).json({ error: 'No active claim found for this agent on this node' });
    }

    return res.status(200).json(snakeClaim(released));
  } catch (err) {
    next(err);
  }
};

/**
 * GET /plans/:id/nodes/:nodeId/claim
 * Get the active claim for a task, if any.
 */
const getTaskClaim = async (req, res, next) => {
  try {
    const { id: planId, nodeId } = req.params;
    const userId = req.user.id;

    // Check plan access
    if (!(await checkPlanAccess(planId, userId))) {
      return res.status(403).json({ error: 'You do not have access to this plan' });
    }

    const claim = await dal.claimsDal.getActiveClaim(nodeId);
    if (!claim) {
      return res.status(404).json({ error: 'No active claim on this node' });
    }

    return res.status(200).json(snakeClaim(claim));
  } catch (err) {
    next(err);
  }
};

module.exports = { claimTask, releaseTask, getTaskClaim };
