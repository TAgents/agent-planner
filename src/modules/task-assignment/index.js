/**
 * Task Assignment Module
 * 
 * This module implements functionality for task discovery, assignment, and execution tracking
 * using an agent-agnostic approach that supports both AI agents and human operators.
 */

const routes = require('./routes');

/**
 * Initializes the task assignment module
 * @param {object} app - Express application instance
 * @param {object} config - Module configuration
 */
function init(app, config = {}) {
  // Register routes
  routes.registerRoutes(app);
  
  console.log('Task Assignment module initialized');
}

module.exports = {
  init
};
