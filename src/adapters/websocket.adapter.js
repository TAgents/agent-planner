/**
 * WebSocket Adapter — pushes notification events to connected browser clients
 */
const { BaseAdapter } = require('./base.adapter');
const { sendToUser } = require('../websocket/broadcast');

// Map backend notification events to frontend WebSocket event types
const EVENT_MAP = {
  'decision.requested': 'decision.requested',
  'decision.requested.blocking': 'decision.requested',
  'decision.resolved': 'decision.resolved',
  'task.help_requested': 'agent.requested',
  'task.review_requested': 'agent.requested',
  'task.input_requested': 'agent.requested',
};

class WebSocketAdapter extends BaseAdapter {
  constructor() {
    super('websocket');
  }

  async isConfigured() {
    // Always configured — sendToUser silently no-ops if user isn't connected
    return true;
  }

  async deliver(payload) {
    const { event, userId, plan, task, request, message, plan_url, task_url } = payload;

    if (!userId) {
      return { success: false, reason: 'no userId in payload' };
    }

    const wsEventType = EVENT_MAP[event] || event;

    const wsMessage = {
      type: wsEventType,
      payload: {
        event,
        plan: plan ? { id: plan.id, title: plan.title } : undefined,
        task: task ? { id: task.id, title: task.title, status: task.status } : undefined,
        request: request || undefined,
        message,
        plan_url,
        task_url,
      },
      metadata: {
        timestamp: new Date().toISOString(),
      },
    };

    const sent = await sendToUser(userId, wsMessage);
    return { success: true, delivered: sent };
  }
}

module.exports = { WebSocketAdapter };
