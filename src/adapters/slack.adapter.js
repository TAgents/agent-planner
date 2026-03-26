/**
 * Slack Adapter — delivers notifications via Slack Bot
 *
 * Tokens are stored encrypted (AES-256-GCM) by the OAuth flow in slack.js.
 * Always decrypt before passing to WebClient.
 */
const { BaseAdapter } = require('./base.adapter');
const { decrypt } = require('../services/slack');
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
    const { userId, event, plan, task, decision, request, actor, message, plan_url, task_url } = payload;

    const settings = await this.getSettings(userId);
    if (!settings) {
      return { success: false, reason: 'No Slack integration configured' };
    }

    // Decrypt the stored token before use
    let token;
    try {
      token = decrypt(settings.bot_token);
    } catch (err) {
      logger.error(`Slack adapter: failed to decrypt token for user ${userId}: ${err.message}`);
      return { success: false, error: 'Token decryption failed' };
    }

    // Build Slack message blocks
    const blocks = this._buildBlocks(event, plan, task, decision, request, actor, message, { plan_url, task_url });

    try {
      const { WebClient } = require('@slack/web-api');
      const slack = new WebClient(token);

      const result = await slack.chat.postMessage({
        channel: settings.channel_id,
        text: message || `AgentPlanner: ${event}`,
        blocks,
        unfurl_links: false,
      });

      return {
        success: true,
        channel: settings.channel_id,
        ts: result.ts,
      };
    } catch (error) {
      logger.error(`Slack delivery error: ${error.message}`);
      return { success: false, error: error.message };
    }
  }

  _buildBlocks(event, plan, task, decision, request, actor, message, urls = {}) {
    const blocks = [];
    const emoji = this._eventEmoji(event);

    // Header message
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: `${emoji} *${message || event}*` },
    });

    // Task details
    if (task) {
      const taskLink = urls.task_url ? `<${urls.task_url}|${task.title}>` : task.title;
      let taskText = `*Task:* ${taskLink}\n*Status:* ${task.status}`;
      if (task.description) taskText += `\n*Description:* ${task.description.substring(0, 300)}`;
      if (task.agent_instructions) taskText += `\n*Agent instructions:* ${task.agent_instructions.substring(0, 200)}`;
      blocks.push({
        type: 'section',
        text: { type: 'mrkdwn', text: taskText },
      });
    }

    // Decision details
    if (decision) {
      let decisionText = `*Decision:* ${decision.title}`;
      if (decision.context) decisionText += `\n${decision.context.substring(0, 400)}`;
      if (decision.options?.length) {
        decisionText += '\n*Options:*\n' + decision.options
          .map((o, i) => `${i + 1}. ${typeof o === 'string' ? o : o.label || o.option || JSON.stringify(o)}`)
          .join('\n');
      }
      blocks.push({
        type: 'section',
        text: { type: 'mrkdwn', text: decisionText },
      });
    }

    // Agent request message
    if (request?.message) {
      blocks.push({
        type: 'section',
        text: { type: 'mrkdwn', text: `> ${request.message}` },
      });
    }

    // Plan context
    if (plan) {
      const planLink = urls.plan_url ? `<${urls.plan_url}|${plan.title}>` : plan.title;
      blocks.push({
        type: 'context',
        elements: [{ type: 'mrkdwn', text: `📋 Plan: ${planLink}` }],
      });
    }

    // CTA button
    const linkUrl = urls.task_url || urls.plan_url;
    if (linkUrl) {
      blocks.push({
        type: 'actions',
        elements: [{
          type: 'button',
          text: { type: 'plain_text', text: urls.task_url ? 'View Task →' : 'View Plan →' },
          url: linkUrl,
          action_id: 'view_in_app',
          style: event.includes('blocking') ? 'danger' : 'primary',
        }],
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
      'task.status_changed': '🔄',
      'decision.requested': '🤔',
      'decision.requested.blocking': '🚨',
      'decision.resolved': '✅',
    };
    return map[event] || '🔔';
  }
}

module.exports = { SlackAdapter };
