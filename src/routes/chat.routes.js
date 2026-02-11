const express = require('express');
const router = express.Router();
const chatController = require('../controllers/chat.controller');
const { authenticate } = require('../middleware/auth.middleware');

/**
 * @swagger
 * /plans/{id}/chat:
 *   get:
 *     summary: Get chat messages for a plan
 *     tags: [Chat]
 *     security:
 *       - bearerAuth: []
 */
router.get('/:id/chat', authenticate, chatController.getChatMessages);

/**
 * @swagger
 * /plans/{id}/chat:
 *   post:
 *     summary: Send a chat message in a plan
 *     tags: [Chat]
 *     security:
 *       - bearerAuth: []
 */
router.post('/:id/chat', authenticate, chatController.sendChatMessage);

module.exports = router;
