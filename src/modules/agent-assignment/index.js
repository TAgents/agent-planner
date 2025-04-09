/**
 * Agent Assignment Module
 * 
 * This module implements functionality to assign AI agents to plans and tasks, 
 * manage agent configurations, and coordinate execution with the MCP server.
 */

const routes = require('./routes');

/**
 * Initializes the agent assignment module
 * @param {object} app - Express application instance
 * @param {object} config - Module configuration
 */
function init(app, config = {}) {
  // Register routes
  routes.registerRoutes(app);
  
  console.log('Agent Assignment module initialized');
}

module.exports = {
  init
};
