/**
 * Auth & controller config — selects v1 (Supabase) or v2 (direct Postgres)
 *
 * Set AUTH_VERSION=v2 to use the new system.
 * Default: v1 (Supabase) for backward compatibility.
 */
const authVersion = process.env.AUTH_VERSION || 'v1';

let authController, authMiddleware, planController, nodeController;

if (authVersion === 'v2') {
  console.log('🔐 Auth: v2 (direct Postgres + JWT)');
  console.log('📦 Controllers: v2 (DAL + Supabase shim)');
  authController = require('../controllers/auth.controller.v2');
  authMiddleware = require('../middleware/auth.middleware.v2');
  planController = require('../controllers/plan.controller.v2');
  nodeController = require('../controllers/node.controller.v2');
} else {
  console.log('🔐 Auth: v1 (Supabase)');
  authController = require('../controllers/auth.controller');
  authMiddleware = require('../middleware/auth.middleware');
  planController = require('../controllers/plan.controller');
  nodeController = require('../controllers/node.controller');
}

module.exports = { authController, authMiddleware, planController, nodeController, authVersion };
