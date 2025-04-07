const logger = require('../utils/logger');
const { supabase, supabaseAdmin } = require('../config/supabase');
const crypto = require('crypto');

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
    
    // --- Handle Supabase JWT (Bearer scheme) ---
    if (scheme === 'Bearer') {
      await logger.middleware('auth', `Verifying Supabase JWT for path: ${path}`);
      
      try {
        // Use Supabase to verify the token and get the user
        const { data, error } = await supabase.auth.getUser(token);
        
        if (error || !data.user) {
          await logger.middleware('auth', `Supabase JWT verification failed: ${error?.message || 'No user'}`);
          return res.status(401).json({ error: 'Invalid session token' });
        }

        // Attach user information to the request
        req.user = {
          id: data.user.id,
          email: data.user.email,
          name: data.user.user_metadata?.name,
          authMethod: 'supabase_jwt' // Add type for potential checks later
        };

        // Set the auth token for future Supabase requests in this context
        await supabase.auth.setSession({
          access_token: token,
          refresh_token: ''
        });

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

module.exports = { authenticate };
