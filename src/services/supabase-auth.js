/**
 * Supabase Auth Service
 * 
 * Thin wrapper around Supabase Auth SDK.
 * This is the ONLY file outside config/ that should import supabase directly.
 * All database queries should go through the DAL layer instead.
 */
const { supabase, supabaseAdmin } = require('../config/supabase');

module.exports = {
  /** Public client auth methods (signUp, signIn, etc.) */
  auth: supabase?.auth,
  /** Admin auth methods (getUserById, createUser, etc.) */
  adminAuth: supabaseAdmin?.auth,
  /** Supabase Storage (for file uploads) */
  storage: supabaseAdmin?.storage,
};
