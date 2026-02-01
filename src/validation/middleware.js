/**
 * Validation Middleware
 * 
 * Provides Express middleware for validating request data using Zod schemas.
 * Validates body, params, and query separately for clear error messages.
 */

const { ZodError } = require('zod');
const logger = require('../utils/logger');

/**
 * Format Zod errors into a user-friendly message
 * @param {ZodError} error - Zod validation error
 * @returns {Object} Formatted error with message and details
 */
const formatZodError = (error) => {
  const issues = error.issues.map((issue) => {
    const path = issue.path.join('.');
    return {
      field: path || 'root',
      message: issue.message,
      code: issue.code
    };
  });

  // Create a summary message
  const summaryMessages = issues.map((i) => 
    i.field === 'root' ? i.message : `${i.field}: ${i.message}`
  );

  return {
    error: 'Validation failed',
    message: summaryMessages.join('; '),
    details: issues
  };
};

/**
 * Creates a validation middleware for request body
 * @param {import('zod').ZodSchema} schema - Zod schema to validate against
 * @returns {Function} Express middleware function
 */
const validateBody = (schema) => async (req, res, next) => {
  try {
    const validated = await schema.parseAsync(req.body);
    req.body = validated; // Replace with validated/transformed data
    next();
  } catch (error) {
    if (error instanceof ZodError) {
      const formatted = formatZodError(error);
      logger.api('Validation failed for request body', { 
        path: req.path, 
        errors: formatted.details 
      });
      return res.status(400).json(formatted);
    }
    next(error);
  }
};

/**
 * Creates a validation middleware for URL parameters
 * @param {import('zod').ZodSchema} schema - Zod schema to validate against
 * @returns {Function} Express middleware function
 */
const validateParams = (schema) => async (req, res, next) => {
  try {
    const validated = await schema.parseAsync(req.params);
    req.params = validated;
    next();
  } catch (error) {
    if (error instanceof ZodError) {
      const formatted = formatZodError(error);
      logger.api('Validation failed for URL parameters', { 
        path: req.path, 
        errors: formatted.details 
      });
      return res.status(400).json(formatted);
    }
    next(error);
  }
};

/**
 * Creates a validation middleware for query parameters
 * @param {import('zod').ZodSchema} schema - Zod schema to validate against
 * @returns {Function} Express middleware function
 */
const validateQuery = (schema) => async (req, res, next) => {
  try {
    const validated = await schema.parseAsync(req.query);
    req.query = validated;
    next();
  } catch (error) {
    if (error instanceof ZodError) {
      const formatted = formatZodError(error);
      logger.api('Validation failed for query parameters', { 
        path: req.path, 
        errors: formatted.details 
      });
      return res.status(400).json(formatted);
    }
    next(error);
  }
};

/**
 * Combined validation middleware for body, params, and query
 * @param {Object} schemas - Object containing body, params, and query schemas
 * @param {import('zod').ZodSchema} [schemas.body] - Schema for request body
 * @param {import('zod').ZodSchema} [schemas.params] - Schema for URL parameters
 * @param {import('zod').ZodSchema} [schemas.query] - Schema for query parameters
 * @returns {Function[]} Array of Express middleware functions
 */
const validate = ({ body, params, query }) => {
  const middlewares = [];
  
  if (params) {
    middlewares.push(validateParams(params));
  }
  if (query) {
    middlewares.push(validateQuery(query));
  }
  if (body) {
    middlewares.push(validateBody(body));
  }
  
  return middlewares;
};

module.exports = {
  validate,
  validateBody,
  validateParams,
  validateQuery,
  formatZodError
};
