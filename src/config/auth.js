/**
 * Auth & controller config — v2 (direct Postgres + JWT).
 */
const authController = require('../controllers/auth.controller.v2');
const authMiddleware = require('../middleware/auth.middleware.v2');
const planController = require('../controllers/plan.controller.v2');
const nodeController = require('../controllers/node.controller.v2');

module.exports = { authController, authMiddleware, planController, nodeController, authVersion: 'v2' };
