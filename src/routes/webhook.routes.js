const express = require('express');
const router = express.Router();
const webhookController = require('../controllers/webhook.controller');
const { authenticate, optionalAuthenticate } = require('../middleware/auth.middleware');

/**
 * @swagger
 * components:
 *   schemas:
 *     ClawdbotWebhookEvent:
 *       type: object
 *       required:
 *         - event_type
 *         - data
 *       properties:
 *         event_type:
 *           type: string
 *           enum: [message, command, callback, ping]
 *           description: Type of webhook event
 *         data:
 *           type: object
 *           description: Event-specific data payload
 *         bot_id:
 *           type: string
 *           description: Unique identifier for the bot instance
 *         timestamp:
 *           type: string
 *           format: date-time
 *           description: Event timestamp
 *
 *     ClawdbotBotRegistration:
 *       type: object
 *       required:
 *         - bot_id
 *       properties:
 *         bot_id:
 *           type: string
 *           description: Unique identifier for the bot
 *         bot_name:
 *           type: string
 *           description: Display name for the bot
 *         platform:
 *           type: string
 *           description: Primary messaging platform (telegram, discord, slack, etc.)
 *         capabilities:
 *           type: array
 *           items:
 *             type: string
 *           description: List of supported capabilities
 *
 *     ClawdbotConfig:
 *       type: object
 *       properties:
 *         webhook_url:
 *           type: string
 *           description: URL for receiving webhook events
 *         websocket_url:
 *           type: string
 *           description: WebSocket URL for real-time updates
 *         supported_events:
 *           type: array
 *           items:
 *             type: string
 *           description: List of supported event types
 *         supported_commands:
 *           type: array
 *           items:
 *             type: string
 *           description: List of supported commands
 *         version:
 *           type: string
 *           description: API version
 */

/**
 * @swagger
 * /webhooks/clawdbot:
 *   post:
 *     summary: Receive webhook events from Clawdbot
 *     description: |
 *       Handles incoming webhook events from Clawdbot gateway.
 *       Used as an alternative to WebSocket connections for serverless deployments.
 *
 *       **Event Types:**
 *       - `message` - Bot received a message related to a plan
 *       - `command` - Bot received a slash command
 *       - `callback` - User interacted with a button/menu
 *       - `ping` - Health check
 *
 *       **Security:**
 *       Include `X-Clawdbot-Signature` header with HMAC-SHA256 signature if webhook secret is configured.
 *     tags: [Webhooks]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/ClawdbotWebhookEvent'
 *           examples:
 *             message:
 *               summary: Message event
 *               value:
 *                 event_type: message
 *                 data:
 *                   plan_id: "123e4567-e89b-12d3-a456-426614174000"
 *                   node_id: "987fcdeb-51a2-3b4c-d567-890123456789"
 *                   message: "Task completed!"
 *                   platform: telegram
 *                   channel: "-100123456789"
 *                   user:
 *                     id: "user-123"
 *                     name: "John Doe"
 *                 bot_id: "clawdbot-001"
 *                 timestamp: "2024-01-15T10:30:00Z"
 *             ping:
 *               summary: Health check
 *               value:
 *                 event_type: ping
 *                 bot_id: "clawdbot-001"
 *     responses:
 *       200:
 *         description: Webhook processed successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 received:
 *                   type: string
 *                   description: The event type that was received
 *       401:
 *         description: Invalid webhook signature
 *       500:
 *         description: Server error
 */
router.post('/clawdbot', webhookController.handleClawdbotWebhook);

/**
 * @swagger
 * /webhooks/clawdbot/register:
 *   post:
 *     summary: Register a Clawdbot bot user
 *     description: |
 *       Creates or updates a bot user profile for Clawdbot integration.
 *       The bot user can then be assigned to tasks and will appear in activity logs.
 *     tags: [Webhooks]
 *     security:
 *       - bearerAuth: []
 *       - apiKeyAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/ClawdbotBotRegistration'
 *           example:
 *             bot_id: "clawdbot-telegram-001"
 *             bot_name: "Planning Bot"
 *             platform: "telegram"
 *             capabilities:
 *               - plans
 *               - tasks
 *               - comments
 *               - notifications
 *     responses:
 *       200:
 *         description: Bot registered successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 bot:
 *                   type: object
 *                   properties:
 *                     id:
 *                       type: string
 *                     name:
 *                       type: string
 *                     type:
 *                       type: string
 *       401:
 *         description: Authentication required
 *       500:
 *         description: Server error
 */
router.post('/clawdbot/register', authenticate, webhookController.registerClawdbotBot);

/**
 * @swagger
 * /webhooks/clawdbot/config:
 *   get:
 *     summary: Get webhook configuration for Clawdbot
 *     description: |
 *       Returns the webhook configuration including supported events, commands, and connection URLs.
 *       Use this to configure the Clawdbot skill.
 *     tags: [Webhooks]
 *     security:
 *       - bearerAuth: []
 *       - apiKeyAuth: []
 *     responses:
 *       200:
 *         description: Configuration retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 config:
 *                   $ref: '#/components/schemas/ClawdbotConfig'
 *       500:
 *         description: Server error
 */
router.get('/clawdbot/config', optionalAuthenticate, webhookController.getClawdbotConfig);

module.exports = router;
