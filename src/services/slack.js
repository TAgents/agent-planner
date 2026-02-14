/**
 * Slack Integration Service
 * Handles posting messages to Slack and managing integrations
 */

const { WebClient } = require('@slack/web-api');
const { supabaseAdmin } = require('../config/supabase');
const logger = require('../utils/logger');
const crypto = require('crypto');

// Encryption for bot tokens
const ENCRYPTION_KEY = process.env.SLACK_ENCRYPTION_KEY || process.env.JWT_SECRET;
if (!ENCRYPTION_KEY) {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('SLACK_ENCRYPTION_KEY or JWT_SECRET must be set in production');
  }
  logger.warn('No SLACK_ENCRYPTION_KEY or JWT_SECRET set - Slack token encryption will fail. Set one of these environment variables.');
}
const ALGORITHM = 'aes-256-gcm';

function getEncryptionKey() {
  return crypto.createHash('sha256').update(ENCRYPTION_KEY).digest();
}

function encrypt(text) {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGORITHM, getEncryptionKey(), iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');
  return `${iv.toString('hex')}:${authTag}:${encrypted}`;
}

function decrypt(encryptedText) {
  const [ivHex, authTagHex, encrypted] = encryptedText.split(':');
  if (!ivHex || !authTagHex || !encrypted) {
    throw new Error('Invalid encrypted text format');
  }
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');
  const decipher = crypto.createDecipheriv(ALGORITHM, getEncryptionKey(), iv);
  decipher.setAuthTag(authTag);
  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

/**
 * Get Slack integration for a user
 */
async function getIntegration(userId) {
  const { data, error } = await supabaseAdmin
    .from('slack_integrations')
    .select('id, user_id, team_id, team_name, bot_token, channel_id, channel_name, is_active, installed_at, updated_at')
    .eq('user_id', userId)
    .eq('is_active', true)
    .single();

  if (error) {
    logger.error('Error fetching Slack integration:', error);
    return null;
  }
  if (!data) return null;
  return data;
}

/**
 * Save or update Slack integration
 */
async function saveIntegration({ userId, teamId, teamName, botToken, channelId, channelName }) {
  const encryptedToken = encrypt(botToken);

  const { data, error } = await supabaseAdmin
    .from('slack_integrations')
    .upsert({
      user_id: userId,
      team_id: teamId,
      team_name: teamName,
      bot_token: encryptedToken,
      channel_id: channelId || null,
      channel_name: channelName || null,
      is_active: true,
      updated_at: new Date().toISOString()
    }, {
      onConflict: 'user_id,team_id'
    })
    .select()
    .single();

  if (error) {
    logger.error('Error saving Slack integration:', error);
    throw new Error('Failed to save Slack integration');
  }

  return data;
}

/**
 * Update channel for an existing integration
 */
async function updateChannel(userId, channelId, channelName) {
  const { data, error } = await supabaseAdmin
    .from('slack_integrations')
    .update({
      channel_id: channelId,
      channel_name: channelName,
      updated_at: new Date().toISOString()
    })
    .eq('user_id', userId)
    .eq('is_active', true)
    .select()
    .single();

  if (error) {
    logger.error('Error updating Slack channel:', error);
    throw new Error('Failed to update Slack channel');
  }

  return data;
}

/**
 * Disconnect Slack integration
 */
async function disconnect(userId) {
  const { error } = await supabaseAdmin
    .from('slack_integrations')
    .update({ is_active: false, updated_at: new Date().toISOString() })
    .eq('user_id', userId)
    .eq('is_active', true);

  if (error) {
    logger.error('Error disconnecting Slack:', error);
    throw new Error('Failed to disconnect Slack');
  }
}

/**
 * Get a WebClient for a user's integration
 */
async function getClient(userId) {
  const integration = await getIntegration(userId);
  if (!integration) return null;

  try {
    const token = decrypt(integration.bot_token);
    return new WebClient(token);
  } catch (err) {
    logger.error('Error decrypting Slack token:', err);
    return null;
  }
}

/**
 * List channels the bot has access to
 */
async function listChannels(userId) {
  const client = await getClient(userId);
  if (!client) return [];

  try {
    const result = await client.conversations.list({
      types: 'public_channel,private_channel',
      exclude_archived: true,
      limit: 100
    });
    return (result.channels || []).map(ch => ({
      id: ch.id,
      name: ch.name,
      is_private: ch.is_private
    }));
  } catch (err) {
    logger.error('Error listing Slack channels:', err);
    return [];
  }
}

/**
 * Post a message to Slack
 */
async function postMessage(userId, text, blocks) {
  const integration = await getIntegration(userId);
  if (!integration || !integration.channel_id) {
    logger.warn(`No Slack integration or channel configured for user ${userId}`);
    return null;
  }

  const client = await getClient(userId);
  if (!client) return null;

  try {
    const result = await client.chat.postMessage({
      channel: integration.channel_id,
      text,
      blocks,
      unfurl_links: false
    });
    return result;
  } catch (err) {
    logger.error('Error posting to Slack:', err);
    return null;
  }
}

/**
 * Post an agent request notification to Slack
 */
async function postAgentRequest(userId, { node, plan, requestType, message }) {
  const typeEmoji = {
    start: '🚀',
    review: '👀',
    help: '💡',
    continue: '▶️'
  };

  const emoji = typeEmoji[requestType] || '📋';
  const text = `${emoji} Agent request: ${requestType} on "${node.title}" in plan "${plan.title}"`;

  const blocks = [
    {
      type: 'header',
      text: {
        type: 'plain_text',
        text: `${emoji} Agent Request: ${requestType.charAt(0).toUpperCase() + requestType.slice(1)}`
      }
    },
    {
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: `*Plan:*\n${plan.title}` },
        { type: 'mrkdwn', text: `*Task:*\n${node.title}` }
      ]
    }
  ];

  if (message) {
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: `*Message:*\n${message}` }
    });
  }

  if (node.description) {
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: `*Description:*\n${node.description.substring(0, 500)}` }
    });
  }

  if (node.agent_instructions) {
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: `*Instructions:*\n${node.agent_instructions.substring(0, 500)}` }
    });
  }

  blocks.push({
    type: 'context',
    elements: [
      { type: 'mrkdwn', text: `Plan ID: \`${plan.id}\` | Task ID: \`${node.id}\`` }
    ]
  });

  return postMessage(userId, text, blocks);
}

/**
 * Post a decision request notification to Slack
 */
async function postDecisionRequest(userId, { decision, plan }) {
  const urgencyEmoji = decision.urgency === 'blocking' ? '🔴' : '🟡';
  const text = `${urgencyEmoji} Decision needed: "${decision.title}" in plan "${plan.title}"`;

  const blocks = [
    {
      type: 'header',
      text: {
        type: 'plain_text',
        text: `${urgencyEmoji} Decision Required`
      }
    },
    {
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: `*Plan:*\n${plan.title}` },
        { type: 'mrkdwn', text: `*Urgency:*\n${decision.urgency}` }
      ]
    },
    {
      type: 'section',
      text: { type: 'mrkdwn', text: `*${decision.title}*\n${decision.context || ''}` }
    }
  ];

  if (decision.options && decision.options.length > 0) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Options:*\n${decision.options.map((o, i) => `${i + 1}. ${typeof o === 'string' ? o : o.label || o.text || JSON.stringify(o)}`).join('\n')}`
      }
    });
  }

  return postMessage(userId, text, blocks);
}

module.exports = {
  getIntegration,
  saveIntegration,
  updateChannel,
  disconnect,
  getClient,
  listChannels,
  postMessage,
  postAgentRequest,
  postDecisionRequest,
  encrypt,
  decrypt
};
