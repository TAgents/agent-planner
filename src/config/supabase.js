/**
 * Supabase config — switches between v1 (real Supabase) and v2 (Postgres shim)
 * Set AUTH_VERSION=v2 to use direct Postgres.
 */
const authVersion = process.env.AUTH_VERSION || 'v1';

if (authVersion === 'v2') {
  // Use the compatibility shim that talks to Postgres directly
  module.exports = require('./supabase.v2');
} else {
  // Original Supabase client
  const { createClient } = require('@supabase/supabase-js');
  require('dotenv').config();

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;

  if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceKey) {
    console.error('Missing Supabase configuration. Please check your .env file.');
    process.exit(1);
  }

  const supabase = createClient(supabaseUrl, supabaseAnonKey);
  const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

  module.exports = { supabase, supabaseAdmin };
}
