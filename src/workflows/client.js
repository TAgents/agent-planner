/**
 * Hatchet Workflow Engine Client
 * 
 * Provides a singleton HatchetClient instance for workflow orchestration.
 * Only initializes when HATCHET_CLIENT_TOKEN is set.
 * Uses HatchetClient.init() (v1 API) for auto-configuration from token.
 */
const logger = require('../utils/logger');

let hatchetClient = null;

/**
 * Get or create the Hatchet client singleton
 * @returns {import('@hatchet-dev/typescript-sdk').HatchetClient|null}
 */
function getHatchetClient() {
  if (hatchetClient) return hatchetClient;

  const token = process.env.HATCHET_CLIENT_TOKEN;
  if (!token) {
    logger.api('Hatchet: No HATCHET_CLIENT_TOKEN set, workflow engine disabled');
    return null;
  }

  try {
    const { HatchetClient } = require('@hatchet-dev/typescript-sdk');

    // HatchetClient.init() reads HATCHET_CLIENT_TOKEN from env automatically
    hatchetClient = HatchetClient.init();

    logger.api('Hatchet: Client initialized successfully');
    return hatchetClient;
  } catch (err) {
    logger.error('Hatchet: Failed to initialize client', err);
    hatchetClient = null;
    return null;
  }
}

/**
 * Check if Hatchet is available
 */
function isHatchetEnabled() {
  return !!process.env.HATCHET_CLIENT_TOKEN;
}

/**
 * Gracefully shut down the Hatchet client
 */
async function shutdownHatchet() {
  if (hatchetClient) {
    try {
      // HatchetClient doesn't have an explicit close, but workers do
      logger.api('Hatchet: Client shutdown');
      hatchetClient = null;
      initPromise = null;
    } catch (err) {
      logger.error('Hatchet: Shutdown error', err);
    }
  }
}

module.exports = { getHatchetClient, isHatchetEnabled, shutdownHatchet };
