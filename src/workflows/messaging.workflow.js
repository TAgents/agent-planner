/**
 * Hatchet Messaging Workflow
 * 
 * Orchestrates notification delivery through adapters via Hatchet.
 * 
 * Events:
 *   - notification:send → fan-out to all configured adapters
 *   - agent:request:created → notify about agent requests
 *   - agent:response:received → process agent responses
 */
const { Hatchet } = require('@hatchet-dev/typescript-sdk');
const { deliverToAll } = require('../adapters');
const dal = require('../db/dal.cjs');
const logger = require('../utils/logger');

let hatchet;

function getHatchet() {
  if (!hatchet) {
    hatchet = Hatchet.init();
  }
  return hatchet;
}

// ── Notification Delivery Workflow ───────────────────────────
function createNotificationWorkflow() {
  const h = getHatchet();

  const workflow = h.workflow({
    name: 'notification-delivery',
    description: 'Delivers notifications to all configured adapters',
    onEvents: ['notification:send'],
  });

  workflow.task({
    name: 'deliver-to-adapters',
    fn: async (input) => {
      const results = await deliverToAll(input);

      const succeeded = results.filter(r => r.success).length;
      const failed = results.filter(r => !r.success).length;

      return {
        status: 'delivered',
        succeeded,
        failed,
        results,
      };
    },
  });

  return workflow;
}

// ── Agent Request Workflow ───────────────────────────────────
function createAgentRequestWorkflow() {
  const h = getHatchet();

  const workflow = h.workflow({
    name: 'agent-request-handler',
    description: 'Processes agent request events',
    onEvents: ['agent:request:created'],
  });

  workflow.task({
    name: 'process-agent-request',
    fn: async (input) => {
      const { planId, nodeId, requestType, message, userId, requestedBy } = input;

      // Build notification payload
      let plan, task;
      try {
        plan = await dal.plansDal.findById(planId);
        task = await dal.nodesDal.findById(nodeId);
      } catch { /* best effort */ }

      const eventType = `task.${requestType}_requested`;

      const payload = {
        event: eventType,
        userId: plan?.ownerId || userId,
        plan: plan ? { id: plan.id, title: plan.title } : { id: planId },
        task: task ? {
          id: task.id, title: task.title, description: task.description,
          status: task.status, agent_instructions: task.agentInstructions,
        } : { id: nodeId },
        request: { type: requestType, message, requested_at: new Date().toISOString(), requested_by: requestedBy },
        actor: { name: requestedBy, type: 'user' },
        message: `🚀 Agent requested to ${requestType} task '${task?.title || nodeId}'`,
      };

      const results = await deliverToAll(payload);

      return {
        status: 'notified',
        eventType,
        adaptersNotified: results.filter(r => r.success).map(r => r.adapter),
      };
    },
  });

  return workflow;
}

// ── Agent Response Workflow ──────────────────────────────────
function createAgentResponseWorkflow() {
  const h = getHatchet();

  const workflow = h.workflow({
    name: 'agent-response-handler',
    description: 'Processes agent responses',
    onEvents: ['agent:response:received'],
  });

  workflow.task({
    name: 'process-response',
    fn: async (input) => {
      const { requestId, nodeId, response, adapter } = input;

      // Log the response
      if (nodeId) {
        try {
          // Find the node to get userId context
          const node = await dal.nodesDal.findById(nodeId);
          if (node && node.assignedAgentId) {
            await dal.logsDal.create({
              planNodeId: nodeId,
              userId: node.assignedAgentId,
              content: `Agent response (via ${adapter}): ${response?.substring(0, 500) || '(empty)'}`,
              logType: 'progress',
              metadata: { adapter, requestId },
            });
          }
        } catch { /* best effort logging */ }
      }

      return {
        status: 'processed',
        requestId,
        adapter,
        responseLength: response?.length || 0,
      };
    },
  });

  return workflow;
}

// ── Event emitter helper ─────────────────────────────────────
async function emitEvent(eventName, data) {
  try {
    const h = getHatchet();
    await h.event.push(eventName, data);
    return true;
  } catch (error) {
    // Fall back to direct delivery if Hatchet is unavailable
    if (eventName === 'notification:send') {
      await deliverToAll(data);
    }
    return false;
  }
}

// ── Worker startup ───────────────────────────────────────────
async function startWorker() {
  const h = getHatchet();

  const workflows = [
    createNotificationWorkflow(),
    createAgentRequestWorkflow(),
    createAgentResponseWorkflow(),
  ];

  const worker = await h.worker('agentplanner-messaging', { workflows });
  await worker.start();
  console.log('🚀 Hatchet messaging worker started');
  return worker;
}

module.exports = {
  startWorker,
  emitEvent,
  createNotificationWorkflow,
  createAgentRequestWorkflow,
  createAgentResponseWorkflow,
};
