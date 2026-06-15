/**
 * Internal service auth — guards privileged server-to-server endpoints (the
 * OAuth store the hosted MCP calls). Requires X-Internal-Token to match the
 * shared MCP_INTERNAL_SECRET. Fails closed: if the secret is unset, the routes
 * are disabled (503) rather than open.
 *
 * These routes should also NOT be exposed publicly via nginx; the shared secret
 * is defense-in-depth.
 */
const crypto = require('crypto');

const SECRET = process.env.MCP_INTERNAL_SECRET || '';

function internalAuth(req, res, next) {
  if (!SECRET) {
    return res.status(503).json({ error: 'Internal endpoints disabled (MCP_INTERNAL_SECRET not configured)' });
  }
  const provided = Buffer.from(req.get('X-Internal-Token') || '');
  const expected = Buffer.from(SECRET);
  if (provided.length !== expected.length || !crypto.timingSafeEqual(provided, expected)) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  next();
}

module.exports = { internalAuth };
