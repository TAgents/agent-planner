/**
 * Webhook Controller
 *
 * Handles incoming webhooks from external integrations like Clawdbot.
 * Provides endpoints for bot interactions and event notifications.
 */

const { supabase, supabaseAdmin } = require('../db/supabase');
const { broadcast } = require('../websocket/broadcast');
const logger = require('../utils/logger');
const crypto = require('crypto');

/**
 * Verify webhook signature for security
 */
function verifyWebhookSignature(payload, signature, secret) {
  if (!secret || !signature) {
    return false;
  }

  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(JSON.stringify(payload))
    .digest('hex');

  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expectedSignature)
  );
}

/**
 * Handle incoming Clawdbot webhook
 *
 * POST /webhooks/clawdbot
 *
 * This endpoint receives events from Clawdbot when webhook mode is enabled
 * instead of WebSocket connections. Useful for serverless deployments.
 */
exports.handleClawdbotWebhook = async (req, res) => {
  try {
    const { event_type, data, bot_id, timestamp } = req.body;

    // Verify webhook signature if secret is configured
    const webhookSecret = process.env.CLAWDBOT_WEBHOOK_SECRET;
    const signature = req.headers['x-clawdbot-signature'];

    if (webhookSecret && !verifyWebhookSignature(req.body, signature, webhookSecret)) {
      await logger.error('Invalid webhook signature');
      return res.status(401).json({ error: 'Invalid signature' });
    }

    await logger.api(`Clawdbot webhook received: ${event_type}`);

    // Handle different event types
    switch (event_type) {
      case 'message':
        await handleClawdbotMessage(data, bot_id);
        break;

      case 'command':
        await handleClawdbotCommand(data, bot_id);
        break;

      case 'callback':
        await handleClawdbotCallback(data, bot_id);
        break;

      case 'ping':
        // Health check from Clawdbot
        return res.json({
          success: true,
          message: 'pong',
          timestamp: new Date().toISOString()
        });

      default:
        await logger.api(`Unknown Clawdbot event type: ${event_type}`);
    }

    res.json({ success: true, received: event_type });
  } catch (error) {
    await logger.error('Clawdbot webhook error', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * Handle message events from Clawdbot
 */
async function handleClawdbotMessage(data, bot_id) {
  const { plan_id, node_id, message, user, channel } = data;

  if (!plan_id || !message) {
    return;
  }

  try {
    // Add as a comment from the bot
    const { data: comment, error } = await supabaseAdmin
      .from('plan_comments')
      .insert({
        node_id: node_id,
        user_id: user?.id || bot_id,
        content: message,
        comment_type: 'agent',
        metadata: {
          source: 'clawdbot',
          channel: channel,
          platform: data.platform
        }
      })
      .select()
      .single();

    if (error) {
      await logger.error('Failed to save Clawdbot message', error);
      return;
    }

    // Broadcast to WebSocket clients
    broadcast(plan_id, 'comment:added', {
      comment,
      node_id,
      plan_id,
      source: 'clawdbot'
    });
  } catch (error) {
    await logger.error('Error handling Clawdbot message', error);
  }
}

/**
 * Handle command events from Clawdbot
 */
async function handleClawdbotCommand(data, bot_id) {
  const { command, args, plan_id, user, channel } = data;

  await logger.api(`Clawdbot command: ${command}`, { args, plan_id });

  // Commands are typically processed by the Clawdbot skill,
  // but this can be used for server-side command execution
  // if needed for specific operations
}

/**
 * Handle callback events (e.g., button clicks)
 */
async function handleClawdbotCallback(data, bot_id) {
  const { callback_id, action, payload, user, channel } = data;

  await logger.api(`Clawdbot callback: ${action}`, { callback_id, payload });

  // Handle interactive element callbacks
  // For example, status update buttons, assignment confirmations, etc.
}

/**
 * Register a Clawdbot bot user
 *
 * POST /webhooks/clawdbot/register
 *
 * Creates or updates a bot user for Clawdbot integration.
 */
exports.registerClawdbotBot = async (req, res) => {
  try {
    const { bot_name, bot_id, platform, capabilities } = req.body;

    // Verify API key authentication
    if (!req.user || !req.user.id) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    // Create or update bot user profile
    const { data: user, error } = await supabaseAdmin
      .from('users')
      .upsert({
        id: bot_id,
        email: `${bot_id}@clawdbot.local`,
        display_name: bot_name || 'Clawdbot',
        user_type: 'bot',
        metadata: {
          bot_type: 'clawdbot',
          platform,
          capabilities,
          registered_by: req.user.id,
          registered_at: new Date().toISOString()
        }
      }, {
        onConflict: 'id'
      })
      .select()
      .single();

    if (error) {
      await logger.error('Failed to register Clawdbot bot', error);
      return res.status(500).json({ error: 'Failed to register bot' });
    }

    res.json({
      success: true,
      bot: {
        id: user.id,
        name: user.display_name,
        type: user.user_type
      }
    });
  } catch (error) {
    await logger.error('Clawdbot registration error', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * Get webhook configuration for Clawdbot
 *
 * GET /webhooks/clawdbot/config
 *
 * Returns the webhook configuration and capabilities.
 */
exports.getClawdbotConfig = async (req, res) => {
  try {
    res.json({
      success: true,
      config: {
        webhook_url: `${process.env.API_BASE_URL || ''}/webhooks/clawdbot`,
        websocket_url: `${process.env.WS_BASE_URL || ''}/ws/collaborate`,
        supported_events: [
          'plan:created',
          'plan:updated',
          'plan:deleted',
          'node:created',
          'node:updated',
          'node:deleted',
          'comment:added',
          'log:added',
          'user:assigned'
        ],
        supported_commands: [
          'plan.create',
          'plan.list',
          'plan.show',
          'plan.delete',
          'plan.progress',
          'task.add',
          'task.status',
          'task.assign',
          'task.comment',
          'task.log',
          'phase.add',
          'phase.list',
          'milestone.add',
          'milestone.list'
        ],
        version: '1.0.0'
      }
    });
  } catch (error) {
    await logger.error('Clawdbot config error', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * Send notification to Clawdbot
 *
 * This is called internally to push events to Clawdbot via webhook.
 */
exports.notifyClawdbot = async (event_type, data) => {
  const webhookUrl = process.env.CLAWDBOT_CALLBACK_URL;

  if (!webhookUrl) {
    return; // Clawdbot callback not configured
  }

  try {
    const payload = {
      event_type,
      data,
      timestamp: new Date().toISOString(),
      source: 'agent-planner'
    };

    // Sign the payload
    const secret = process.env.CLAWDBOT_CALLBACK_SECRET;
    let headers = {
      'Content-Type': 'application/json',
      'User-Agent': 'AgentPlanner/1.0'
    };

    if (secret) {
      const signature = crypto
        .createHmac('sha256', secret)
        .update(JSON.stringify(payload))
        .digest('hex');
      headers['X-AgentPlanner-Signature'] = signature;
    }

    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      await logger.error(`Clawdbot callback failed: ${response.status}`);
    }
  } catch (error) {
    await logger.error('Failed to notify Clawdbot', error);
  }
};
