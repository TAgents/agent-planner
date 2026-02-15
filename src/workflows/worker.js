/**
 * Hatchet Worker
 * 
 * Registers all workflows via worker.registerWorkflow() (v0 API)
 * and starts the worker process.
 */
const logger = require('../utils/logger');
const { getHatchetClient, isHatchetEnabled } = require('./client');

let worker = null;

/**
 * Collect all workflow definitions from workflow files
 */
function getAllWorkflows() {
  const { getPlanWorkflows } = require('./plan.workflows');
  const { getNodeWorkflows } = require('./node.workflows');
  const { getAgentWorkflows } = require('./agent.workflows');
  const { getGoalEvaluationWorkflows } = require('./goalEvaluation.workflow');
  const { getMemorySyncWorkflows } = require('./memorySync.workflow');

  return [
    ...getPlanWorkflows(),
    ...getNodeWorkflows(),
    ...getAgentWorkflows(),
    ...getGoalEvaluationWorkflows(),
    ...getMemorySyncWorkflows(),
  ];
}

/**
 * Start the Hatchet worker with all registered workflows
 */
async function startWorker() {
  if (!isHatchetEnabled()) {
    logger.api('Hatchet worker: Disabled (no HATCHET_CLIENT_TOKEN)');
    return null;
  }

  try {
    const hatchet = getHatchetClient();
    if (!hatchet) return null;

    worker = await hatchet.worker('agent-planner-worker');

    const workflows = getAllWorkflows();
    for (const wf of workflows) {
      await worker.registerWorkflow(wf);
    }

    await worker.start();
    const names = workflows.map(w => w.id);
    logger.api(`Hatchet worker: Started with ${names.length} workflows: ${names.join(', ')}`);

    return worker;
  } catch (err) {
    logger.error('Hatchet worker: Failed to start', err);
    return null;
  }
}

async function stopWorker() {
  if (worker) {
    try {
      await worker.stop();
      logger.api('Hatchet worker: Stopped');
    } catch (err) {
      logger.error('Hatchet worker: Stop error', err);
    }
    worker = null;
  }
}

function getWorker() {
  return worker;
}

module.exports = { startWorker, stopWorker, getWorker, getAllWorkflows };

// Standalone mode
if (require.main === module) {
  require('dotenv').config();
  (async () => {
    logger.api('Starting Hatchet worker standalone...');
    await startWorker();

    process.on('SIGINT', async () => {
      await stopWorker();
      process.exit(0);
    });
    process.on('SIGTERM', async () => {
      await stopWorker();
      process.exit(0);
    });
  })();
}
