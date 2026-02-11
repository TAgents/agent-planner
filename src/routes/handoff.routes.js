const express = require('express');
const router = express.Router();
const handoffController = require('../controllers/handoff.controller');
const { authenticate } = require('../middleware/auth.middleware');

/**
 * @swagger
 * /plans/{id}/nodes/{nodeId}/handoffs:
 *   post:
 *     summary: Create a handoff request
 *     tags: [Handoffs]
 *     security:
 *       - bearerAuth: []
 */
router.post('/:id/nodes/:nodeId/handoffs', authenticate, handoffController.createHandoff);

/**
 * @swagger
 * /plans/{id}/nodes/{nodeId}/handoffs:
 *   get:
 *     summary: Get handoffs for a node
 *     tags: [Handoffs]
 *     security:
 *       - bearerAuth: []
 */
router.get('/:id/nodes/:nodeId/handoffs', authenticate, handoffController.getNodeHandoffs);

/**
 * @swagger
 * /handoffs/{handoffId}/respond:
 *   post:
 *     summary: Accept or reject a handoff
 *     tags: [Handoffs]
 *     security:
 *       - bearerAuth: []
 */
router.post('/handoffs/:handoffId/respond', authenticate, handoffController.respondToHandoff);

/**
 * @swagger
 * /handoffs/pending:
 *   get:
 *     summary: Get pending handoffs for current user
 *     tags: [Handoffs]
 *     security:
 *       - bearerAuth: []
 */
router.get('/handoffs/pending', authenticate, handoffController.getMyPendingHandoffs);

module.exports = router;
