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

const router = express.Router();
router.use(internalAuth);

const rid = (n = 32) => crypto.randomBytes(n).toString('hex');

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
      apAccessToken: b.ap_access_token,
      apRefreshToken: b.ap_refresh_token || null,
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

// Consume — one-time; returns the bound AP credential for token issuance.
router.post('/codes/:code/consume', async (req, res, next) => {
  try {
    const row = await dal.oauthDal.consumeCode(req.params.code);
    if (!row) return res.status(404).json({ error: 'not_found' });
    res.json({
      client_id: row.clientId,
      code_challenge: row.codeChallenge,
      redirect_uri: row.redirectUri,
      scopes: row.scopes,
      user_id: row.userId,
      ap_access_token: row.apAccessToken,
      ap_refresh_token: row.apRefreshToken,
    });
  } catch (err) { next(err); }
});

module.exports = router;
