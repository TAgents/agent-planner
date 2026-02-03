/**
 * Notification Service
 * Handles webhook notifications for AgentPlanner events
 */

const { supabaseAdmin } = require('../config/supabase');
const logger = require('../utils/logger');

// Event type configurations with message templates
const EVENT_CONFIGS = {
  'task.blocked': {
    getMessage: (node, plan, actor) => 
      `🚫 Task '${node.title}' is now blocked in plan '${plan.title}'`,
    defaultEnabled: true
  },
  'task.assigned': {
    getMessage: (node, plan, actor) => 
      `📋 You were assigned '${node.title}' in plan '${plan.title}'`,
    defaultEnabled: true
  },
  'task.completed': {
    getMessage: (node, plan, actor) => 
      `✅ Task '${node.title}' completed in plan '${plan.title}'`,
    defaultEnabled: false
  },
  'task.unblocked': {
    getMessage: (node, plan, actor) => 
      `✨ Task '${node.title}' is no longer blocked in plan '${plan.title}'`,
    defaultEnabled: false
  },
  'plan.shared': {
    getMessage: (node, plan, actor) => 
      `🔗 Plan '${plan.title}' is now ${plan.visibility}`,
    defaultEnabled: false
  }
};

/**
 * Get user's webhook settings
 */
async function getUserWebhookSettings(userId) {
  try {
    const { data, error } = await supabaseAdmin
      .from('users')
      .select('webhook_url, webhook_events, webhook_enabled')
      .eq('id', userId)
      .single();

    if (error) {
      logger.error('Error fetching webhook settings:', error);
      return null;
    }

    return data;
  } catch (err) {
    logger.error('Error in getUserWebhookSettings:', err);
    return null;
  }
}

/**
 * Log webhook delivery attempt
 */
async function logDelivery(userId, eventType, payload, status, statusCode = null, errorMessage = null) {
  try {
    await supabaseAdmin
      .from('webhook_deliveries')
      .insert({
        user_id: userId,
        event_type: eventType,
        payload,
        status,
        status_code: statusCode,
        error_message: errorMessage,
        delivered_at: status === 'success' ? new Date().toISOString() : null
      });
  } catch (err) {
    // Don't fail the main operation if logging fails
    logger.error('Error logging webhook delivery:', err);
  }
}

/**
 * Send a webhook notification
 */
async function sendWebhook(url, payload, timeoutMs = 5000) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'AgentPlanner-Webhook/1.0'
      },
      body: JSON.stringify(payload),
      signal: controller.signal
    });

    clearTimeout(timeoutId);
    return { success: response.ok, statusCode: response.status };
  } catch (err) {
    clearTimeout(timeoutId);
    return { success: false, error: err.message };
  }
}

/**
 * Send notification for an event
 * 
 * @param {string} eventType - Event type (e.g., 'task.blocked')
 * @param {Object} options - Event data
 * @param {Object} options.node - The node/task involved (optional)
 * @param {Object} options.plan - The plan involved
 * @param {Object} options.actor - Who triggered the event
 * @param {string} options.userId - User to notify (plan owner or assignee)
 */
async function sendNotification(eventType, { node, plan, actor, userId }) {
  try {
    // Validate event type
    const eventConfig = EVENT_CONFIGS[eventType];
    if (!eventConfig) {
      logger.warn(`Unknown event type: ${eventType}`);
      return;
    }

    // Get user's webhook settings
    const settings = await getUserWebhookSettings(userId);
    if (!settings) {
      return;
    }

    // Check if webhooks are enabled
    if (!settings.webhook_enabled || !settings.webhook_url) {
      return;
    }

    // Check if user wants this event type
    if (!settings.webhook_events || !settings.webhook_events.includes(eventType)) {
      return;
    }

    // Build payload
    const payload = {
      event: eventType,
      timestamp: new Date().toISOString(),
      plan: {
        id: plan.id,
        title: plan.title
      },
      task: node ? {
        id: node.id,
        title: node.title,
        status: node.status
      } : null,
      actor: actor ? {
        name: actor.name || actor.email || 'Unknown',
        type: actor.type || 'user'
      } : null,
      message: eventConfig.getMessage(node || {}, plan, actor)
    };

    // Send webhook
    logger.api(`Sending ${eventType} webhook to ${settings.webhook_url}`);
    const result = await sendWebhook(settings.webhook_url, payload);

    // Log delivery
    await logDelivery(
      userId,
      eventType,
      payload,
      result.success ? 'success' : 'failed',
      result.statusCode,
      result.error
    );

    if (!result.success) {
      logger.error(`Webhook delivery failed: ${result.error || `Status ${result.statusCode}`}`);
    }
  } catch (err) {
    logger.error('Error in sendNotification:', err);
  }
}

/**
 * Notify on task status change
 */
async function notifyStatusChange(node, plan, actor, oldStatus, newStatus) {
  // Determine event type based on status transition
  if (newStatus === 'blocked' && oldStatus !== 'blocked') {
    await sendNotification('task.blocked', { node, plan, actor, userId: plan.owner_id });
  } else if (oldStatus === 'blocked' && newStatus !== 'blocked') {
    await sendNotification('task.unblocked', { node, plan, actor, userId: plan.owner_id });
  } else if (newStatus === 'completed') {
    await sendNotification('task.completed', { node, plan, actor, userId: plan.owner_id });
  }
}

/**
 * Notify on task assignment
 */
async function notifyAssignment(node, plan, actor, assigneeId) {
  await sendNotification('task.assigned', { node, plan, actor, userId: assigneeId });
}

/**
 * Notify on plan visibility change
 */
async function notifyPlanShared(plan, actor) {
  await sendNotification('plan.shared', { node: null, plan, actor, userId: plan.owner_id });
}

// Available event types for API/UI
const AVAILABLE_EVENTS = Object.keys(EVENT_CONFIGS).map(key => ({
  type: key,
  description: EVENT_CONFIGS[key].getMessage({ title: 'Example Task' }, { title: 'Example Plan' }, {}),
  defaultEnabled: EVENT_CONFIGS[key].defaultEnabled
}));

module.exports = {
  sendNotification,
  notifyStatusChange,
  notifyAssignment,
  notifyPlanShared,
  AVAILABLE_EVENTS
};
