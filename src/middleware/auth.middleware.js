const logger = require('../utils/logger');
const { supabase } = require('../config/supabase');

/**
 * Middleware to validate Supabase auth tokens
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

    // Check if the header format is valid
    const parts = authHeader.split(' ');
    if (parts.length !== 2 || parts[0] !== 'Bearer') {
      await logger.middleware('auth', `Authentication failed: Invalid token format in header`);
      return res.status(401).json({ error: 'Invalid authentication format' });
    }

    const token = parts[1];
    await logger.middleware('auth', `Verifying Supabase auth token`);

    // Use Supabase to verify the token and get the user
    const { data, error } = await supabase.auth.getUser(token);
    
    if (error || !data.user) {
      await logger.middleware('auth', `Authentication failed: Invalid token - ${error?.message}`);
      return res.status(401).json({ error: 'Invalid token' });
    }

    // Attach user information to the request
    req.user = {
      id: data.user.id,
      email: data.user.email,
      name: data.user.user_metadata?.name
    };

    // Set the auth token for future Supabase requests in this context
    await supabase.auth.setSession({
      access_token: token,
      refresh_token: ''
    });

    await logger.middleware('auth', `Authentication successful for user: ${data.user.email}`);
    next();
  } catch (error) {
    await logger.middleware('auth', `Authentication failed: ${error.message}`);
    await logger.error(`Error in authentication middleware`, error);
    return res.status(401).json({ error: 'Authentication failed' });
  }
};

module.exports = { authenticate };
