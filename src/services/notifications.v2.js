/**
 * Notification Service v2 — Uses adapter system (with optional Hatchet)
 * 
 * Tries to emit via Hatchet first; falls back to direct adapter delivery.
 */
const { emitEvent } = require('../workflows/messaging.workflow');
const { deliverToAll } = require('../adapters');
const logger = require('../utils/logger');

// Whether to use Hatchet for event dispatch
const USE_HATCHET = !!process.env.HATCHET_CLIENT_TOKEN;

async function notify(payload) {
  if (USE_HATCHET) {
    const sent = await emitEvent('notification:send', payload);
    if (sent) return;
  }
  // Direct delivery fallback
  await deliverToAll(payload);
}

async function notifyStatusChange(node, plan, actor, oldStatus, newStatus) {
  const eventMap = {
    'blocked': 'task.blocked',
    'completed': 'task.completed',
  };

  // Only notify on meaningful transitions
  const event = eventMap[newStatus];
  if (!event && newStatus !== 'in_progress') return;

  const finalEvent = event || `task.status_changed`;

  await notify({
    event: finalEvent,
    userId: plan.owner_id,
    plan: { id: plan.id, title: plan.title },
    task: {
      id: node.id, title: node.title,
      description: node.description, status: newStatus,
      agent_instructions: node.agent_instructions,
    },
    actor: { name: actor.name, type: actor.type || 'user' },
    message: `Task '${node.title}' status: ${oldStatus} → ${newStatus}`,
  });
}

async function notifyAgentRequested(node, plan, actor, ownerId) {
  const requestType = node.agent_requested;

  if (USE_HATCHET) {
    await emitEvent('agent:request:created', {
      planId: plan.id,
      nodeId: node.id,
      requestType,
      message: node.agent_request_message,
      userId: ownerId,
      requestedBy: actor.name,
    });
    return;
  }

  // Direct delivery
  await notify({
    event: `task.${requestType}_requested`,
    userId: ownerId,
    plan: { id: plan.id, title: plan.title },
    task: {
      id: node.id, title: node.title,
      description: node.description, status: node.status,
      agent_instructions: node.agent_instructions,
    },
    request: {
      type: requestType,
      message: node.agent_request_message,
      requested_at: node.agent_requested_at,
    },
    actor: { name: actor.name, type: 'user' },
    message: `🚀 Agent requested to ${requestType} task '${node.title}'`,
  });
}

async function notifyDecisionRequested(decision, plan, actor, ownerId) {
  await notify({
    event: decision.urgency === 'blocking' ? 'decision.requested.blocking' : 'decision.requested',
    userId: ownerId,
    plan: { id: plan.id, title: plan.title },
    decision: {
      id: decision.id, title: decision.title,
      context: decision.context, options: decision.options,
      urgency: decision.urgency,
    },
    actor: { name: actor.name, type: actor.type || 'user' },
    message: decision.urgency === 'blocking'
      ? `🚨 URGENT: Decision needed: '${decision.title}'`
      : `🤔 Decision needed: '${decision.title}'`,
  });
}

async function notifyDecisionResolved(decision, plan, actor) {
  await notify({
    event: 'decision.resolved',
    userId: plan.owner_id,
    plan: { id: plan.id, title: plan.title },
    decision: {
      id: decision.id, title: decision.title,
      resolution: decision.decision, rationale: decision.rationale,
    },
    actor: { name: actor.name, type: 'user' },
    message: `✅ Decision made: '${decision.title}'`,
  });
}

module.exports = {
  notifyStatusChange,
  notifyAgentRequested,
  notifyDecisionRequested,
  notifyDecisionResolved,
};
