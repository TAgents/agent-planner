const express = require('express');
const router = express.Router();
const { getPlatformStats } = require('../controllers/stats.controller');

/**
 * @swagger
 * /api/v1/stats:
 *   get:
 *     summary: Get platform-wide statistics
 *     description: Returns the total number of users, plans, and public plans
 *     tags: [Stats]
 *     responses:
 *       200:
 *         description: Platform statistics
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 users:
 *                   type: integer
 *                   description: Total number of users
 *                 plans:
 *                   type: integer
 *                   description: Total number of plans
 *                 publicPlans:
 *                   type: integer
 *                   description: Total number of public plans
 *       500:
 *         description: Server error
 */
router.get('/', getPlatformStats);

module.exports = router;
