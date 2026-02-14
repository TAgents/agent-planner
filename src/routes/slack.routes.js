/**
 * Slack Integration Routes
 * OAuth flow and integration management
 */

const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth.middleware');
const slackService = require('../services/slack');
const logger = require('../utils/logger');

/**
 * GET /integrations/slack/status
 * Get current Slack integration status
 */
router.get('/status', authenticateToken, async (req, res) => {
  try {
    const integration = await slackService.getIntegration(req.user.id);
    if (!integration) {
      return res.json({ connected: false });
    }

    return res.json({
      connected: true,
      team_name: integration.team_name,
      channel_id: integration.channel_id,
      channel_name: integration.channel_name,
      installed_at: integration.installed_at
    });
  } catch (err) {
    logger.error('Error getting Slack status:', err);
    res.status(500).json({ error: 'Failed to get Slack status' });
  }
});

/**
 * GET /integrations/slack/install
 * Redirect to Slack OAuth install URL
 */
router.get('/install', authenticateToken, async (req, res) => {
  const clientId = process.env.SLACK_CLIENT_ID;
  if (!clientId) {
    return res.status(500).json({ error: 'Slack integration not configured' });
  }

  const redirectUri = `${process.env.API_BASE_URL || req.protocol + '://' + req.get('host')}/integrations/slack/callback`;
  const scopes = 'chat:write,channels:read,groups:read';
  const state = Buffer.from(JSON.stringify({ userId: req.user.id })).toString('base64');

  const installUrl = `https://slack.com/oauth/v2/authorize?client_id=${clientId}&scope=${scopes}&redirect_uri=${encodeURIComponent(redirectUri)}&state=${state}`;

  res.json({ url: installUrl });
});

/**
 * GET /integrations/slack/callback
 * Handle Slack OAuth callback
 */
router.get('/callback', async (req, res) => {
  const { code, state } = req.query;

  if (!code || !state) {
    return res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:3001'}/app/settings/integrations?slack=error&reason=missing_params`);
  }

  try {
    const { userId } = JSON.parse(Buffer.from(state, 'base64').toString());

    const clientId = process.env.SLACK_CLIENT_ID;
    const clientSecret = process.env.SLACK_CLIENT_SECRET;
    const redirectUri = `${process.env.API_BASE_URL || req.protocol + '://' + req.get('host')}/integrations/slack/callback`;

    // Exchange code for token
    const { WebClient } = require('@slack/web-api');
    const client = new WebClient();
    const result = await client.oauth.v2.access({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: redirectUri
    });

    if (!result.ok) {
      throw new Error(result.error || 'OAuth failed');
    }

    // Save integration
    await slackService.saveIntegration({
      userId,
      teamId: result.team.id,
      teamName: result.team.name,
      botToken: result.access_token
    });

    res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:3001'}/app/settings/integrations?slack=success`);
  } catch (err) {
    logger.error('Slack OAuth callback error:', err);
    res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:3001'}/app/settings/integrations?slack=error&reason=${encodeURIComponent(err.message)}`);
  }
});

/**
 * GET /integrations/slack/channels
 * List available channels
 */
router.get('/channels', authenticateToken, async (req, res) => {
  try {
    const channels = await slackService.listChannels(req.user.id);
    res.json({ channels });
  } catch (err) {
    logger.error('Error listing Slack channels:', err);
    res.status(500).json({ error: 'Failed to list channels' });
  }
});

/**
 * PUT /integrations/slack/channel
 * Set the channel for notifications
 */
router.put('/channel', authenticateToken, async (req, res) => {
  try {
    const { channelId, channelName } = req.body;
    if (!channelId) {
      return res.status(400).json({ error: 'channelId is required' });
    }

    const integration = await slackService.updateChannel(req.user.id, channelId, channelName);
    res.json({
      success: true,
      channel_id: integration.channel_id,
      channel_name: integration.channel_name
    });
  } catch (err) {
    logger.error('Error setting Slack channel:', err);
    res.status(500).json({ error: 'Failed to set channel' });
  }
});

/**
 * DELETE /integrations/slack
 * Disconnect Slack integration
 */
router.delete('/', authenticateToken, async (req, res) => {
  try {
    await slackService.disconnect(req.user.id);
    res.json({ success: true });
  } catch (err) {
    logger.error('Error disconnecting Slack:', err);
    res.status(500).json({ error: 'Failed to disconnect' });
  }
});

/**
 * POST /integrations/slack/test
 * Send a test message
 */
router.post('/test', authenticateToken, async (req, res) => {
  try {
    const result = await slackService.postMessage(
      req.user.id,
      '✅ AgentPlanner Slack integration is working!',
      [{
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: '✅ *AgentPlanner* Slack integration is working!\nYou will receive agent requests and decision notifications here.'
        }
      }]
    );

    if (result) {
      res.json({ success: true });
    } else {
      res.status(400).json({ error: 'Failed to send test message. Check channel configuration.' });
    }
  } catch (err) {
    logger.error('Error sending test message:', err);
    res.status(500).json({ error: 'Failed to send test message' });
  }
});

module.exports = router;
