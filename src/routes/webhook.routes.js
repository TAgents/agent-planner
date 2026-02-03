/**
 * Webhook Routes
 * Manage user webhook notification settings
 */

const express = require('express');
const router = express.Router();
const { supabaseAdmin } = require('../config/supabase');
const { authMiddleware } = require('../middleware/auth');
const { AVAILABLE_EVENTS } = require('../services/notifications');

/**
 * Get available webhook event types
 * GET /webhooks/events
 */
router.get('/events', (req, res) => {
  res.json({
    success: true,
    events: AVAILABLE_EVENTS
  });
});

/**
 * Get current user's webhook settings
 * GET /webhooks/settings
 */
router.get('/settings', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;

    const { data, error } = await supabaseAdmin
      .from('users')
      .select('webhook_url, webhook_events, webhook_enabled')
      .eq('id', userId)
      .single();

    if (error) {
      console.error('Error fetching webhook settings:', error);
      return res.status(500).json({ error: 'Failed to fetch webhook settings' });
    }

    res.json({
      success: true,
      settings: {
        url: data.webhook_url || '',
        events: data.webhook_events || ['task.blocked', 'task.assigned'],
        enabled: data.webhook_enabled || false
      }
    });
  } catch (err) {
    console.error('Error in GET /webhooks/settings:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * Update user's webhook settings
 * PUT /webhooks/settings
 */
router.put('/settings', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;
    const { url, events, enabled } = req.body;

    // Validate URL if provided
    if (url && url.trim()) {
      try {
        new URL(url);
      } catch {
        return res.status(400).json({ error: 'Invalid webhook URL' });
      }
    }

    // Validate events
    const validEventTypes = AVAILABLE_EVENTS.map(e => e.type);
    if (events && Array.isArray(events)) {
      const invalidEvents = events.filter(e => !validEventTypes.includes(e));
      if (invalidEvents.length > 0) {
        return res.status(400).json({ 
          error: `Invalid event types: ${invalidEvents.join(', ')}` 
        });
      }
    }

    // Update settings
    const updateData = {};
    if (url !== undefined) updateData.webhook_url = url || null;
    if (events !== undefined) updateData.webhook_events = events;
    if (enabled !== undefined) updateData.webhook_enabled = enabled;

    const { error } = await supabaseAdmin
      .from('users')
      .update(updateData)
      .eq('id', userId);

    if (error) {
      console.error('Error updating webhook settings:', error);
      return res.status(500).json({ error: 'Failed to update webhook settings' });
    }

    res.json({
      success: true,
      message: 'Webhook settings updated'
    });
  } catch (err) {
    console.error('Error in PUT /webhooks/settings:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * Test webhook by sending a test notification
 * POST /webhooks/test
 */
router.post('/test', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;

    // Get user's webhook settings
    const { data: user, error: userError } = await supabaseAdmin
      .from('users')
      .select('webhook_url, webhook_enabled, name, email')
      .eq('id', userId)
      .single();

    if (userError || !user) {
      return res.status(500).json({ error: 'Failed to fetch user settings' });
    }

    if (!user.webhook_url) {
      return res.status(400).json({ error: 'No webhook URL configured' });
    }

    // Send test webhook
    const testPayload = {
      event: 'test',
      timestamp: new Date().toISOString(),
      plan: {
        id: 'test-plan-id',
        title: 'Test Plan'
      },
      task: {
        id: 'test-task-id',
        title: 'Test Task',
        status: 'in_progress'
      },
      actor: {
        name: user.name || user.email,
        type: 'user'
      },
      message: '🧪 This is a test notification from AgentPlanner'
    };

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    try {
      const response = await fetch(user.webhook_url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'AgentPlanner-Webhook/1.0'
        },
        body: JSON.stringify(testPayload),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (response.ok) {
        res.json({
          success: true,
          message: 'Test webhook sent successfully',
          statusCode: response.status
        });
      } else {
        res.json({
          success: false,
          message: `Webhook returned status ${response.status}`,
          statusCode: response.status
        });
      }
    } catch (fetchError) {
      clearTimeout(timeoutId);
      res.json({
        success: false,
        message: `Failed to send webhook: ${fetchError.message}`
      });
    }
  } catch (err) {
    console.error('Error in POST /webhooks/test:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * Get webhook delivery history
 * GET /webhooks/history
 */
router.get('/history', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);

    const { data, error } = await supabaseAdmin
      .from('webhook_deliveries')
      .select('id, event_type, status, status_code, error_message, created_at, delivered_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) {
      console.error('Error fetching webhook history:', error);
      return res.status(500).json({ error: 'Failed to fetch webhook history' });
    }

    res.json({
      success: true,
      deliveries: data
    });
  } catch (err) {
    console.error('Error in GET /webhooks/history:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
