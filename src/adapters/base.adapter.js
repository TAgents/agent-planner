/**
 * Base Messaging Adapter Interface
 * 
 * All adapters must implement:
 * - name: string identifier
 * - deliver(payload): send a notification/message
 * - isConfigured(userId): check if adapter is ready for this user
 */
class BaseAdapter {
  constructor(name) {
    this.name = name;
  }

  /**
   * Deliver a notification payload
   * @param {Object} payload - { event, plan, task, request, actor, message, userId }
   * @returns {Promise<{success: boolean, details?: any}>}
   */
  async deliver(payload) {
    throw new Error(`${this.name}: deliver() not implemented`);
  }

  /**
   * Check if this adapter is configured for a user
   * @param {string} userId 
   * @returns {Promise<boolean>}
   */
  async isConfigured(userId) {
    return false;
  }

  /**
   * Get adapter-specific settings for a user
   * @param {string} userId 
   * @returns {Promise<Object|null>}
   */
  async getSettings(userId) {
    return null;
  }
}

module.exports = { BaseAdapter };
