/**
 * Decision Request Controller
 * 
 * Handles CRUD operations for decision requests - enabling agents to request
 * human decisions with structured options and context.
 */

const { v4: uuidv4 } = require('uuid');
const { supabaseAdmin: supabase } = require('../config/supabase');
const { broadcastPlanUpdate } = require('../websocket/broadcast');
const {
  createDecisionRequestedMessage,
  createDecisionResolvedMessage
} = require('../websocket/message-schema');
const { captureDecisionAsKnowledge } = require('../services/decision-knowledge');

/**
 * Helper to check if user has access to a plan
 */
const checkPlanAccess = async (planId, userId, requireEdit = false) => {
  // Check if user is owner
  const { data: plan, error: planError } = await supabase
    .from('plans')
    .select('owner_id')
    .eq('id', planId)
    .single();

  if (planError || !plan) {
    return { hasAccess: false, isOwner: false };
  }

  if (plan.owner_id === userId) {
    return { hasAccess: true, isOwner: true };
  }

  // Check if user is collaborator
  const { data: collab, error: collabError } = await supabase
    .from('plan_collaborators')
    .select('role')
    .eq('plan_id', planId)
    .eq('user_id', userId)
    .single();

  if (collabError || !collab) {
    return { hasAccess: false, isOwner: false };
  }

  // For edit access, require editor or admin role
  if (requireEdit && !['editor', 'admin'].includes(collab.role)) {
    return { hasAccess: false, isOwner: false };
  }

  return { hasAccess: true, isOwner: false };
};

/**
 * List decision requests for a plan
 */
const listDecisionRequests = async (req, res, next) => {
  try {
    const { id: planId } = req.params;
    const { status, urgency, node_id, limit = 50, offset = 0 } = req.query;
    const userId = req.user.id;

    // Check access
    const { hasAccess } = await checkPlanAccess(planId, userId);
    if (!hasAccess) {
      return res.status(403).json({ error: 'You do not have access to this plan' });
    }

    // Build base query for filtering
    let baseQuery = supabase
      .from('decision_requests')
      .select('*', { count: 'exact' })
      .eq('plan_id', planId);

    // Apply filters to both count and data queries
    if (status) {
      baseQuery = baseQuery.eq('status', status);
    }
    if (urgency) {
      baseQuery = baseQuery.eq('urgency', urgency);
    }
    if (node_id) {
      baseQuery = baseQuery.eq('node_id', node_id);
    }

    // Execute query with pagination
    const { data, error, count } = await baseQuery
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    // Return with pagination metadata
    res.json({
      data,
      pagination: {
        total: count || 0,
        limit: parseInt(limit),
        offset: parseInt(offset),
        has_more: (offset + data.length) < (count || 0)
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

    // Check access
    const { hasAccess } = await checkPlanAccess(planId, userId);
    if (!hasAccess) {
      return res.status(403).json({ error: 'You do not have access to this plan' });
    }

    const { data, error } = await supabase
      .from('decision_requests')
      .select('*')
      .eq('id', decisionId)
      .eq('plan_id', planId)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return res.status(404).json({ error: 'Decision request not found' });
      }
      return res.status(500).json({ error: error.message });
    }

    res.json(data);
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

    // Check edit access
    const { hasAccess } = await checkPlanAccess(planId, userId, true);
    if (!hasAccess) {
      return res.status(403).json({ error: 'You do not have edit access to this plan' });
    }

    // If node_id is provided, verify it belongs to this plan
    if (node_id) {
      const { data: node, error: nodeError } = await supabase
        .from('plan_nodes')
        .select('id')
        .eq('id', node_id)
        .eq('plan_id', planId)
        .single();

      if (nodeError || !node) {
        return res.status(400).json({ error: 'Node not found in this plan' });
      }
    }

    // Create the decision request
    const decisionId = uuidv4();
    const now = new Date().toISOString();

    const { data, error } = await supabase
      .from('decision_requests')
      .insert([{
        id: decisionId,
        plan_id: planId,
        node_id: node_id || null,
        requested_by_user_id: userId,
        requested_by_agent_name: requested_by_agent_name || null,
        title,
        context,
        options: options || [],
        urgency,
        expires_at: expires_at || null,
        status: 'pending',
        metadata,
        created_at: now,
        updated_at: now
      }])
      .select()
      .single();

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    // Broadcast the decision request event
    const userName = req.user.name || req.user.email;
    try {
      const message = createDecisionRequestedMessage(data, planId, userName);
      await broadcastPlanUpdate(planId, message);
    } catch (broadcastError) {
      // Don't fail the request if broadcast fails
      console.error('Failed to broadcast decision request:', broadcastError);
    }

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

    // Check edit access
    const { hasAccess } = await checkPlanAccess(planId, userId, true);
    if (!hasAccess) {
      return res.status(403).json({ error: 'You do not have edit access to this plan' });
    }

    // Check the decision exists and is still pending
    const { data: existing, error: existingError } = await supabase
      .from('decision_requests')
      .select('status')
      .eq('id', decisionId)
      .eq('plan_id', planId)
      .single();

    if (existingError || !existing) {
      return res.status(404).json({ error: 'Decision request not found' });
    }

    if (existing.status !== 'pending') {
      return res.status(400).json({ error: 'Cannot update a decision request that has already been resolved' });
    }

    // Apply updates
    const { data, error } = await supabase
      .from('decision_requests')
      .update({
        ...updates,
        updated_at: new Date().toISOString()
      })
      .eq('id', decisionId)
      .eq('plan_id', planId)
      .select()
      .single();

    if (error) {
      return res.status(400).json({ error: error.message });
    }

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

    // Check edit access
    const { hasAccess } = await checkPlanAccess(planId, userId, true);
    if (!hasAccess) {
      return res.status(403).json({ error: 'You do not have edit access to this plan' });
    }

    // Check the decision exists first (for better error messages)
    const { data: existing, error: existingError } = await supabase
      .from('decision_requests')
      .select('status, title, expires_at')
      .eq('id', decisionId)
      .eq('plan_id', planId)
      .single();

    if (existingError || !existing) {
      return res.status(404).json({ error: 'Decision request not found' });
    }

    if (existing.status !== 'pending') {
      return res.status(400).json({ error: 'Decision request has already been resolved' });
    }

    const now = new Date().toISOString();

    // Resolve the decision with atomic optimistic locking:
    // - status must be 'pending' (prevents race with other resolvers)
    // - expires_at must be NULL or in the future (prevents TOCTOU on expiration)
    const { data, error } = await supabase
      .from('decision_requests')
      .update({
        status: 'decided',
        decided_by_user_id: userId,
        decision,
        rationale: rationale || null,
        decided_at: now,
        updated_at: now
      })
      .eq('id', decisionId)
      .eq('plan_id', planId)
      .eq('status', 'pending')
      .or(`expires_at.is.null,expires_at.gt.${now}`) // Atomic expiration check
      .select()
      .single();

    if (error) {
      // PGRST116 means no rows matched - could be resolved, cancelled, or expired
      if (error.code === 'PGRST116') {
        // Re-check to give specific error message
        const { data: current } = await supabase
          .from('decision_requests')
          .select('status, expires_at')
          .eq('id', decisionId)
          .single();
        
        if (current?.expires_at && new Date(current.expires_at) < new Date()) {
          return res.status(400).json({ error: 'Decision request has expired' });
        }
        return res.status(409).json({ error: 'Decision was already resolved by another user' });
      }
      return res.status(400).json({ error: error.message });
    }

    // Broadcast the resolution
    const userName = req.user.name || req.user.email;
    try {
      const message = createDecisionResolvedMessage(data, planId, userName);
      await broadcastPlanUpdate(planId, message);
    } catch (broadcastError) {
      console.error('Failed to broadcast decision resolution:', broadcastError);
    }

    // Auto-capture decision as knowledge entry (async, don't block response)
    captureDecisionAsKnowledge(data, planId, userId)
      .then(entry => {
        if (entry) {
          console.log(`Decision captured as knowledge entry: ${entry.id}`);
        }
      })
      .catch(err => {
        console.error('Failed to capture decision as knowledge:', err);
      });

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

    // Check edit access
    const { hasAccess } = await checkPlanAccess(planId, userId, true);
    if (!hasAccess) {
      return res.status(403).json({ error: 'You do not have edit access to this plan' });
    }

    // Check the decision exists and is pending, also get existing metadata
    const { data: existing, error: existingError } = await supabase
      .from('decision_requests')
      .select('status, metadata')
      .eq('id', decisionId)
      .eq('plan_id', planId)
      .single();

    if (existingError || !existing) {
      return res.status(404).json({ error: 'Decision request not found' });
    }

    if (existing.status !== 'pending') {
      return res.status(400).json({ error: 'Cannot cancel a decision request that has already been resolved' });
    }

    const now = new Date().toISOString();

    // Merge cancellation reason with existing metadata (preserve existing data)
    const updatedMetadata = {
      ...(existing.metadata || {}),
      ...(reason ? { cancellation_reason: reason } : {})
    };

    // Cancel the decision with optimistic locking
    const { data, error } = await supabase
      .from('decision_requests')
      .update({
        status: 'cancelled',
        metadata: updatedMetadata,
        updated_at: now
      })
      .eq('id', decisionId)
      .eq('plan_id', planId)
      .eq('status', 'pending') // Optimistic lock
      .select()
      .single();

    if (error) {
      // PGRST116 means no rows matched - status changed
      if (error.code === 'PGRST116') {
        return res.status(409).json({ error: 'Decision status changed - it may have been resolved or cancelled by another user' });
      }
      return res.status(400).json({ error: error.message });
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

    // Check ownership
    const { isOwner } = await checkPlanAccess(planId, userId);
    if (!isOwner) {
      return res.status(403).json({ error: 'Only plan owners can delete decision requests' });
    }

    const { error } = await supabase
      .from('decision_requests')
      .delete()
      .eq('id', decisionId)
      .eq('plan_id', planId);

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    res.status(204).send();
  } catch (error) {
    next(error);
  }
};

/**
 * Get pending decision count for a plan (for badges/notifications)
 */
const getPendingDecisionCount = async (req, res, next) => {
  try {
    const { id: planId } = req.params;
    const userId = req.user.id;

    // Check access
    const { hasAccess } = await checkPlanAccess(planId, userId);
    if (!hasAccess) {
      return res.status(403).json({ error: 'You do not have access to this plan' });
    }

    const { count, error } = await supabase
      .from('decision_requests')
      .select('id', { count: 'exact', head: true })
      .eq('plan_id', planId)
      .eq('status', 'pending');

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    res.json({ pending_count: count || 0 });
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
