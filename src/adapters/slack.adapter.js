/**
 * Slack Adapter — delivers notifications via Slack Bot
 */
const { BaseAdapter } = require('./base.adapter');
const logger = require('../utils/logger');

class SlackAdapter extends BaseAdapter {
  constructor() {
    super('slack');
  }

  async isConfigured(userId) {
    const settings = await this.getSettings(userId);
    return !!settings?.bot_token && !!settings?.channel_id;
  }

  async getSettings(userId) {
    try {
      const { db } = require('../db/connection.cjs');
      const rows = await db`
        SELECT bot_token, channel_id, channel_name, team_name
        FROM slack_integrations
        WHERE user_id = ${userId} AND is_active = true
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
      return { success: false, reason: 'No Slack integration configured' };
    }

    // Build Slack message blocks
    const blocks = this._buildBlocks(event, plan, task, request, actor, message);

    try {
      const { WebClient } = require('@slack/web-api');
      const slack = new WebClient(settings.bot_token);

      const result = await slack.chat.postMessage({
        channel: settings.channel_id,
        text: message || `AgentPlanner: ${event}`,
        blocks,
      });

      return {
        success: true,
        channel: settings.channel_id,
        ts: result.ts,
      };
    } catch (error) {
      await logger.error(`Slack delivery error: ${error.message}`);
      return { success: false, error: error.message };
    }
  }

  _buildBlocks(event, plan, task, request, actor, message) {
    const blocks = [];

    // Header
    const emoji = this._eventEmoji(event);
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: `${emoji} *${message || event}*` },
    });

    // Task details
    if (task) {
      let taskText = `*Task:* ${task.title}\n*Status:* ${task.status}`;
      if (task.description) taskText += `\n*Description:* ${task.description.substring(0, 200)}`;
      blocks.push({
        type: 'section',
        text: { type: 'mrkdwn', text: taskText },
      });
    }

    // Plan context
    if (plan) {
      blocks.push({
        type: 'context',
        elements: [{ type: 'mrkdwn', text: `📋 Plan: *${plan.title}*` }],
      });
    }

    // Request details
    if (request?.message) {
      blocks.push({
        type: 'section',
        text: { type: 'mrkdwn', text: `> ${request.message}` },
      });
    }

    return blocks;
  }

  _eventEmoji(event) {
    const map = {
      'task.start_requested': '🚀',
      'task.review_requested': '🔍',
      'task.help_requested': '🆘',
      'task.continue_requested': '▶️',
      'task.blocked': '🚫',
      'task.completed': '✅',
      'task.assigned': '📋',
      'decision.requested': '🤔',
      'decision.requested.blocking': '🚨',
      'decision.resolved': '✅',
    };
    return map[event] || '🔔';
  }
}

module.exports = { SlackAdapter };
