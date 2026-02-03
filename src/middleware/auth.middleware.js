const logger = require('../utils/logger');
const { supabase, supabaseAdmin } = require('../config/supabase');
const crypto = require('crypto');

/**
 * Sync GitHub profile data to users table if user signed in with GitHub OAuth
 */
const syncGitHubProfile = async (user) => {
  try {
    // Check if user signed in with GitHub
    if (user && user.app_metadata?.provider === 'github') {
      const githubData = user.user_metadata;

      // Sync GitHub profile to database
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

      await logger.middleware('auth', `Synced GitHub profile for user: ${user.email} (@${githubData.user_name})`);
    }
  } catch (error) {
    // Log error but don't block authentication
    await logger.error('Error syncing GitHub profile', error);
  }
};

/**
 * Middleware to validate both Supabase JWTs and API tokens
 */
const authenticate = async (req, res, next) => {
  try {
    const path = req.originalUrl || req.url;
    await logger.middleware('auth', `Authenticating request to: ${path}`);
    
    // Get the token from the Authorization header
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      await logger.middleware('auth', `Authentication failed: No authorization header for path: ${path}`);
      return res.status(401).json({ error: 'Authentication required' });
    }

    // Parse the authorization header
    const parts = authHeader.split(' ');
    if (parts.length !== 2) {
      await logger.middleware('auth', `Authentication failed: Invalid token format in header`);
      return res.status(401).json({ error: 'Invalid authentication format' });
    }
    
    const [scheme, token] = parts;
    
    // --- Handle Supabase JWT or API Token (Bearer scheme) ---
    if (scheme === 'Bearer') {
      // First, check if this might be an API token (64 char hex string)
      if (token.length === 64 && /^[a-f0-9]{64}$/.test(token)) {
        await logger.middleware('auth', `Token looks like an API token, trying API token verification`);
        
        // Try to verify as API token first
        const tokenHash = crypto
          .createHash('sha256')
          .update(token)
          .digest('hex');

        const { data: tokenData, error: dbError } = await supabaseAdmin
          .from('api_tokens')
          .select('user_id, permissions, revoked, id, last_used')
          .eq('token_hash', tokenHash)
          .single();

        if (!dbError && tokenData && !tokenData.revoked) {
          // Valid API token found
          const { data: userData, error: userError } = await supabaseAdmin
            .from('users')
            .select('id, email, name')
            .eq('id', tokenData.user_id)
            .single();
            
          if (!userError && userData) {
            req.user = {
              id: userData.id,
              email: userData.email,
              name: userData.name,
              permissions: tokenData.permissions || [],
              authMethod: 'api_key',
              tokenId: tokenData.id
            };
            
            await logger.middleware('auth', `API Token auth successful for user: ${userData.email}`);

            // Update last_used timestamp
            supabaseAdmin
              .from('api_tokens')
              .update({ last_used: new Date().toISOString() })
              .eq('id', tokenData.id)
              .then(({ error: updateError }) => {
                if (updateError) {
                  logger.error(`Failed to update last_used for token ${tokenData.id}`, updateError);
                }
              });

            return next();
          }
        }
      }
      
      // Not an API token or API token verification failed, try as Supabase JWT
      await logger.middleware('auth', `Verifying as Supabase JWT for path: ${path}`);
      
      try {
        // First, set the session with the token
        await logger.middleware('auth', `Setting session with token`);
        const { data: sessionData, error: sessionError } = await supabase.auth.setSession({
          access_token: token,
          refresh_token: '' // We don't have the refresh token here
        });
        
        if (sessionError) {
          await logger.middleware('auth', `Failed to set session: ${sessionError.message}`);
          // Try alternative approach - use admin client to verify the JWT
          const { data: userData, error: adminError } = await supabaseAdmin.auth.getUser(token);
          
          if (adminError || !userData.user) {
            await logger.middleware('auth', `Admin verification also failed: ${adminError?.message || 'No user'}`);
            return res.status(401).json({ error: 'Invalid session token' });
          }

          // Sync GitHub profile if applicable
          await syncGitHubProfile(userData.user);

          // Admin verification succeeded
          req.user = {
            id: userData.user.id,
            email: userData.user.email,
            name: userData.user.user_metadata?.name,
            authMethod: 'supabase_jwt'
          };

          await logger.middleware('auth', `Admin JWT auth successful for user: ${userData.user.email}`);
          return next();
        }
        
        // Session set successfully, now get the user
        const { data, error } = await supabase.auth.getUser();
        
        if (error || !data.user) {
          await logger.middleware('auth', `Failed to get user after setting session: ${error?.message || 'No user'}`);
          return res.status(401).json({ error: 'Invalid session token' });
        }

        // Sync GitHub profile if applicable
        await syncGitHubProfile(data.user);

        // Attach user information to the request
        req.user = {
          id: data.user.id,
          email: data.user.email,
          name: data.user.user_metadata?.name,
          authMethod: 'supabase_jwt'
        };

        await logger.middleware('auth', `Supabase JWT auth successful for user: ${data.user.email}`);
        return next();
      } catch (jwtError) {
        await logger.error('Error during Supabase JWT verification', jwtError);
        return res.status(401).json({ error: 'Authentication failed' });
      }
    }
    
    // --- Handle User API Token (ApiKey scheme) ---
    if (scheme === 'ApiKey') {
      await logger.middleware('auth', `Verifying User API Token for path: ${path}`);
      
      try {
        // 1. Hash the received token to match the stored hash
        const tokenHash = crypto
          .createHash('sha256')
          .update(token)
          .digest('hex');

        // 2. Query the database using supabaseAdmin (bypasses RLS for this check)
        const { data: tokenData, error: dbError } = await supabaseAdmin
          .from('api_tokens')
          .select('user_id, permissions, revoked, id, last_used')
          .eq('token_hash', tokenHash)
          .single(); // Expect only one match

        if (dbError || !tokenData) {
          await logger.middleware('auth', `User API Token not found or DB error: ${dbError?.message}`);
          return res.status(401).json({ error: 'Invalid API token' });
        }

        if (tokenData.revoked) {
          await logger.middleware('auth', `User API Token is revoked: ${tokenData.id}`);
          return res.status(401).json({ error: 'API token has been revoked' });
        }

        // 3. Get user information using the user_id from the token
        const { data: userData, error: userError } = await supabaseAdmin
          .from('users')
          .select('id, email, name')
          .eq('id', tokenData.user_id)
          .single();
          
        if (userError || !userData) {
          await logger.middleware('auth', `User not found for API Token: ${userError?.message}`);
          return res.status(401).json({ error: 'User not found for API token' });
        }

        // 4. Token is valid, attach user info to request
        req.user = {
          id: userData.id,
          email: userData.email,
          name: userData.name,
          permissions: tokenData.permissions || [], // Attach permissions if needed
          authMethod: 'api_key', // Add type
          tokenId: tokenData.id // Add token ID for logging or updates
        };
        
        await logger.middleware('auth', `User API Token auth successful for user: ${userData.email}`);

        // 5. Update last_used timestamp asynchronously
        supabaseAdmin
          .from('api_tokens')
          .update({ last_used: new Date().toISOString() })
          .eq('id', tokenData.id)
          .then(({ error: updateError }) => {
            if (updateError) {
              logger.error(`Failed to update last_used for token ${tokenData.id}`, updateError);
            }
          });

        return next();
      } catch (apiKeyError) {
        await logger.error('Error during User API Token verification', apiKeyError);
        return res.status(401).json({ error: 'Authentication failed' });
      }
    }

    // --- Invalid Authentication Scheme ---
    await logger.middleware('auth', `Authentication failed: Unsupported authentication scheme: ${scheme}`);
    return res.status(401).json({ error: 'Invalid authentication format. Use "Bearer <token>" or "ApiKey <token>".' });
  } catch (error) {
    await logger.middleware('auth', `Authentication failed: ${error.message}`);
    await logger.error(`Error in authentication middleware`, error);
    return res.status(401).json({ error: 'Authentication failed' });
  }
};

/**
 * Optional authentication middleware
 * Tries to authenticate but doesn't fail if no auth header is provided
 * Sets req.user if authentication succeeds, otherwise leaves it undefined
 */
const optionalAuthenticate = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  
  // If no auth header, just continue without authentication
  if (!authHeader) {
    return next();
  }

  // If auth header exists, try to authenticate
  // Reuse the authenticate middleware logic
  try {
    await authenticate(req, res, (err) => {
      // If authenticate calls next with error, ignore it for optional auth
      // Just continue without user
      if (err) {
        req.user = undefined;
      }
      next();
    });
  } catch (error) {
    // On any error, just continue without authentication
    req.user = undefined;
    next();
  }
};

module.exports = { authenticate, optionalAuthenticate };
