/**
 * Decision Request Controller
 */

const { v4: uuidv4 } = require('uuid');
const { plansDal, nodesDal, decisionsDal } = require('../db/dal.cjs');
const { broadcastPlanUpdate } = require('../websocket/broadcast');
const {
  createDecisionRequestedMessage,
  createDecisionResolvedMessage
} = require('../websocket/message-schema');
const { notifyDecisionRequested, notifyDecisionResolved } = require('../services/notifications');

/**
 * List decision requests for a plan
 */
const listDecisionRequests = async (req, res, next) => {
  try {
    const { id: planId } = req.params;
    const { status, urgency, node_id, limit = 50, offset = 0 } = req.query;
    const userId = req.user.id;

    const { hasAccess } = await plansDal.userHasAccess(planId, userId);
    if (!hasAccess) {
      return res.status(403).json({ error: 'You do not have access to this plan' });
    }

    // Get all decisions for the plan and filter in-memory
    let decisions = await decisionsDal.listByPlan(planId, { status: status || undefined });
    
    if (urgency) decisions = decisions.filter(d => d.urgency === urgency);
    if (node_id) decisions = decisions.filter(d => d.nodeId === node_id);

    const total = decisions.length;
    const data = decisions.slice(Number(offset), Number(offset) + Number(limit));

    res.json({
      data,
      pagination: {
        total,
        limit: parseInt(limit),
        offset: parseInt(offset),
        has_more: (Number(offset) + data.length) < total
      }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get a single decision request
 */
const getDecisionRequest = async (req, res, next) => {
  try {
    const { id: planId, decisionId } = req.params;
    const userId = req.user.id;

    const { hasAccess } = await plansDal.userHasAccess(planId, userId);
    if (!hasAccess) {
      return res.status(403).json({ error: 'You do not have access to this plan' });
    }

    const decision = await decisionsDal.findById(decisionId);
    if (!decision || decision.planId !== planId) {
      return res.status(404).json({ error: 'Decision request not found' });
    }

    res.json(decision);
  } catch (error) {
    next(error);
  }
};

/**
 * Create a new decision request
 */
const createDecisionRequest = async (req, res, next) => {
  try {
    const { id: planId } = req.params;
    const userId = req.user.id;
    const {
      node_id,
      title,
      context,
      options,
      urgency = 'can_continue',
      expires_at,
      requested_by_agent_name,
      metadata = {}
    } = req.body;

    const { hasAccess, role } = await plansDal.userHasAccess(planId, userId);
    if (!hasAccess || (role !== 'owner' && !['editor', 'admin'].includes(role))) {
      return res.status(403).json({ error: 'You do not have edit access to this plan' });
    }

    // If node_id is provided, verify it belongs to this plan
    if (node_id) {
      const node = await nodesDal.findByIdAndPlan(node_id, planId);
      if (!node) {
        return res.status(400).json({ error: 'Node not found in this plan' });
      }
    }

    const now = new Date();
    const data = await decisionsDal.create({
      id: uuidv4(),
      planId,
      nodeId: node_id || null,
      requestedByUserId: userId,
      requestedByAgentName: requested_by_agent_name || null,
      title,
      context,
      options: options || [],
      urgency,
      expiresAt: expires_at || null,
      status: 'pending',
      metadata,
      createdAt: now,
      updatedAt: now
    });

    // Broadcast the decision request event
    const userName = req.user.name || req.user.email;
    try {
      const message = createDecisionRequestedMessage(data, planId, userName);
      await broadcastPlanUpdate(planId, message);
    } catch (broadcastError) {
      console.error('Failed to broadcast decision request:', broadcastError);
    }

    // Send webhook notification (async)
    (async () => {
      try {
        const plan = await plansDal.findById(planId);
        if (plan) {
          const actor = {
            name: requested_by_agent_name || userName,
            type: requested_by_agent_name ? 'agent' : 'user',
            agent_name: requested_by_agent_name || null
          };
          await notifyDecisionRequested(data, plan, actor, plan.ownerId);
        }
      } catch (notifyError) {
        console.error('Failed to send decision notification:', notifyError);
      }
    })();

    res.status(201).json(data);
  } catch (error) {
    next(error);
  }
};

/**
 * Update a decision request (before it's resolved)
 */
const updateDecisionRequest = async (req, res, next) => {
  try {
    const { id: planId, decisionId } = req.params;
    const userId = req.user.id;
    const updates = req.body;

    const { hasAccess, role } = await plansDal.userHasAccess(planId, userId);
    if (!hasAccess || (role !== 'owner' && !['editor', 'admin'].includes(role))) {
      return res.status(403).json({ error: 'You do not have edit access to this plan' });
    }

    const existing = await decisionsDal.findById(decisionId);
    if (!existing || existing.planId !== planId) {
      return res.status(404).json({ error: 'Decision request not found' });
    }

    if (existing.status !== 'pending') {
      return res.status(400).json({ error: 'Cannot update a decision request that has already been resolved' });
    }

    const data = await decisionsDal.update(decisionId, updates);
    res.json(data);
  } catch (error) {
    next(error);
  }
};

/**
 * Resolve a decision request
 */
const resolveDecisionRequest = async (req, res, next) => {
  try {
    const { id: planId, decisionId } = req.params;
    const userId = req.user.id;
    const { decision, rationale } = req.body;

    const { hasAccess, role } = await plansDal.userHasAccess(planId, userId);
    if (!hasAccess || (role !== 'owner' && !['editor', 'admin'].includes(role))) {
      return res.status(403).json({ error: 'You do not have edit access to this plan' });
    }

    const existing = await decisionsDal.findById(decisionId);
    if (!existing || existing.planId !== planId) {
      return res.status(404).json({ error: 'Decision request not found' });
    }

    if (existing.status !== 'pending') {
      return res.status(400).json({ error: 'Decision request has already been resolved' });
    }

    // Check expiration
    if (existing.expiresAt && new Date(existing.expiresAt) < new Date()) {
      return res.status(400).json({ error: 'Decision request has expired' });
    }

    const data = await decisionsDal.resolve(decisionId, {
      decidedByUserId: userId,
      decision,
      rationale: rationale || null,
    });

    if (!data) {
      return res.status(409).json({ error: 'Decision was already resolved by another user' });
    }

    // Broadcast the resolution
    const userName = req.user.name || req.user.email;
    try {
      const message = createDecisionResolvedMessage(data, planId, userName);
      await broadcastPlanUpdate(planId, message);
    } catch (broadcastError) {
      console.error('Failed to broadcast decision resolution:', broadcastError);
    }

    // Send webhook notification (async)
    (async () => {
      try {
        const plan = await plansDal.findById(planId);
        if (plan && data.requestedByUserId) {
          const actor = { name: userName, type: 'user' };
          await notifyDecisionResolved(data, plan, actor, data.requestedByUserId);
        }
      } catch (notifyError) {
        console.error('Failed to send decision resolution notification:', notifyError);
      }
    })();

    res.json(data);
  } catch (error) {
    next(error);
  }
};

/**
 * Cancel a decision request
 */
const cancelDecisionRequest = async (req, res, next) => {
  try {
    const { id: planId, decisionId } = req.params;
    const userId = req.user.id;
    const { reason } = req.body || {};

    const { hasAccess, role } = await plansDal.userHasAccess(planId, userId);
    if (!hasAccess || (role !== 'owner' && !['editor', 'admin'].includes(role))) {
      return res.status(403).json({ error: 'You do not have edit access to this plan' });
    }

    const existing = await decisionsDal.findById(decisionId);
    if (!existing || existing.planId !== planId) {
      return res.status(404).json({ error: 'Decision request not found' });
    }

    if (existing.status !== 'pending') {
      return res.status(400).json({ error: 'Cannot cancel a decision request that has already been resolved' });
    }

    const updatedMetadata = {
      ...(existing.metadata || {}),
      ...(reason ? { cancellation_reason: reason } : {})
    };

    const data = await decisionsDal.update(decisionId, {
      status: 'cancelled',
      metadata: updatedMetadata,
    });

    if (!data) {
      return res.status(409).json({ error: 'Decision status changed - it may have been resolved or cancelled by another user' });
    }

    res.json(data);
  } catch (error) {
    next(error);
  }
};

/**
 * Delete a decision request (only plan owners)
 */
const deleteDecisionRequest = async (req, res, next) => {
  try {
    const { id: planId, decisionId } = req.params;
    const userId = req.user.id;

    const { hasAccess, role } = await plansDal.userHasAccess(planId, userId);
    if (role !== 'owner') {
      return res.status(403).json({ error: 'Only plan owners can delete decision requests' });
    }

    await decisionsDal.delete(decisionId);
    res.status(204).send();
  } catch (error) {
    next(error);
  }
};

/**
 * Get pending decision count for a plan
 */
const getPendingDecisionCount = async (req, res, next) => {
  try {
    const { id: planId } = req.params;
    const userId = req.user.id;

    const { hasAccess } = await plansDal.userHasAccess(planId, userId);
    if (!hasAccess) {
      return res.status(403).json({ error: 'You do not have access to this plan' });
    }

    const count = await decisionsDal.countPending(planId);
    res.json({ pending_count: count });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  listDecisionRequests,
  getDecisionRequest,
  createDecisionRequest,
  updateDecisionRequest,
  resolveDecisionRequest,
  cancelDecisionRequest,
  deleteDecisionRequest,
  getPendingDecisionCount
};
