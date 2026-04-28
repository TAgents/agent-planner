const express = require('express');
const { authenticate } = require('../../middleware/auth.middleware');
const controller = require('./agentLoop.controller');

const router = express.Router();

/**
 * @swagger
 * /agent/briefing:
 *   get:
 *     summary: Get bundled mission-control state for agents
 *     tags: [Agent Loop]
 *     security:
 *       - bearerAuth: []
 *       - apiKey: []
 *     responses:
 *       200:
 *         description: Agent briefing with goals, decisions, claims, activity, and recommendations
 */
router.get('/briefing', authenticate, controller.briefing);

/**
 * @swagger
 * /agent/work-sessions:
 *   post:
 *     summary: Pick or claim a task, mark it in progress, and return context
 *     tags: [Agent Loop]
 *     security:
 *       - bearerAuth: []
 *       - apiKey: []
 *     responses:
 *       201:
 *         description: Work session started
 *       409:
 *         description: Task is already claimed
 */
router.post('/work-sessions', authenticate, controller.startWorkSession);

/**
 * @swagger
 * /agent/work-sessions/{sessionId}/complete:
 *   post:
 *     summary: Complete a work session atomically
 *     tags: [Agent Loop]
 *     security:
 *       - bearerAuth: []
 *       - apiKey: []
 *     responses:
 *       200:
 *         description: Task completed, log written, and claim released
 */
router.post('/work-sessions/:sessionId/complete', authenticate, controller.completeWorkSession);

/**
 * @swagger
 * /agent/work-sessions/{sessionId}/block:
 *   post:
 *     summary: Block a work session and optionally queue a human decision
 *     tags: [Agent Loop]
 *     security:
 *       - bearerAuth: []
 *       - apiKey: []
 *     responses:
 *       200:
 *         description: Task blocked, log written, optional decision queued, and claim released
 */
router.post('/work-sessions/:sessionId/block', authenticate, controller.blockWorkSession);

/**
 * @swagger
 * /agent/intentions:
 *   post:
 *     summary: Create a plan tree under a goal as an agent intention
 *     tags: [Agent Loop]
 *     security:
 *       - bearerAuth: []
 *       - apiKey: []
 *     responses:
 *       201:
 *         description: Intention created and linked to the goal
 */
router.post('/intentions', authenticate, controller.createIntention);

module.exports = router;
