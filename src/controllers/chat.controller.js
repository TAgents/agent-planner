const { supabaseAdmin: supabase } = require('../config/supabase');
const logger = require('../utils/logger');

/**
 * Get chat messages for a plan
 */
const getChatMessages = async (req, res, next) => {
  try {
    const { id: planId } = req.params;
    const { limit = 50, before } = req.query;
    const userId = req.user.id;

    // Verify plan access
    const { data: plan } = await supabase
      .from('plans')
      .select('id, owner_id')
      .eq('id', planId)
      .single();

    if (!plan) {
      return res.status(404).json({ error: 'Plan not found' });
    }

    const isOwner = plan.owner_id === userId;
    if (!isOwner) {
      const { data: collab } = await supabase
        .from('plan_collaborators')
        .select('role')
        .eq('plan_id', planId)
        .eq('user_id', userId)
        .single();

      if (!collab) {
        return res.status(403).json({ error: 'Access denied' });
      }
    }

    let query = supabase
      .from('plan_chat_messages')
      .select('*')
      .eq('plan_id', planId)
      .order('created_at', { ascending: false })
      .limit(parseInt(limit));

    if (before) {
      query = query.lt('created_at', before);
    }

    const { data: messages, error } = await query;

    if (error) {
      await logger.error('Failed to get chat messages', error);
      return res.status(500).json({ error: 'Failed to get chat messages' });
    }

    // Return in chronological order
    res.json((messages || []).reverse());
  } catch (error) {
    await logger.error('Unexpected error in getChatMessages', error);
    next(error);
  }
};

/**
 * Send a chat message in a plan
 */
const sendChatMessage = async (req, res, next) => {
  try {
    const { id: planId } = req.params;
    const { content, role = 'user', metadata = {} } = req.body;
    const userId = req.user.id;

    if (!content || !content.trim()) {
      return res.status(400).json({ error: 'content is required' });
    }

    // Verify plan access
    const { data: plan } = await supabase
      .from('plans')
      .select('id, owner_id')
      .eq('id', planId)
      .single();

    if (!plan) {
      return res.status(404).json({ error: 'Plan not found' });
    }

    const isOwner = plan.owner_id === userId;
    if (!isOwner) {
      const { data: collab } = await supabase
        .from('plan_collaborators')
        .select('role')
        .eq('plan_id', planId)
        .eq('user_id', userId)
        .single();

      if (!collab || !['admin', 'editor'].includes(collab.role)) {
        return res.status(403).json({ error: 'Insufficient permissions' });
      }
    }

    const { data: message, error } = await supabase
      .from('plan_chat_messages')
      .insert({
        plan_id: planId,
        user_id: userId,
        role: role,
        content: content.trim(),
        metadata
      })
      .select()
      .single();

    if (error) {
      await logger.error('Failed to send chat message', error);
      return res.status(500).json({ error: 'Failed to send chat message' });
    }

    await logger.api(`Chat message sent in plan ${planId} by ${userId}`);
    res.status(201).json(message);
  } catch (error) {
    await logger.error('Unexpected error in sendChatMessage', error);
    next(error);
  }
};

module.exports = {
  getChatMessages,
  sendChatMessage
};
