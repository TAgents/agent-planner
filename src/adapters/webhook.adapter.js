/**
 * Webhook Adapter — delivers notifications via HTTP POST
 */
const { BaseAdapter } = require('./base.adapter');
const dal = require('../db/dal.cjs');
const logger = require('../utils/logger');

class WebhookAdapter extends BaseAdapter {
  constructor() {
    super('webhook');
  }

  async isConfigured(userId) {
    const settings = await this.getSettings(userId);
    return settings?.enabled && settings?.url;
  }

  async getSettings(userId) {
    // Use DAL or direct query for webhook settings
    try {
      const { db } = require('../db/connection.cjs');
      const rows = await db`
        SELECT url, enabled, events, secret 
        FROM webhook_settings 
        WHERE user_id = ${userId} AND enabled = true
        LIMIT 1
      `;
      return rows[0] || null;
    } catch {
      return null;
    }
  }

  async deliver(payload) {
    const { userId, event, plan, task, request, actor, message } = payload;

    const settings = await this.getSettings(userId);
    if (!settings) {
      return { success: false, reason: 'No webhook configured' };
    }

    // Check if this event type is enabled
    if (settings.events?.length > 0 && !settings.events.includes(event)) {
      return { success: false, reason: `Event ${event} not enabled` };
    }

    const body = {
      event,
      timestamp: new Date().toISOString(),
      plan: plan ? { id: plan.id, title: plan.title } : undefined,
      task: task ? {
        id: task.id, title: task.title, description: task.description,
        status: task.status, agent_instructions: task.agent_instructions,
      } : undefined,
      request: request ? {
        type: request.type, message: request.message,
        requested_at: request.requested_at, requested_by: request.requested_by,
      } : undefined,
      actor: actor ? { name: actor.name, type: actor.type || 'user' } : undefined,
      message,
    };

    const headers = { 'Content-Type': 'application/json' };
    if (settings.secret) {
      const crypto = require('crypto');
      const signature = crypto.createHmac('sha256', settings.secret)
        .update(JSON.stringify(body)).digest('hex');
      headers['X-Webhook-Signature'] = signature;
    }

    try {
      const response = await fetch(settings.url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10000),
      });

      const success = response.ok;
      if (!success) {
        await logger.error(`Webhook delivery failed: ${response.status} to ${settings.url}`);
      }

      return {
        success,
        statusCode: response.status,
        url: settings.url,
      };
    } catch (error) {
      await logger.error(`Webhook delivery error: ${error.message}`);
      return { success: false, error: error.message };
    }
  }
}

module.exports = { WebhookAdapter };
