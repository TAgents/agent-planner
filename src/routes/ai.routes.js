const express = require('express');
const router = express.Router();
const aiController = require('../controllers/ai.controller');
const { authenticate } = require('../middleware/auth.middleware');

/**
 * @swagger
 * /ai/analyze-prompt:
 *   post:
 *     summary: Analyze a prompt and generate clarifying questions
 *     description: Uses AI to analyze a project description and generate relevant follow-up questions to improve plan generation.
 *     tags: [AI]
 *     security:
 *       - bearerAuth: []
 *       - apiKeyAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - prompt
 *             properties:
 *               prompt:
 *                 type: string
 *                 description: The project description to analyze
 *                 example: "Build a mobile app for tracking daily habits"
 *     responses:
 *       200:
 *         description: Successfully generated questions
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 questions:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id:
 *                         type: string
 *                         example: "q1"
 *                       category:
 *                         type: string
 *                         enum: [scope, constraints, context]
 *                         example: "scope"
 *                       question:
 *                         type: string
 *                         example: "What specific habits do you want users to track?"
 *                       placeholder:
 *                         type: string
 *                         example: "e.g., Exercise, reading, meditation..."
 *                 usage:
 *                   type: object
 *                   properties:
 *                     inputTokens:
 *                       type: integer
 *                     outputTokens:
 *                       type: integer
 *       400:
 *         description: Invalid request
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */
router.post('/analyze-prompt', authenticate, aiController.analyzePrompt);

module.exports = router;
