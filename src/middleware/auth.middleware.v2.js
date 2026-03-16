/**
 * Auth Middleware v2 — JWT + API Token verification (no Supabase)
 */
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const logger = require('../utils/logger');
const dal = require('../db/dal.cjs');

const JWT_SECRET = process.env.JWT_SECRET;

/**
 * Enrich req.user with organizationId by looking up org memberships.
 * Allows multi-org users to switch via X-Organization-Id header.
 */
async function enrichWithOrg(user, req) {
  try {
    const orgs = await dal.organizationsDal.listForUser(user.id);
    if (orgs.length > 0) {
      user.organizationId = orgs[0].id; // default to first org
    }
    user.organizations = orgs.map(o => ({ id: o.id, name: o.name, role: o.role }));

    // API tokens are locked to their org — don't allow header override
    if (user.authMethod === 'api_key' && user.tokenOrganizationId) {
      user.organizationId = user.tokenOrganizationId;
      return;
    }

    // Allow JWT users to switch via header
    const headerOrgId = req.headers['x-organization-id'];
    if (headerOrgId && orgs.some(o => o.id === headerOrgId)) {
      user.organizationId = headerOrgId;
    }
  } catch { /* non-fatal — org enrichment should not block auth */ }
}

/**
 * Verify a JWT access token
 */
async function verifyJwt(token) {
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    if (payload.type === 'refresh') return null; // Don't accept refresh tokens as access

    return {
      id: payload.sub,
      email: payload.email,
      name: payload.name,
      authMethod: 'jwt',
    };
  } catch {
    return null;
  }
}

/**
 * Verify an API token (64-char hex or any string, SHA-256 hashed)
 */
async function verifyApiToken(token) {
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const tokenData = await dal.tokensDal.findByHash(tokenHash);
  if (!tokenData) return null;

  const user = await dal.usersDal.findById(tokenData.userId);
  if (!user) return null;

  // Update last_used async (fire and forget)
  dal.tokensDal.updateLastUsed(tokenData.id).catch(() => {});

  return {
    id: user.id,
    email: user.email,
    name: user.name,
    permissions: tokenData.permissions || [],
    authMethod: 'api_key',
    tokenId: tokenData.id,
    tokenOrganizationId: tokenData.organizationId || null,
  };
}

/**
 * Main auth middleware
 */
const authenticate = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const parts = authHeader.split(' ');
    if (parts.length !== 2) {
      return res.status(401).json({ error: 'Invalid authentication format' });
    }

    const [scheme, token] = parts;
    let user = null;

    if (scheme === 'Bearer') {
      // Try API token first (64-char hex)
      if (token.length === 64 && /^[a-f0-9]{64}$/.test(token)) {
        user = await verifyApiToken(token);
      }

      // Try JWT if API token didn't match
      if (!user) {
        user = await verifyJwt(token);
      }

      if (!user) {
        return res.status(401).json({ error: 'Invalid or expired token' });
      }
    } else if (scheme === 'ApiKey') {
      user = await verifyApiToken(token);
      if (!user) {
        return res.status(401).json({ error: 'Invalid API token' });
      }
    } else {
      return res.status(401).json({ error: 'Unsupported authentication scheme' });
    }

    // Enrich with organization info before proceeding
    req.user = user;
    await enrichWithOrg(user, req);
    return next();
  } catch (error) {
    await logger.error('Auth middleware error', error);
    return res.status(401).json({ error: 'Authentication failed' });
  }
};

/**
 * Optional auth — sets req.user if token present, otherwise continues
 */
const optionalAuthenticate = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return next();

  try {
    await authenticate(req, res, (err) => {
      if (err) req.user = undefined;
      next();
    });
  } catch {
    req.user = undefined;
    next();
  }
};

/**
 * Require system admin — must be used after authenticate
 */
const requireAdmin = async (req, res, next) => {
  try {
    if (!req.user || !req.user.id) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    const user = await dal.usersDal.findById(req.user.id);
    if (!user || !user.isAdmin) {
      return res.status(403).json({ error: 'Admin access required' });
    }
    next();
  } catch (error) {
    await logger.error('Admin check error', error);
    return res.status(500).json({ error: 'Authorization check failed' });
  }
};

module.exports = { authenticate, optionalAuthenticate, requireAdmin };
