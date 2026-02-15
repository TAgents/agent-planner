/**
 * Workflow Dispatcher
 * 
 * Simple interface for controllers to run Hatchet tasks.
 * Falls back gracefully when Hatchet is not available.
 */
const logger = require('../utils/logger');
const { getHatchetClient, isHatchetEnabled } = require('./client');

/**
 * Push an event to Hatchet (fire-and-forget)
 * @param {string} eventName - Event key
 * @param {object} payload - Event data
 */
async function pushEvent(eventName, payload) {
  if (!isHatchetEnabled()) return null;

  try {
    const hatchet = getHatchetClient();
    if (!hatchet) return null;

    await hatchet.event.push(eventName, payload);
    logger.api(`Hatchet: Event pushed: ${eventName}`);
    return true;
  } catch (err) {
    logger.error(`Hatchet: Failed to push event ${eventName}`, err);
    return null;
  }
}

/**
 * Run a task and wait for result
 * @param {string} taskName - Task name (e.g., 'create-plan')
 * @param {object} input - Task input
 * @param {number} [timeoutMs=30000] - Timeout in ms
 */
async function runTask(taskName, input, timeoutMs = 30000) {
  if (!isHatchetEnabled()) return null;

  try {
    const hatchet = getHatchetClient();
    if (!hatchet) return null;

    const result = await hatchet.run(taskName, input, {
      additionalMetadata: { source: 'api-controller' },
    });

    logger.api(`Hatchet: Task ${taskName} completed`);
    return result;
  } catch (err) {
    logger.error(`Hatchet: Task ${taskName} failed`, err);
    throw err;
  }
}

/**
 * Run a task without waiting (fire-and-forget)
 */
async function runTaskNoWait(taskName, input) {
  if (!isHatchetEnabled()) return null;

  try {
    const hatchet = getHatchetClient();
    if (!hatchet) return null;

    const ref = await hatchet.runNoWait(taskName, input, {
      additionalMetadata: { source: 'api-controller' },
    });

    logger.api(`Hatchet: Task ${taskName} dispatched`);
    return ref;
  } catch (err) {
    logger.error(`Hatchet: Failed to dispatch task ${taskName}`, err);
    return null;
  }
}

module.exports = { pushEvent, runTask, runTaskNoWait };
