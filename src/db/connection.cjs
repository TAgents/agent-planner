// CJS bridge for database connection
// Provides the raw postgres.js client for the Supabase compatibility shim

let _client = null;
let _loading = null;

function getClient() {
  if (_client) return _client;

  // Use postgres.js directly (CJS compatible)
  const postgres = require('postgres');

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL environment variable is required');
  }

  _client = postgres(connectionString, {
    max: 20,
    idle_timeout: 20,
    connect_timeout: 10,
  });

  return _client;
}

module.exports = {
  get db() { return getClient(); },
};
