/**
 * WebSocket Broadcast Utility Module
 *
 * Provides a centralized, easy-to-use API for controllers to broadcast
 * WebSocket events. Handles error management, logging, and integration
 * with the CollaborationServer instance.
 *
 * Usage in controllers:
 * ```javascript
 * const { broadcastPlanUpdate, broadcastNodeUpdate } = require('../websocket/broadcast');
 * const { createNodeCreatedMessage } = require('../websocket/message-schema');
 *
 * // In your controller, after creating a node:
 * const message = createNodeCreatedMessage(newNode, userId, userName);
 * broadcastPlanUpdate(planId, message);
 * ```
 */

const logger = require('../utils/logger');

// ============================================================================
// COLLABORATION SERVER INSTANCE MANAGEMENT
// ============================================================================

/**
 * Stores the WebSocket collaboration server instance.
 * This is set during server initialization in src/index.js
 * @type {CollaborationServer|null}
 */
let collaborationServer = null;

/**
 * Sets the collaboration server instance.
 * Called once during server startup.
 *
 * @param {CollaborationServer} server - The initialized CollaborationServer instance
 */
function setCollaborationServer(server) {
  collaborationServer = server;
  logger.api('Broadcast utility: CollaborationServer instance registered');
}

/**
 * Gets the current collaboration server instance.
 *
 * @returns {CollaborationServer|null} The collaboration server instance or null if not initialized
 */
function getCollaborationServer() {
  return collaborationServer;
}

/**
 * Checks if the collaboration server is available.
 *
 * @returns {boolean} True if server is initialized and ready
 */
function isServerAvailable() {
  return collaborationServer !== null;
}

// ============================================================================
// BROADCAST HELPER FUNCTIONS
// ============================================================================

/**
 * Internal helper: Safely broadcasts a message and handles errors.
 * Logs warnings if server is unavailable and errors if broadcast fails.
 *
 * @param {Function} broadcastFn - The broadcast function to execute
 * @param {string} context - Description of broadcast context for logging
 * @returns {boolean} True if broadcast succeeded, false otherwise
 * @private
 */
async function safeBroadcast(broadcastFn, context) {
  // Check if server is available
  if (!collaborationServer) {
    await logger.api(`Broadcast skipped (server not initialized): ${context}`);
    return false;
  }

  try {
    // Execute the broadcast function
    await logger.api(`Broadcasting: ${context}`);
    await broadcastFn();
    await logger.api(`Broadcast succeeded: ${context}`);
    return true;
  } catch (error) {
    // Log error but don't throw - WebSocket failures shouldn't break API calls
    await logger.error(`Broadcast failed (${context}):`, error);
    return false;
  }
}

// ============================================================================
// PUBLIC BROADCAST API
// ============================================================================

/**
 * Broadcasts a message to all users viewing a specific plan.
 *
 * @param {string} planId - Plan UUID
 * @param {Object} message - WebSocket message (typically created with message-schema factories)
 * @param {string|null} [excludeUserId=null] - Optional user ID to exclude from broadcast
 * @returns {Promise<boolean>} True if broadcast succeeded, false otherwise
 *
 * @example
 * const message = createPlanUpdatedMessage(plan, userId, userName);
 * await broadcastPlanUpdate(planId, message);
 */
async function broadcastPlanUpdate(planId, message, excludeUserId = null) {
  return safeBroadcast(
    async () => {
      await collaborationServer.broadcastToPlan(planId, message, excludeUserId);
    },
    `plan.${planId} [type: ${message.type}]`
  );
}

/**
 * Broadcasts a message to all users viewing a specific node.
 *
 * @param {string} nodeId - Node UUID
 * @param {string} planId - Parent plan UUID (required for routing)
 * @param {Object} message - WebSocket message (typically created with message-schema factories)
 * @param {string|null} [excludeUserId=null] - Optional user ID to exclude from broadcast
 * @returns {Promise<boolean>} True if broadcast succeeded, false otherwise
 *
 * @example
 * const message = createNodeStatusChangedMessage(nodeId, planId, oldStatus, newStatus, userId);
 * await broadcastNodeUpdate(nodeId, planId, message);
 */
async function broadcastNodeUpdate(nodeId, planId, message, excludeUserId = null) {
  return safeBroadcast(
    async () => {
      await collaborationServer.broadcastToNode(nodeId, planId, message, excludeUserId);
    },
    `node.${nodeId} in plan.${planId} [type: ${message.type}]`
  );
}

/**
 * Broadcasts a custom message to a plan.
 * Use this for one-off messages or when using manually constructed message objects.
 *
 * @param {string} planId - Plan UUID
 * @param {string} eventType - Event type identifier (from EVENT_TYPES)
 * @param {Object} payload - Event-specific payload data
 * @param {string|null} [excludeUserId=null] - Optional user ID to exclude from broadcast
 * @returns {Promise<boolean>} True if broadcast succeeded, false otherwise
 *
 * @example
 * await broadcastCustom(planId, 'plan.updated', { id: planId, title: 'New Title' });
 */
async function broadcastCustom(planId, eventType, payload, excludeUserId = null) {
  const message = {
    type: eventType,
    payload,
    metadata: {
      timestamp: new Date().toISOString(),
      planId
    }
  };

  return broadcastPlanUpdate(planId, message, excludeUserId);
}

/**
 * Broadcasts a message to all connected users.
 * Use this for global events like plan creation that should be visible on the plans list.
 *
 * @param {Object} message - WebSocket message (typically created with message-schema factories)
 * @param {string|null} [excludeUserId=null] - Optional user ID to exclude from broadcast
 * @returns {Promise<boolean>} True if broadcast succeeded, false otherwise
 *
 * @example
 * const message = createPlanCreatedMessage(newPlan, userId, userName);
 * await broadcastToAll(message);
 */
async function broadcastToAll(message, excludeUserId = null) {
  return safeBroadcast(
    async () => {
      await collaborationServer.broadcastToAll(message, excludeUserId);
    },
    `broadcast.all [type: ${message.type}]`
  );
}

/**
 * Sends a message to a specific user (if they're connected).
 * Useful for targeted notifications or error messages.
 *
 * @param {string} userId - Target user UUID
 * @param {Object} message - WebSocket message to send
 * @returns {Promise<boolean>} True if message was sent, false if user not connected
 *
 * @example
 * await sendToUser(userId, {
 *   type: 'notification',
 *   payload: { message: 'Task assigned to you' }
 * });
 */
async function sendToUser(userId, message) {
  if (!collaborationServer) {
    await logger.api(`Send to user skipped (server not initialized): user.${userId}`);
    return false;
  }

  try {
    // Access the connections map from collaboration server
    const ws = collaborationServer.connections.get(userId);

    if (!ws || ws.readyState !== 1) { // 1 = WebSocket.OPEN
      // User not connected - this is not an error
      return false;
    }

    ws.send(JSON.stringify(message));
    return true;
  } catch (error) {
    await logger.error(`Send to user failed (user.${userId}):`, error);
    return false;
  }
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Gets the list of active users currently viewing a plan.
 *
 * @param {string} planId - Plan UUID
 * @returns {Promise<string[]>} Array of user IDs (empty if server unavailable)
 */
async function getActivePlanUsers(planId) {
  if (!collaborationServer) {
    return [];
  }

  try {
    return await collaborationServer.getActivePlanUsers(planId);
  } catch (error) {
    await logger.error(`Failed to get active plan users (plan.${planId}):`, error);
    return [];
  }
}

/**
 * Gets the list of active users currently viewing a node.
 *
 * @param {string} nodeId - Node UUID
 * @returns {Promise<string[]>} Array of user IDs (empty if server unavailable)
 */
async function getActiveNodeUsers(nodeId) {
  if (!collaborationServer) {
    return [];
  }

  try {
    return await collaborationServer.getActiveNodeUsers(nodeId);
  } catch (error) {
    await logger.error(`Failed to get active node users (node.${nodeId}):`, error);
    return [];
  }
}

/**
 * Gets the list of users currently typing in a node.
 *
 * @param {string} nodeId - Node UUID
 * @returns {Promise<string[]>} Array of user IDs (empty if server unavailable)
 */
async function getTypingUsers(nodeId) {
  if (!collaborationServer) {
    return [];
  }

  try {
    return await collaborationServer.getTypingUsers(nodeId);
  } catch (error) {
    await logger.error(`Failed to get typing users (node.${nodeId}):`, error);
    return [];
  }
}

// ============================================================================
// EXPORTS
// ============================================================================

module.exports = {
  // Server instance management
  setCollaborationServer,
  getCollaborationServer,
  isServerAvailable,

  // Core broadcast functions
  broadcastPlanUpdate,
  broadcastNodeUpdate,
  broadcastCustom,
  broadcastToAll,
  sendToUser,

  // Utility functions
  getActivePlanUsers,
  getActiveNodeUsers,
  getTypingUsers
};
