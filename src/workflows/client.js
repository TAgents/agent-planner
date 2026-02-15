/**
 * Hatchet Workflow Engine Client
 * 
 * Uses Hatchet.init() (v0 API) which auto-reads HATCHET_CLIENT_TOKEN from env.
 */
const logger = require('../utils/logger');

let hatchetInstance = null;

/**
 * Get or create the Hatchet singleton
 * @returns {import('@hatchet-dev/typescript-sdk').Hatchet|null}
 */
function getHatchetClient() {
  if (hatchetInstance) return hatchetInstance;

  const token = process.env.HATCHET_CLIENT_TOKEN;
  if (!token) {
    logger.api('Hatchet: No HATCHET_CLIENT_TOKEN set, workflow engine disabled');
    return null;
  }

  try {
    const { Hatchet } = require('@hatchet-dev/typescript-sdk');
    hatchetInstance = Hatchet.init();
    logger.api('Hatchet: Client initialized successfully');
    return hatchetInstance;
  } catch (err) {
    logger.error('Hatchet: Failed to initialize client', err);
    hatchetInstance = null;
    return null;
  }
}

function isHatchetEnabled() {
  return !!process.env.HATCHET_CLIENT_TOKEN;
}

async function shutdownHatchet() {
  if (hatchetInstance) {
    logger.api('Hatchet: Client shutdown');
    hatchetInstance = null;
  }
}

module.exports = { getHatchetClient, isHatchetEnabled, shutdownHatchet };
