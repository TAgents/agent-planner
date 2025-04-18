const express = require('express');
const router = express.Router();
const debugController = require('../controllers/debug.controller');
const { authenticate } = require('../middleware/auth.middleware');
const { supabaseAdmin } = require('../config/supabase');

/**
 * @swagger
 * tags:
 *   name: Debug
 *   description: Debug endpoints (not for production use)
 */

/**
 * @swagger
 * /debug/tokens:
 *   get:
 *     summary: Debug endpoint to view all tokens for current user including revoked ones
 *     tags: [Debug]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Token debug information
 *       401:
 *         description: Authentication required
 */
router.get('/tokens', authenticate, debugController.debugTokens);

// Debug test-search route has been removed as per recommendations

module.exports = router;
