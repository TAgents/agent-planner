const jwt = require('jsonwebtoken');
require('dotenv').config();

/**
 * Middleware to validate JWT tokens
 */
const authenticate = (req, res, next) => {
  try {
    // Get the token from the Authorization header
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    // Check if the header format is valid
    const parts = authHeader.split(' ');
    if (parts.length !== 2 || parts[0] !== 'Bearer') {
      return res.status(401).json({ error: 'Invalid authentication format' });
    }

    const token = parts[1];

    // Verify the token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    // Attach user information to the request
    req.user = {
      id: decoded.userId,
      email: decoded.email,
      // Add any other needed user data
    };

    next();
  } catch (error) {
    if (error instanceof jwt.JsonWebTokenError) {
      return res.status(401).json({ error: 'Invalid token' });
    }
    if (error instanceof jwt.TokenExpiredError) {
      return res.status(401).json({ error: 'Token expired' });
    }
    next(error);
  }
};

module.exports = { authenticate };
