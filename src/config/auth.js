/**
 * Auth config — selects v1 (Supabase) or v2 (direct Postgres) based on env
 *
 * Set AUTH_VERSION=v2 to use the new auth system.
 * Default: v1 (Supabase) for backward compatibility.
 */
const authVersion = process.env.AUTH_VERSION || 'v1';

let authController;
let authMiddleware;

if (authVersion === 'v2') {
  console.log('🔐 Auth: v2 (direct Postgres + JWT)');
  authController = require('../controllers/auth.controller.v2');
  authMiddleware = require('../middleware/auth.middleware.v2');
} else {
  console.log('🔐 Auth: v1 (Supabase)');
  authController = require('../controllers/auth.controller');
  authMiddleware = require('../middleware/auth.middleware');
}

module.exports = { authController, authMiddleware, authVersion };
