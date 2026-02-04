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
  },
  'decision.requested': {
    getMessage: (data, plan, actor) => 
      `🤔 Decision needed: '${data.title}' in plan '${plan.title}'`,
    defaultEnabled: true
  },
  'decision.requested.blocking': {
    getMessage: (data, plan, actor) => 
      `🚨 URGENT: Decision needed: '${data.title}' in plan '${plan.title}' - Agent is blocked!`,
    defaultEnabled: true
  },
  'decision.resolved': {
    getMessage: (data, plan, actor) => 
      `✅ Decision made: '${data.title}' in plan '${plan.title}'`,
    defaultEnabled: false
  },
  'task.agent_requested': {
    getMessage: (node, plan, actor) => 
      `🤖 Agent requested to ${node.agent_requested} task '${node.title}' in plan '${plan.title}'`,
    defaultEnabled: true
  },
  'task.start_requested': {
    getMessage: (node, plan, actor) => 
      `🚀 Agent requested to START task '${node.title}' in plan '${plan.title}'`,
    defaultEnabled: true
  },
  'task.review_requested': {
    getMessage: (node, plan, actor) => 
      `👀 Agent requested to REVIEW task '${node.title}' in plan '${plan.title}'`,
    defaultEnabled: true
  },
  'task.help_requested': {
    getMessage: (node, plan, actor) => 
      `💡 Agent requested to HELP with task '${node.title}' in plan '${plan.title}'`,
    defaultEnabled: true
  },
  'task.continue_requested': {
    getMessage: (node, plan, actor) => 
      `▶️ Agent requested to CONTINUE task '${node.title}' in plan '${plan.title}'`,
    defaultEnabled: true
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

/**
 * Send decision requested notification
 * Uses 'decision.requested.blocking' for blocking urgency, otherwise 'decision.requested'
 * 
 * @param {Object} decision - The decision request object
 * @param {Object} plan - The plan object
 * @param {Object} actor - Who requested the decision (agent or user)
 * @param {string} planOwnerId - Plan owner to notify
 */
async function notifyDecisionRequested(decision, plan, actor, planOwnerId) {
  const eventType = decision.urgency === 'blocking' 
    ? 'decision.requested.blocking' 
    : 'decision.requested';
  
  await sendDecisionNotification(eventType, { decision, plan, actor, userId: planOwnerId });
}

/**
 * Send decision resolved notification
 * 
 * @param {Object} decision - The resolved decision request
 * @param {Object} plan - The plan object  
 * @param {Object} actor - Who resolved the decision
 * @param {string} requesterId - Original requester to notify
 */
async function notifyDecisionResolved(decision, plan, actor, requesterId) {
  await sendDecisionNotification('decision.resolved', { decision, plan, actor, userId: requesterId });
}

/**
 * Send decision-specific notification with custom payload structure
 */
async function sendDecisionNotification(eventType, { decision, plan, actor, userId }) {
  try {
    const eventConfig = EVENT_CONFIGS[eventType];
    if (!eventConfig) {
      logger.warn(`Unknown event type: ${eventType}`);
      return;
    }

    // Get user's webhook settings
    const settings = await getUserWebhookSettings(userId);
    if (!settings || !settings.webhook_enabled || !settings.webhook_url) {
      return;
    }

    // Check if user wants this event type
    // For sub-events like 'decision.requested.blocking', also check if they subscribed
    // to the base event 'decision.requested' (subscribing to base includes all variants)
    const baseEvent = eventType.replace('.blocking', '');
    const wantsEvent = settings.webhook_events && 
      (settings.webhook_events.includes(eventType) || settings.webhook_events.includes(baseEvent));
    
    if (!wantsEvent) {
      return;
    }

    // Build decision-specific payload
    const payload = {
      event: eventType,
      timestamp: new Date().toISOString(),
      plan: {
        id: plan.id,
        title: plan.title
      },
      decision: {
        id: decision.id,
        title: decision.title,
        context: decision.context,
        options: decision.options,
        urgency: decision.urgency,
        status: decision.status,
        node_id: decision.node_id
      },
      actor: actor ? {
        name: actor.name || 'Unknown',
        type: actor.type || 'user',
        agent_name: actor.agent_name || null
      } : null,
      message: eventConfig.getMessage(decision, plan, actor)
    };

    // Add resolution details if resolved
    if (decision.status === 'decided') {
      payload.resolution = {
        decision: decision.decision,
        rationale: decision.rationale,
        decided_at: decision.decided_at
      };
    }

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
      logger.error(`Decision webhook delivery failed: ${result.error || `Status ${result.statusCode}`}`);
    }
  } catch (err) {
    logger.error('Error in sendDecisionNotification:', err);
  }
}

/**
 * Send agent request notification
 * 
 * @param {Object} node - The task/node with agent_requested set
 * @param {Object} plan - The plan object
 * @param {Object} actor - Who requested the agent
 * @param {string} planOwnerId - Plan owner to notify
 */
async function notifyAgentRequested(node, plan, actor, planOwnerId) {
  // Map request type to specific event
  const eventMap = {
    'start': 'task.start_requested',
    'review': 'task.review_requested',
    'help': 'task.help_requested',
    'continue': 'task.continue_requested'
  };
  
  const eventType = eventMap[node.agent_requested] || 'task.agent_requested';
  
  await sendAgentRequestNotification(eventType, { node, plan, actor, userId: planOwnerId });
}

/**
 * Send agent request notification with full task context
 */
async function sendAgentRequestNotification(eventType, { node, plan, actor, userId }) {
  try {
    const eventConfig = EVENT_CONFIGS[eventType] || EVENT_CONFIGS['task.agent_requested'];
    
    // Get user's webhook settings
    const settings = await getUserWebhookSettings(userId);
    if (!settings || !settings.webhook_enabled || !settings.webhook_url) {
      return;
    }

    // Check if user wants this event type (also check base event)
    const baseEvent = 'task.agent_requested';
    const wantsEvent = settings.webhook_events && 
      (settings.webhook_events.includes(eventType) || settings.webhook_events.includes(baseEvent));
    
    if (!wantsEvent) {
      return;
    }

    // Build payload with full task context for agent
    const payload = {
      event: eventType,
      timestamp: new Date().toISOString(),
      plan: {
        id: plan.id,
        title: plan.title
      },
      task: {
        id: node.id,
        title: node.title,
        description: node.description,
        node_type: node.node_type,
        status: node.status,
        agent_instructions: node.agent_instructions,
        context: node.context
      },
      request: {
        type: node.agent_requested,
        message: node.agent_request_message,
        requested_at: node.agent_requested_at,
        requested_by: actor?.name || 'Unknown'
      },
      actor: actor ? {
        name: actor.name,
        type: 'user'
      } : null,
      message: eventConfig.getMessage(node, plan, actor)
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
      logger.error(`Agent request webhook delivery failed: ${result.error || `Status ${result.statusCode}`}`);
    }
  } catch (err) {
    logger.error('Error in sendAgentRequestNotification:', err);
  }
}

// Available event types for API/UI
const AVAILABLE_EVENTS = Object.keys(EVENT_CONFIGS).map(key => ({
  type: key,
  description: EVENT_CONFIGS[key].getMessage({ title: 'Example Task', agent_requested: 'start' }, { title: 'Example Plan' }, {}),
  defaultEnabled: EVENT_CONFIGS[key].defaultEnabled
}));

module.exports = {
  sendNotification,
  notifyStatusChange,
  notifyAssignment,
  notifyPlanShared,
  notifyDecisionRequested,
  notifyDecisionResolved,
  sendDecisionNotification,
  notifyAgentRequested,
  sendAgentRequestNotification,
  AVAILABLE_EVENTS
};
