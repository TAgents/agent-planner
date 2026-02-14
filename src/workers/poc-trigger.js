/**
 * PoC trigger — simulates the API emitting an agent request event.
 * Run: node -r dotenv/config src/workers/poc-trigger.js dotenv_config_path=.env.hatchet
 */

const { Hatchet } = require('@hatchet-dev/typescript-sdk');

async function main() {
  const hatchet = Hatchet.init();
  const requestId = `req_${Date.now()}`;
  
  console.log(`Triggering agent:request:created event (${requestId})...`);
  
  await hatchet.event.push('agent:request:created', {
    requestId,
    planId: 'plan_demo_001',
    nodeId: 'node_task_042',
    message: 'Please review the implementation of the auth middleware and suggest improvements.',
    webhookUrl: 'https://httpbin.org/post',
  });

  console.log('✅ Event pushed! Check the worker logs for adapter outputs.');
  
  // Simulate a response after 5s
  setTimeout(async () => {
    console.log(`\nSimulating agent response for ${requestId}...`);
    
    await hatchet.event.push('agent:response:received', {
      requestId,
      adapter: 'webhook',
      response: 'The auth middleware looks good. Consider adding rate limiting.',
    });
    
    console.log('✅ Response event pushed!');
    setTimeout(() => process.exit(0), 3000);
  }, 5000);
}

main().catch(console.error);
