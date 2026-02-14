/**
 * Hatchet Worker
 * 
 * Registers all task workflows and starts the worker process.
 * Can be run standalone or integrated into the API server.
 */
const logger = require('../utils/logger');
const { getHatchetClient, isHatchetEnabled } = require('./client');

let worker = null;

/**
 * Register all workflows and return the task definitions
 */
function registerAllWorkflows() {
  const { registerPlanWorkflows } = require('./plan.workflows');
  const { registerNodeWorkflows } = require('./node.workflows');
  const { registerAgentWorkflows } = require('./agent.workflows');
  const { registerGoalEvaluationWorkflow } = require('./goalEvaluation.workflow');

  const planTasks = registerPlanWorkflows();
  const nodeTasks = registerNodeWorkflows();
  const agentTasks = registerAgentWorkflows();
  const goalTasks = registerGoalEvaluationWorkflow();

  return { ...planTasks, ...nodeTasks, ...agentTasks, ...goalTasks };
}

/**
 * Start the Hatchet worker with all registered task workflows
 */
async function startWorker() {
  if (!isHatchetEnabled()) {
    logger.api('Hatchet worker: Disabled (no HATCHET_CLIENT_TOKEN)');
    return null;
  }

  try {
    const hatchet = getHatchetClient();
    if (!hatchet) return null;

    // Register workflows (tasks are registered on the client)
    const tasks = registerAllWorkflows();
    const taskNames = Object.keys(tasks);

    // Create and start worker
    worker = await hatchet.worker('agent-planner-worker', {
      maxRuns: 10,
    });

    await worker.start();
    logger.api(`Hatchet worker: Started with ${taskNames.length} tasks: ${taskNames.join(', ')}`);

    return worker;
  } catch (err) {
    logger.error('Hatchet worker: Failed to start', err);
    return null;
  }
}

/**
 * Stop the worker gracefully
 */
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

module.exports = { startWorker, stopWorker, getWorker, registerAllWorkflows };

// Standalone mode
if (require.main === module) {
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
