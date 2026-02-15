/**
 * Notification Service - using DAL layer
 */

const { usersDal } = require('../db/dal.cjs');
const logger = require('../utils/logger');
const slackService = require('./slack');

const EVENT_CONFIGS = {
  'task.blocked': { getMessage: (node, plan) => `🚫 Task '${node.title}' is now blocked in plan '${plan.title}'`, defaultEnabled: true },
  'task.assigned': { getMessage: (node, plan) => `📋 You were assigned '${node.title}' in plan '${plan.title}'`, defaultEnabled: true },
  'task.completed': { getMessage: (node, plan) => `✅ Task '${node.title}' completed in plan '${plan.title}'`, defaultEnabled: false },
  'task.unblocked': { getMessage: (node, plan) => `✨ Task '${node.title}' is no longer blocked in plan '${plan.title}'`, defaultEnabled: false },
  'plan.shared': { getMessage: (node, plan) => `🔗 Plan '${plan.title}' is now ${plan.visibility}`, defaultEnabled: false },
  'decision.requested': { getMessage: (data, plan) => `🤔 Decision needed: '${data.title}' in plan '${plan.title}'`, defaultEnabled: true },
  'decision.requested.blocking': { getMessage: (data, plan) => `🚨 URGENT: Decision needed: '${data.title}' in plan '${plan.title}'`, defaultEnabled: true },
  'decision.resolved': { getMessage: (data, plan) => `✅ Decision made: '${data.title}' in plan '${plan.title}'`, defaultEnabled: false },
  'task.agent_requested': { getMessage: (node, plan) => `🤖 Agent requested for task '${node.title}' in plan '${plan.title}'`, defaultEnabled: true },
  'task.start_requested': { getMessage: (node, plan) => `🚀 Agent requested to START task '${node.title}'`, defaultEnabled: true },
  'task.review_requested': { getMessage: (node, plan) => `👀 Agent requested to REVIEW task '${node.title}'`, defaultEnabled: true },
  'task.help_requested': { getMessage: (node, plan) => `💡 Agent requested to HELP with task '${node.title}'`, defaultEnabled: true },
  'task.continue_requested': { getMessage: (node, plan) => `▶️ Agent requested to CONTINUE task '${node.title}'`, defaultEnabled: true },
};

async function getUserWebhookSettings(userId) {
  try {
    const user = await usersDal.findById(userId);
    if (!user) return null;
    // Webhook settings may be stored as user metadata or in a separate table
    // For now return null (webhook_url/events not in users schema)
    return null;
  } catch (err) {
    logger.error('Error in getUserWebhookSettings:', err);
    return null;
  }
}

async function sendWebhook(url, payload, timeoutMs = 5000) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': 'AgentPlanner-Webhook/1.0' },
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

async function sendNotification(eventType, { node, plan, actor, userId }) {
  try {
    const eventConfig = EVENT_CONFIGS[eventType];
    if (!eventConfig) return;

    const settings = await getUserWebhookSettings(userId);
    if (!settings?.webhook_enabled || !settings?.webhook_url) return;
    if (!settings.webhook_events?.includes(eventType)) return;

    const payload = {
      event: eventType,
      timestamp: new Date().toISOString(),
      plan: { id: plan.id, title: plan.title },
      task: node ? { id: node.id, title: node.title, status: node.status } : null,
      actor: actor ? { name: actor.name || 'Unknown', type: actor.type || 'user' } : null,
      message: eventConfig.getMessage(node || {}, plan, actor)
    };

    const result = await sendWebhook(settings.webhook_url, payload);
    if (!result.success) logger.error(`Webhook delivery failed: ${result.error || `Status ${result.statusCode}`}`);
  } catch (err) {
    logger.error('Error in sendNotification:', err);
  }
}

async function notifyStatusChange(node, plan, actor, oldStatus, newStatus) {
  if (newStatus === 'blocked' && oldStatus !== 'blocked') {
    await sendNotification('task.blocked', { node, plan, actor, userId: plan.owner_id || plan.ownerId });
  } else if (oldStatus === 'blocked' && newStatus !== 'blocked') {
    await sendNotification('task.unblocked', { node, plan, actor, userId: plan.owner_id || plan.ownerId });
  } else if (newStatus === 'completed') {
    await sendNotification('task.completed', { node, plan, actor, userId: plan.owner_id || plan.ownerId });
  }
}

async function notifyAssignment(node, plan, actor, assigneeId) {
  await sendNotification('task.assigned', { node, plan, actor, userId: assigneeId });
}

async function notifyPlanShared(plan, actor) {
  await sendNotification('plan.shared', { node: null, plan, actor, userId: plan.owner_id || plan.ownerId });
}

async function notifyDecisionRequested(decision, plan, actor, planOwnerId) {
  const eventType = decision.urgency === 'blocking' ? 'decision.requested.blocking' : 'decision.requested';
  await sendNotification(eventType, { node: decision, plan, actor, userId: planOwnerId });

  try {
    await slackService.postDecisionRequest(planOwnerId, { decision, plan });
  } catch (err) {
    logger.error('Failed to send Slack decision notification:', err);
  }
}

async function notifyDecisionResolved(decision, plan, actor, requesterId) {
  await sendNotification('decision.resolved', { node: decision, plan, actor, userId: requesterId });
}

async function notifyAgentRequested(node, plan, actor, planOwnerId) {
  const eventMap = { 'start': 'task.start_requested', 'review': 'task.review_requested', 'help': 'task.help_requested', 'continue': 'task.continue_requested' };
  const eventType = eventMap[node.agent_requested || node.agentRequested] || 'task.agent_requested';
  await sendNotification(eventType, { node, plan, actor, userId: planOwnerId });

  try {
    await slackService.postAgentRequest(planOwnerId, {
      node, plan,
      requestType: node.agent_requested || node.agentRequested,
      message: node.agent_request_message || node.agentRequestMessage
    });
  } catch (err) {
    logger.error('Failed to send Slack agent request notification:', err);
  }
}

const AVAILABLE_EVENTS = Object.keys(EVENT_CONFIGS).map(key => ({
  type: key,
  description: EVENT_CONFIGS[key].getMessage({ title: 'Example Task', agent_requested: 'start' }, { title: 'Example Plan' }, {}),
  defaultEnabled: EVENT_CONFIGS[key].defaultEnabled
}));

module.exports = {
  sendNotification, notifyStatusChange, notifyAssignment, notifyPlanShared,
  notifyDecisionRequested, notifyDecisionResolved,
  sendDecisionNotification: sendNotification,
  notifyAgentRequested, sendAgentRequestNotification: sendNotification,
  AVAILABLE_EVENTS
};
