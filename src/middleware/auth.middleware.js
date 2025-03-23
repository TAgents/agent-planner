const jwt = require('jsonwebtoken');
const logger = require('../utils/logger');
require('dotenv').config();

/**
 * Middleware to validate JWT tokens
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
      await logger.middleware('auth', `Authentication failed: Invalid token format in header: ${authHeader}`);
      return res.status(401).json({ error: 'Invalid authentication format' });
    }

    const token = parts[1];
    await logger.middleware('auth', `Verifying JWT token`);

    // Verify the token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    // Attach user information to the request
    req.user = {
      id: decoded.userId,
      email: decoded.email,
      // Add any other needed user data
    };

    await logger.middleware('auth', `Authentication successful for user: ${decoded.email}`);
    next();
  } catch (error) {
    if (error instanceof jwt.JsonWebTokenError) {
      await logger.middleware('auth', `Authentication failed: Invalid token - ${error.message}`);
      return res.status(401).json({ error: 'Invalid token' });
    }
    if (error instanceof jwt.TokenExpiredError) {
      await logger.middleware('auth', `Authentication failed: Token expired`);
      return res.status(401).json({ error: 'Token expired' });
    }
    
    await logger.error(`Unexpected error in authentication middleware`, error);
    next(error);
  }
};

module.exports = { authenticate };
