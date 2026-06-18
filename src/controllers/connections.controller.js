/**
 * Connected apps — user-facing view of OAuth connector connections.
 *
 * Answers "which external app can act as me?" and lets the user disconnect one.
 * Reads the `oauth_refresh_tokens` table (via oauthDal); disconnecting revokes
 * every active refresh token for that client, killing the connection within the
 * access-token TTL. API tokens are a separate surface (see token.controller.js).
 */
const dal = require('../db/dal.cjs');
const logger = require('../utils/logger');

// We currently issue a single `agentplanner` scope = full delegated access.
// Translate the scope set into plain-language capabilities for the UI rather
// than leaking opaque scope strings or vague "can access your workspace" copy.
function capabilitiesForScopes(scopes) {
  const list = Array.isArray(scopes) ? scopes : [];
  const fullAccess = list.length === 0 || list.includes('agentplanner');
  if (fullAccess) {
    const areas = ['plans', 'goals', 'tasks', 'knowledge', 'decisions'];
    return {
      summary: 'Can read and update your AgentPlanner workspace on your behalf',
      read: areas,
      write: areas,
    };
  }
  return { summary: list.join(', '), read: list, write: [] };
}

// Display-only connector type derived from the registered client name. Keeps the
// UI connector-agnostic — no per-vendor branching needed server-side.
function connectorType(clientName) {
  const n = (clientName || '').toLowerCase();
  if (n.includes('claude')) return 'Claude';
  if (n.includes('chatgpt') || n.includes('openai')) return 'ChatGPT';
  if (n.includes('cursor')) return 'Cursor';
  return 'MCP client';
}

const listApps = async (req, res, next) => {
  try {
    const conns = await dal.oauthDal.listActiveConnectionsForUser(req.user.id);
    const out = conns.map((c) => ({
      client_id: c.clientId,
      name: c.clientName || 'Unnamed app',
      type: connectorType(c.clientName),
      status: 'connected',
      connected_at: c.connectedAt,
      expires_at: c.expiresAt,
      scopes: c.scopes,
      capabilities: capabilitiesForScopes(c.scopes),
    }));
    res.json(out);
  } catch (err) {
    next(err);
  }
};

const revokeApp = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { clientId } = req.params;
    const revoked = await dal.oauthDal.revokeRefreshTokensForUser(userId, clientId);
    // Audit trail for a security-relevant action (disconnecting a delegated app).
    logger.auth(`[connections] user=${userId} disconnected oauth client=${clientId} (revoked ${revoked} token(s))`);
    // Idempotent: 204 whether or not an active connection existed.
    res.status(204).send();
  } catch (err) {
    next(err);
  }
};

module.exports = { listApps, revokeApp, capabilitiesForScopes, connectorType };
