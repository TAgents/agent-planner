/**
 * Auth Middleware v2 — JWT + API Token verification (no Supabase)
 */
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const logger = require('../utils/logger');
const dal = require('../db/dal.cjs');

const JWT_SECRET = process.env.JWT_SECRET;

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

    if (scheme === 'Bearer') {
      // Try API token first (64-char hex)
      if (token.length === 64 && /^[a-f0-9]{64}$/.test(token)) {
        const user = await verifyApiToken(token);
        if (user) {
          req.user = user;
          return next();
        }
      }

      // Try JWT
      const user = await verifyJwt(token);
      if (user) {
        req.user = user;
        return next();
      }

      return res.status(401).json({ error: 'Invalid or expired token' });
    }

    if (scheme === 'ApiKey') {
      const user = await verifyApiToken(token);
      if (user) {
        req.user = user;
        return next();
      }
      return res.status(401).json({ error: 'Invalid API token' });
    }

    return res.status(401).json({ error: 'Unsupported authentication scheme' });
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

module.exports = { authenticate, optionalAuthenticate };
