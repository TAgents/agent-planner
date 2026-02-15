/**
 * Supabase compatibility shim — provides a Supabase-like API backed by Postgres/Drizzle.
 * The v1 (real Supabase) path has been removed. AUTH_VERSION=v2 is now permanent.
 */
module.exports = require('./supabase.v2');
