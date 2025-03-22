/**
 * Helper utility functions for the application
 */

/**
 * Format error responses consistently
 * @param {string} message - Error message
 * @param {number} statusCode - HTTP status code
 * @returns {Object} Error object
 */
const formatError = (message, statusCode = 500) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

/**
 * Validate if an object has required properties
 * @param {Object} obj - Object to check
 * @param {string[]} required - Array of required property names
 * @returns {boolean} Whether all required properties exist
 */
const validateRequired = (obj, required) => {
  return required.every(prop => 
    obj.hasOwnProperty(prop) && 
    obj[prop] !== undefined && 
    obj[prop] !== null && 
    obj[prop] !== ''
  );
};

/**
 * Sanitize an object by removing sensitive or unnecessary fields
 * @param {Object} obj - Object to sanitize
 * @param {string[]} fieldsToRemove - Array of field names to remove
 * @returns {Object} Sanitized object
 */
const sanitizeObject = (obj, fieldsToRemove = []) => {
  const sanitized = { ...obj };
  fieldsToRemove.forEach(field => {
    delete sanitized[field];
  });
  return sanitized;
};

/**
 * Pagination helper for database queries
 * @param {number} page - Page number (1-based)
 * @param {number} limit - Items per page
 * @returns {Object} Object with from and to values for Supabase
 */
const getPaginationRange = (page = 1, limit = 10) => {
  const from = (page - 1) * limit;
  const to = from + limit - 1;
  return { from, to };
};

module.exports = {
  formatError,
  validateRequired,
  sanitizeObject,
  getPaginationRange
};
