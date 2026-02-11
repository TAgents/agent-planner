const { supabaseAdmin: supabase } = require('../config/supabase');
const logger = require('../utils/logger');

/**
 * Create a handoff request — agent hands off a task to another agent
 */
const createHandoff = async (req, res, next) => {
  try {
    const { id: planId, nodeId } = req.params;
    const { to_agent_id, context, reason } = req.body;
    const fromAgentId = req.user.id;

    if (!to_agent_id) {
      return res.status(400).json({ error: 'to_agent_id is required' });
    }

    // Verify node belongs to plan
    const { data: node, error: nodeError } = await supabase
      .from('plan_nodes')
      .select('id, plan_id, title, assigned_agent_id')
      .eq('id', nodeId)
      .eq('plan_id', planId)
      .single();

    if (nodeError || !node) {
      return res.status(404).json({ error: 'Node not found in this plan' });
    }

    // Verify target agent exists
    const { data: toAgent } = await supabase
      .from('users')
      .select('id, name, email')
      .eq('id', to_agent_id)
      .single();

    if (!toAgent) {
      return res.status(404).json({ error: 'Target agent not found' });
    }

    // Create handoff record
    const { data: handoff, error: createError } = await supabase
      .from('handoffs')
      .insert({
        plan_id: planId,
        node_id: nodeId,
        from_agent_id: fromAgentId,
        to_agent_id,
        context: context || null,
        reason: reason || null,
        status: 'pending'
      })
      .select()
      .single();

    if (createError) {
      await logger.error('Failed to create handoff', createError);
      return res.status(500).json({ error: 'Failed to create handoff' });
    }

    await logger.api(`Handoff created: ${fromAgentId} -> ${to_agent_id} for node ${nodeId}`);
    res.status(201).json(handoff);
  } catch (error) {
    await logger.error('Unexpected error in createHandoff', error);
    next(error);
  }
};

/**
 * Respond to a handoff (accept/reject)
 */
const respondToHandoff = async (req, res, next) => {
  try {
    const { handoffId } = req.params;
    const { action, notes } = req.body;
    const userId = req.user.id;

    if (!['accepted', 'rejected'].includes(action)) {
      return res.status(400).json({ error: 'action must be "accepted" or "rejected"' });
    }

    // Get the handoff
    const { data: handoff, error: fetchError } = await supabase
      .from('handoffs')
      .select('*')
      .eq('id', handoffId)
      .single();

    if (fetchError || !handoff) {
      return res.status(404).json({ error: 'Handoff not found' });
    }

    if (handoff.status !== 'pending') {
      return res.status(400).json({ error: 'Handoff has already been resolved' });
    }

    // Only the target agent can respond
    if (handoff.to_agent_id !== userId) {
      return res.status(403).json({ error: 'Only the target agent can respond to this handoff' });
    }

    const updateData = {
      status: action,
      notes: notes || null,
      resolved_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    const { data: updated, error: updateError } = await supabase
      .from('handoffs')
      .update(updateData)
      .eq('id', handoffId)
      .select()
      .single();

    if (updateError) {
      await logger.error('Failed to update handoff', updateError);
      return res.status(500).json({ error: 'Failed to update handoff' });
    }

    // If accepted, update the node's assigned agent
    if (action === 'accepted') {
      await supabase
        .from('plan_nodes')
        .update({
          assigned_agent_id: handoff.to_agent_id,
          assigned_agent_at: new Date().toISOString(),
          assigned_agent_by: handoff.from_agent_id,
          updated_at: new Date().toISOString()
        })
        .eq('id', handoff.node_id);
    }

    await logger.api(`Handoff ${handoffId} ${action} by ${userId}`);
    res.json(updated);
  } catch (error) {
    await logger.error('Unexpected error in respondToHandoff', error);
    next(error);
  }
};

/**
 * Get handoffs for a node
 */
const getNodeHandoffs = async (req, res, next) => {
  try {
    const { id: planId, nodeId } = req.params;

    const { data: handoffs, error } = await supabase
      .from('handoffs')
      .select('*')
      .eq('node_id', nodeId)
      .eq('plan_id', planId)
      .order('created_at', { ascending: false });

    if (error) {
      await logger.error('Failed to get handoffs', error);
      return res.status(500).json({ error: 'Failed to get handoffs' });
    }

    res.json(handoffs || []);
  } catch (error) {
    await logger.error('Unexpected error in getNodeHandoffs', error);
    next(error);
  }
};

/**
 * Get pending handoffs for the current user (as target)
 */
const getMyPendingHandoffs = async (req, res, next) => {
  try {
    const userId = req.user.id;

    const { data: handoffs, error } = await supabase
      .from('handoffs')
      .select(`
        *,
        plan_nodes:node_id (id, title, status),
        plans:plan_id (id, title)
      `)
      .eq('to_agent_id', userId)
      .eq('status', 'pending')
      .order('created_at', { ascending: false });

    if (error) {
      await logger.error('Failed to get pending handoffs', error);
      return res.status(500).json({ error: 'Failed to get pending handoffs' });
    }

    res.json(handoffs || []);
  } catch (error) {
    await logger.error('Unexpected error in getMyPendingHandoffs', error);
    next(error);
  }
};

module.exports = {
  createHandoff,
  respondToHandoff,
  getNodeHandoffs,
  getMyPendingHandoffs
};
