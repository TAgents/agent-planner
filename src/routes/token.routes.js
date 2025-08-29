const express = require('express');
const router = express.Router();

/**
 * @swagger
 * tags:
 *   name: API Tokens
 *   description: API token management endpoints (DEPRECATED)
 */

// NOTE: Token management endpoints have been consolidated into /auth routes
// to avoid duplication. Use /auth/token endpoints instead:
// - POST /auth/token (create token)
// - DELETE /auth/token/:id (revoke token)
// This file is kept for backwards compatibility documentation only.

module.exports = router;