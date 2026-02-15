/**
 * Hatchet PoC — Messaging Adapter Workflow
 * 
 * Proves: event-driven fan-out to multiple adapters via Hatchet.
 * 
 * Flow:
 *   1. API triggers "agent:request:created" event
 *   2. Hatchet dispatches to all registered adapter workflows
 *   3. Each adapter sends the message via its platform
 *   4. Adapter emits "agent:response:received" when reply comes back
 */

import { Hatchet } from '@hatchet-dev/typescript-sdk';

const hatchet = Hatchet.init();

// ── Webhook Adapter ──────────────────────────────────────────
const webhookAdapter = hatchet.workflow({
  name: 'webhook-adapter',
  description: 'Delivers agent requests via webhook POST',
  onEvents: ['agent:request:created'],
});

webhookAdapter.task({
  name: 'deliver-webhook',
  fn: async (input, ctx) => {
    const { requestId, planId, nodeId, message, webhookUrl } = input;
    
    console.log(`[webhook-adapter] Delivering request ${requestId} to ${webhookUrl}`);
    
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event: 'agent.request.created',
        requestId,
        planId,
        nodeId,
        message,
        timestamp: new Date().toISOString(),
      }),
    });

    if (!response.ok) {
      throw new Error(`Webhook delivery failed: ${response.status}`);
    }

    return { 
      status: 'delivered', 
      adapter: 'webhook',
      requestId,
      statusCode: response.status,
    };
  },
});

// ── Console Adapter (for testing) ────────────────────────────
const consoleAdapter = hatchet.workflow({
  name: 'console-adapter',
  description: 'Logs agent requests to console (dev/testing)',
  onEvents: ['agent:request:created'],
});

consoleAdapter.task({
  name: 'log-request',
  fn: async (input) => {
    console.log(`\n═══════════════════════════════════════`);
    console.log(`[console-adapter] Agent Request`);
    console.log(`  Request ID: ${input.requestId}`);
    console.log(`  Plan: ${input.planId}`);
    console.log(`  Node: ${input.nodeId}`);
    console.log(`  Message: ${input.message}`);
    console.log(`═══════════════════════════════════════\n`);

    return { status: 'logged', adapter: 'console', requestId: input.requestId };
  },
});

// ── Response Handler ─────────────────────────────────────────
const responseHandler = hatchet.workflow({
  name: 'agent-response-handler',
  description: 'Processes agent responses from any adapter',
  onEvents: ['agent:response:received'],
});

responseHandler.task({
  name: 'process-response',
  fn: async (input) => {
    const { requestId, response, adapter } = input;
    
    console.log(`[response-handler] Got response for ${requestId} via ${adapter}`);
    
    return { 
      status: 'processed', 
      requestId, 
      adapter,
      responseLength: response?.length || 0,
    };
  },
});

// ── Worker startup ───────────────────────────────────────────
async function main() {
  const worker = await hatchet.worker('messaging-adapters', {
    workflows: [webhookAdapter, consoleAdapter, responseHandler],
  });
  
  await worker.start();
  console.log('🚀 Messaging adapter workers started');
}

main().catch(console.error);
