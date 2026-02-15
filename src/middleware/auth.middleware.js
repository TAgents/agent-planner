/**
 * Auth middleware — JWT + API Token verification (no Supabase).
 * The v1 (Supabase) path has been removed. AUTH_VERSION=v2 is now permanent.
 */
module.exports = require('./auth.middleware.v2');
