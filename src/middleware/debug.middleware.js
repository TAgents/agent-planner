const logger = require('../utils/logger');

/**
 * Middleware to log detailed request information for debugging
 */
const debugRequest = async (req, res, next) => {
  try {
    const method = req.method;
    const url = req.originalUrl || req.url;
    
    await logger.api(`DEBUG - ${method} ${url}`);
    
    // Log headers
    await logger.api(`Headers: ${JSON.stringify(req.headers)}`);
    
    // Log request body if present
    if (req.body && Object.keys(req.body).length > 0) {
      // If it's an auth request, redact sensitive values
      if (url.includes('/auth/')) {
        // Create a copy of the body to redact sensitive data
        const sanitizedBody = { ...req.body };
        if (sanitizedBody.password) sanitizedBody.password = '******';
        await logger.api(`Body: ${JSON.stringify(sanitizedBody)}`);
      } else {
        await logger.api(`Body: ${JSON.stringify(req.body)}`);
      }
    }
    
    // Capture response data
    const originalSend = res.send;
    res.send = function(data) {
      // Log response body (limit size for readability)
      let logData = data;
      if (typeof data === 'string' && data.length > 500) {
        logData = data.substring(0, 500) + '... [truncated]';
      }
      
      logger.api(`Response body: ${logData}`);
      return originalSend.apply(res, arguments);
    };
    
    next();
  } catch (error) {
    await logger.error('Error in debug middleware', error);
    next();
  }
};

module.exports = { debugRequest };
