/**
 * Auth middleware — auto-selects v1 (Supabase) or v2 (JWT) based on AUTH_VERSION
 */
const authVersion = process.env.AUTH_VERSION || 'v1';

if (authVersion === 'v2') {
  module.exports = require('./auth.middleware.v2');
} else {
  // Supabase auth middleware - uses auth service for token verification, DAL for DB queries
  const logger = require('../utils/logger');
  const { adminAuth } = require('../services/supabase-auth');
  const { tokensDal, usersDal } = require('../db/dal.cjs');
  const crypto = require('crypto');

  const syncGitHubProfile = async (user) => {
    try {
      if (user && user.app_metadata?.provider === 'github') {
        const githubData = user.user_metadata;
        await usersDal.update(user.id, {
          githubId: githubData.provider_id,
          githubUsername: githubData.user_name,
          githubAvatarUrl: githubData.avatar_url,
          githubProfileUrl: `https://github.com/${githubData.user_name}`,
        });
      }
    } catch (error) {
      // Don't block auth
    }
  };

  const authenticate = async (req, res, next) => {
    try {
      const authHeader = req.headers.authorization;
      if (!authHeader) return res.status(401).json({ error: 'Authentication required' });

      const parts = authHeader.split(' ');
      if (parts.length !== 2) return res.status(401).json({ error: 'Invalid authentication format' });

      const [scheme, token] = parts;

      if (scheme === 'Bearer') {
        // Try API token first
        if (token.length === 64 && /^[a-f0-9]{64}$/.test(token)) {
          const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
          const tokenData = await tokensDal.findByHash(tokenHash);

          if (tokenData && !tokenData.revoked) {
            const userData = await usersDal.findById(tokenData.userId);
            if (userData) {
              req.user = {
                id: userData.id, email: userData.email, name: userData.name,
                permissions: tokenData.permissions || [], authMethod: 'api_key',
                tokenId: tokenData.id
              };
              // Update last used in background
              tokensDal.updateLastUsed(tokenData.id).catch(() => {});
              return next();
            }
          }
        }

        // Try Supabase JWT
        try {
          const { data, error } = await adminAuth.getUser(token);
          if (error || !data?.user) return res.status(401).json({ error: 'Invalid session token' });

          await syncGitHubProfile(data.user);

          req.user = {
            id: data.user.id, email: data.user.email,
            name: data.user.user_metadata?.name, authMethod: 'supabase_jwt'
          };
          return next();
        } catch {
          return res.status(401).json({ error: 'Authentication failed' });
        }
      }

      if (scheme === 'ApiKey') {
        const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
        const tokenData = await tokensDal.findByHash(tokenHash);

        if (!tokenData || tokenData.revoked) return res.status(401).json({ error: 'Invalid API token' });

        const userData = await usersDal.findById(tokenData.userId);
        if (!userData) return res.status(401).json({ error: 'User not found' });

        req.user = {
          id: userData.id, email: userData.email, name: userData.name,
          permissions: tokenData.permissions || [], authMethod: 'api_key',
          tokenId: tokenData.id
        };
        return next();
      }

      return res.status(401).json({ error: 'Unsupported authentication scheme' });
    } catch (error) {
      return res.status(401).json({ error: 'Authentication failed' });
    }
  };

  const optionalAuthenticate = async (req, res, next) => {
    if (!req.headers.authorization) return next();
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
}
