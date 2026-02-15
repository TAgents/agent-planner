/**
 * Console Adapter — logs notifications to stdout (dev/testing)
 */
const { BaseAdapter } = require('./base.adapter');

class ConsoleAdapter extends BaseAdapter {
  constructor() {
    super('console');
  }

  async isConfigured() {
    return process.env.NODE_ENV === 'development';
  }

  async deliver(payload) {
    const { event, plan, task, request, actor, message } = payload;

    console.log(`\n═══ AgentPlanner Notification ═══`);
    console.log(`  Event:   ${event}`);
    console.log(`  Message: ${message || '(none)'}`);
    if (plan) console.log(`  Plan:    ${plan.title} (${plan.id})`);
    if (task) console.log(`  Task:    ${task.title} [${task.status}]`);
    if (request) console.log(`  Request: ${request.type} — ${request.message || ''}`);
    if (actor) console.log(`  Actor:   ${actor.name}`);
    console.log(`═════════════════════════════════\n`);

    return { success: true, adapter: 'console' };
  }
}

module.exports = { ConsoleAdapter };
