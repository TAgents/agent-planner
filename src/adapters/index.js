/**
 * Adapter Registry — manages notification delivery to all configured adapters
 */
const { WebhookAdapter } = require('./webhook.adapter');
const { SlackAdapter } = require('./slack.adapter');
const { ConsoleAdapter } = require('./console.adapter');
const logger = require('../utils/logger');

const adapters = [
  new WebhookAdapter(),
  new SlackAdapter(),
  new ConsoleAdapter(),
];

/**
 * Fan-out notification to all configured adapters
 * @param {Object} payload - notification payload
 * @returns {Promise<Object[]>} - results from each adapter
 */
async function deliverToAll(payload) {
  const results = [];

  for (const adapter of adapters) {
    try {
      const configured = await adapter.isConfigured(payload.userId);
      if (!configured) continue;

      const result = await adapter.deliver(payload);
      results.push({ adapter: adapter.name, ...result });
    } catch (error) {
      results.push({ adapter: adapter.name, success: false, error: error.message });
    }
  }

  return results;
}

/**
 * Get registered adapter names
 */
function getAdapterNames() {
  return adapters.map(a => a.name);
}

/**
 * Check which adapters are configured for a user
 */
async function getConfiguredAdapters(userId) {
  const configured = [];
  for (const adapter of adapters) {
    if (await adapter.isConfigured(userId)) {
      configured.push(adapter.name);
    }
  }
  return configured;
}

module.exports = { deliverToAll, getAdapterNames, getConfiguredAdapters, adapters };
