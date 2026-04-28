/**
 * Validation Module
 * 
 * Exports all validation schemas and middleware for use throughout the application.
 */

const { validate, validateBody, validateParams, validateQuery, formatZodError } = require('./middleware');
const planSchemas = require('./schemas/plan.schemas');
const nodeSchemas = require('./schemas/node.schemas');
const commonSchemas = require('./schemas/common');
const decisionSchemas = require('./schemas/decision.schemas');
const goalSchemas = require('./schemas/goal.schemas');

module.exports = {
  // Middleware
  validate,
  validateBody,
  validateParams,
  validateQuery,
  formatZodError,

  // Schema collections
  schemas: {
    plan: planSchemas,
    node: nodeSchemas,
    common: commonSchemas,
    decision: decisionSchemas,
    goal: goalSchemas
  },

  // Direct schema exports for convenience
  ...planSchemas,
  ...nodeSchemas,
  ...commonSchemas,
  ...decisionSchemas,
  ...goalSchemas
};
