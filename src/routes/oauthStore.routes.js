/**
 * Internal OAuth store endpoints (server-to-server only, secret-guarded).
 *
 * The hosted MCP server is the OAuth authorization server but has no database;
 * it persists DCR clients and one-time PKCE authorization codes here. There is
 * deliberately no token storage — the OAuth access_token is the user's AP JWT.
 */
const express = require('express');
const crypto = require('crypto');
const dal = require('../db/dal.cjs');
const { internalAuth } = require('../middleware/internalAuth.middleware');
const { generateAccessToken } = require('../controllers/auth.controller.v2');

const router = express.Router();
router.use(internalAuth);

const rid = (n = 32) => crypto.randomBytes(n).toString('hex');
const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');

const ACCESS_TTL_SEC = 60 * 60;                  // 1h access JWT
const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30d opaque refresh

// The MCP resource these tokens authorize. Bound into the access token's `aud`
// so connectors that enforce RFC 8707 resource indicators (e.g. ChatGPT's Apps
// SDK) see a token minted for the correct server. Single hosted MCP, so this is
// a constant rather than threaded per-request from the OAuth `resource` param.
const OAUTH_RESOURCE = process.env.OAUTH_RESOURCE || 'https://agentplanner.io/mcp';

// Mint a token set for a user: a short-lived AP access JWT (validated
// statelessly on /mcp) + an opaque, hashed, client-bound refresh token. No AP
// credential is stored at rest — the access JWT is minted from user_id here.
async function issueTokenSet(userId, clientId, scopes) {
  const user = await dal.usersDal.findById(userId);
  if (!user) return null;
  const refreshToken = `apop_r_${rid(32)}`;
  await dal.oauthDal.createRefreshToken({
    tokenHash: sha256(refreshToken),
    clientId,
    userId,
    scopes: scopes || [],
    expiresAt: new Date(Date.now() + REFRESH_TTL_MS),
  });
  return {
    access_token: generateAccessToken(user, '1h', { audience: OAUTH_RESOURCE }),
    token_type: 'Bearer',
    expires_in: ACCESS_TTL_SEC,
    refresh_token: refreshToken,
    scope: (scopes || []).join(' ') || undefined,
  };
}

// ── Dynamic Client Registration ────────────────────────────────────────────
router.post('/clients', async (req, res, next) => {
  try {
    const c = req.body || {};
    const isPublic = c.token_endpoint_auth_method === 'none';
    const client = await dal.oauthDal.registerClient({
      clientId: rid(16),
      clientSecret: isPublic ? null : rid(32),
      clientName: c.client_name || null,
      redirectUris: c.redirect_uris || [],
      grantTypes: c.grant_types || [],
      responseTypes: c.response_types || [],
      scope: c.scope || null,
      tokenEndpointAuthMethod: c.token_endpoint_auth_method || 'client_secret_basic',
      metadata: c.metadata || {},
    });
    res.status(201).json(client);
  } catch (err) { next(err); }
});

router.get('/clients/:clientId', async (req, res, next) => {
  try {
    const client = await dal.oauthDal.getClient(req.params.clientId);
    if (!client) return res.status(404).json({ error: 'not_found' });
    res.json(client);
  } catch (err) { next(err); }
});

// ── Authorization codes ─────────────────────────────────────────────────────
router.post('/codes', async (req, res, next) => {
  try {
    const b = req.body || {};
    const ttlMs = Number(b.ttl_ms) || 5 * 60 * 1000;
    const row = await dal.oauthDal.createCode({
      code: rid(32),
      clientId: b.client_id,
      codeChallenge: b.code_challenge || null,
      codeChallengeMethod: b.code_challenge_method || 'S256',
      redirectUri: b.redirect_uri,
      scopes: b.scopes || [],
      userId: b.user_id || null,
      expiresAt: new Date(Date.now() + ttlMs),
    });
    res.status(201).json({ code: row.code });
  } catch (err) { next(err); }
});

// Peek (PKCE challenge lookup) — does not consume. No AP tokens returned.
router.get('/codes/:code', async (req, res, next) => {
  try {
    const row = await dal.oauthDal.getCode(req.params.code);
    if (!row) return res.status(404).json({ error: 'not_found' });
    res.json({ client_id: row.clientId, code_challenge: row.codeChallenge, redirect_uri: row.redirectUri });
  } catch (err) { next(err); }
});

// Consume — one-time. Issues the OAuth token set (access JWT + opaque refresh).
router.post('/codes/:code/consume', async (req, res, next) => {
  try {
    const { client_id, redirect_uri } = req.body || {};
    const row = await dal.oauthDal.consumeCode(req.params.code);
    if (!row) return res.status(404).json({ error: 'not_found' });
    // Defense-in-depth: the code is bound to the client + redirect it was issued for.
    if (client_id && row.clientId !== client_id) return res.status(400).json({ error: 'invalid_grant' });
    if (redirect_uri && row.redirectUri !== redirect_uri) return res.status(400).json({ error: 'invalid_grant' });
    if (!row.userId) return res.status(400).json({ error: 'code_no_user' });
    const tokens = await issueTokenSet(row.userId, row.clientId, row.scopes);
    if (!tokens) return res.status(404).json({ error: 'user_not_found' });
    res.json(tokens);
  } catch (err) { next(err); }
});

// Refresh — validate + rotate the refresh token (bound to client_id), issue a
// fresh token set. Single-use: the old refresh token is revoked.
router.post('/refresh', async (req, res, next) => {
  try {
    const { refresh_token, client_id } = req.body || {};
    if (!refresh_token) return res.status(400).json({ error: 'refresh_token required' });
    const rec = await dal.oauthDal.findValidRefreshToken(sha256(refresh_token));
    if (!rec) return res.status(400).json({ error: 'invalid_grant' });
    if (client_id && rec.clientId !== client_id) return res.status(400).json({ error: 'invalid_grant' });
    await dal.oauthDal.revokeRefreshToken(rec.tokenHash); // rotate
    const tokens = await issueTokenSet(rec.userId, rec.clientId, rec.scopes);
    if (!tokens) return res.status(400).json({ error: 'invalid_grant' });
    res.json(tokens);
  } catch (err) { next(err); }
});

// Revoke — RFC 7009. Revokes the refresh token (access JWTs are short-lived and
// self-expire). Always 200, whether or not the token existed.
router.post('/revoke', async (req, res, next) => {
  try {
    const { token } = req.body || {};
    if (token) await dal.oauthDal.revokeRefreshToken(sha256(token));
    res.status(200).json({ revoked: true });
  } catch (err) { next(err); }
});

module.exports = router;
