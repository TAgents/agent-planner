/**
 * Auth middleware — auto-selects v1 (Supabase) or v2 (JWT) based on AUTH_VERSION
 */
const authVersion = process.env.AUTH_VERSION || 'v1';

if (authVersion === 'v2') {
  module.exports = require('./auth.middleware.v2');
} else {
  // Original Supabase auth middleware
  const logger = require('../utils/logger');
  const { supabase, supabaseAdmin } = require('../config/supabase');
  const crypto = require('crypto');

  const syncGitHubProfile = async (user) => {
    try {
      if (user && user.app_metadata?.provider === 'github') {
        const githubData = user.user_metadata;
        await supabaseAdmin
          .from('users')
          .update({
            github_id: githubData.provider_id,
            github_username: githubData.user_name,
            github_avatar_url: githubData.avatar_url,
            github_profile_url: `https://github.com/${githubData.user_name}`,
            updated_at: new Date().toISOString()
          })
          .eq('id', user.id);
      }
    } catch (error) {
      // Don't block auth
    }
  };

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
        // Try API token first
        if (token.length === 64 && /^[a-f0-9]{64}$/.test(token)) {
          const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
          const { data: tokenData, error: dbError } = await supabaseAdmin
            .from('api_tokens')
            .select('user_id, permissions, revoked, id, last_used')
            .eq('token_hash', tokenHash)
            .single();

          if (!dbError && tokenData && !tokenData.revoked) {
            const { data: userData } = await supabaseAdmin
              .from('users')
              .select('id, email, name')
              .eq('id', tokenData.user_id)
              .single();

            if (userData) {
              req.user = {
                id: userData.id, email: userData.email, name: userData.name,
                permissions: tokenData.permissions || [], authMethod: 'api_key',
                tokenId: tokenData.id
              };

              supabaseAdmin.from('api_tokens')
                .update({ last_used: new Date().toISOString() })
                .eq('id', tokenData.id)
                .then(() => {}).catch(() => {});

              return next();
            }
          }
        }

        // Try Supabase JWT
        try {
          const { data, error } = await supabaseAdmin.auth.getUser(token);
          if (error || !data?.user) {
            return res.status(401).json({ error: 'Invalid session token' });
          }

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
        const { data: tokenData } = await supabaseAdmin
          .from('api_tokens')
          .select('user_id, permissions, revoked, id')
          .eq('token_hash', tokenHash)
          .single();

        if (!tokenData || tokenData.revoked) {
          return res.status(401).json({ error: 'Invalid API token' });
        }

        const { data: userData } = await supabaseAdmin
          .from('users')
          .select('id, email, name')
          .eq('id', tokenData.user_id)
          .single();

        if (!userData) {
          return res.status(401).json({ error: 'User not found' });
        }

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
