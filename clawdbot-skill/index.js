/**
 * Agent Planner Skill for Clawdbot
 *
 * Enables plan management through messaging platforms via Clawdbot gateway.
 * Supports creating, tracking, and collaborating on plans in real-time.
 */

import { ApiClient } from './lib/api-client.js';
import { WebSocketClient } from './lib/ws-client.js';
import { CommandParser } from './lib/command-parser.js';
import { Formatter } from './lib/formatter.js';

// Command handlers
import { createPlan, listPlans, showPlan, deletePlan, progressPlan, subscribePlan, unsubscribePlan } from './commands/plan.js';
import { addTask, updateTaskStatus, assignTask, commentTask, logTask } from './commands/task.js';
import { addPhase, listPhases } from './commands/phase.js';
import { addMilestone, listMilestones } from './commands/milestone.js';

export default class AgentPlannerSkill {
  constructor(gateway, config) {
    this.gateway = gateway;
    this.config = config;
    this.api = null;
    this.ws = null;
    this.parser = new CommandParser();
    this.formatter = new Formatter();
    this.subscriptions = new Map(); // channelId -> Set of planIds
  }

  /**
   * Initialize the skill - called by Clawdbot gateway on startup
   */
  async initialize() {
    console.log('[AgentPlanner] Initializing skill...');

    // Initialize API client
    this.api = new ApiClient({
      baseUrl: this.config.api_url,
      token: this.config.api_token
    });

    // Verify API connection
    try {
      await this.api.healthCheck();
      console.log('[AgentPlanner] API connection verified');
    } catch (error) {
      console.error('[AgentPlanner] Failed to connect to API:', error.message);
      throw new Error('Failed to connect to Agent Planner API. Check your api_url and api_token configuration.');
    }

    // Initialize WebSocket for real-time updates
    if (this.config.ws_url) {
      this.ws = new WebSocketClient({
        url: this.config.ws_url,
        token: this.config.api_token,
        onEvent: this.handleWebSocketEvent.bind(this),
        onError: this.handleWebSocketError.bind(this),
        onReconnect: this.handleWebSocketReconnect.bind(this)
      });

      await this.ws.connect();
      console.log('[AgentPlanner] WebSocket connected for real-time updates');
    }

    console.log('[AgentPlanner] Skill initialized successfully');
  }

  /**
   * Handle incoming message from any messaging platform
   */
  async handleMessage(message, context) {
    const { text, channel, user, platform } = message;

    // Check for slash commands
    if (text.startsWith('/plan') || text.startsWith('/p ')) {
      return this.handlePlanCommand(text, context);
    }

    if (text.startsWith('/task') || text.startsWith('/t ')) {
      return this.handleTaskCommand(text, context);
    }

    if (text.startsWith('/phase')) {
      return this.handlePhaseCommand(text, context);
    }

    if (text.startsWith('/milestone') || text.startsWith('/ms ')) {
      return this.handleMilestoneCommand(text, context);
    }

    // Try natural language intent matching
    const intent = this.parser.matchIntent(text);
    if (intent) {
      return this.handleIntent(intent, text, context);
    }

    // Not a plan-related message
    return null;
  }

  /**
   * Handle /plan commands
   */
  async handlePlanCommand(text, context) {
    const parsed = this.parser.parse(text, 'plan');

    switch (parsed.subcommand) {
      case 'create':
        return createPlan(this, parsed, context);

      case 'list':
        return listPlans(this, parsed, context);

      case 'show':
        return showPlan(this, parsed, context);

      case 'delete':
        return deletePlan(this, parsed, context);

      case 'progress':
        return progressPlan(this, parsed, context);

      case 'subscribe':
        return subscribePlan(this, parsed, context);

      case 'unsubscribe':
        return unsubscribePlan(this, parsed, context);

      case 'help':
      default:
        return this.formatter.planHelp();
    }
  }

  /**
   * Handle /task commands
   */
  async handleTaskCommand(text, context) {
    const parsed = this.parser.parse(text, 'task');

    switch (parsed.subcommand) {
      case 'add':
        return addTask(this, parsed, context);

      case 'status':
        return updateTaskStatus(this, parsed, context);

      case 'assign':
        return assignTask(this, parsed, context);

      case 'comment':
        return commentTask(this, parsed, context);

      case 'log':
        return logTask(this, parsed, context);

      default:
        return this.formatter.taskHelp();
    }
  }

  /**
   * Handle /phase commands
   */
  async handlePhaseCommand(text, context) {
    const parsed = this.parser.parse(text, 'phase');

    switch (parsed.subcommand) {
      case 'add':
        return addPhase(this, parsed, context);

      case 'list':
        return listPhases(this, parsed, context);

      default:
        return this.formatter.phaseHelp();
    }
  }

  /**
   * Handle /milestone commands
   */
  async handleMilestoneCommand(text, context) {
    const parsed = this.parser.parse(text, 'milestone');

    switch (parsed.subcommand) {
      case 'add':
        return addMilestone(this, parsed, context);

      case 'list':
        return listMilestones(this, parsed, context);

      default:
        return this.formatter.milestoneHelp();
    }
  }

  /**
   * Handle natural language intents
   */
  async handleIntent(intent, text, context) {
    switch (intent.name) {
      case 'create_plan':
        return createPlan(this, { args: { title: intent.extracted } }, context);

      case 'check_progress':
        return this.handleProgressIntent(intent, context);

      case 'add_task':
        return addTask(this, { args: { title: intent.extracted } }, context);

      case 'complete_task':
        return updateTaskStatus(this, { args: { id: intent.extracted, status: 'completed' } }, context);

      case 'list_plans':
        return listPlans(this, {}, context);

      default:
        return null;
    }
  }

  /**
   * Handle progress check intent - needs to find the plan first
   */
  async handleProgressIntent(intent, context) {
    // Try to find the plan by name
    const plans = await this.api.plans.list({ search: intent.extracted });

    if (plans.length === 0) {
      return this.formatter.error(`Could not find a plan matching "${intent.extracted}"`);
    }

    if (plans.length === 1) {
      return progressPlan(this, { args: { id: plans[0].id } }, context);
    }

    // Multiple matches - ask for clarification
    return this.formatter.multiplePlansFound(plans, 'Which plan would you like to check progress for?');
  }

  /**
   * Subscribe a channel to plan updates
   */
  subscribeChannel(channelId, planId) {
    if (!this.subscriptions.has(channelId)) {
      this.subscriptions.set(channelId, new Set());
    }
    this.subscriptions.get(channelId).add(planId);

    // Subscribe via WebSocket
    if (this.ws) {
      this.ws.send({
        type: 'subscribe:plan',
        planId
      });
    }
  }

  /**
   * Unsubscribe a channel from plan updates
   */
  unsubscribeChannel(channelId, planId) {
    const channelSubs = this.subscriptions.get(channelId);
    if (channelSubs) {
      channelSubs.delete(planId);
      if (channelSubs.size === 0) {
        this.subscriptions.delete(channelId);
      }
    }

    // Check if any channel still needs this plan
    let stillNeeded = false;
    for (const subs of this.subscriptions.values()) {
      if (subs.has(planId)) {
        stillNeeded = true;
        break;
      }
    }

    // Unsubscribe via WebSocket if no longer needed
    if (!stillNeeded && this.ws) {
      this.ws.send({
        type: 'unsubscribe:plan',
        planId
      });
    }
  }

  /**
   * Handle WebSocket events from Agent Planner
   */
  handleWebSocketEvent(event) {
    const { type, data } = event;

    // Find channels subscribed to this plan
    const planId = data.planId || data.plan_id;
    const channelsToNotify = [];

    for (const [channelId, planIds] of this.subscriptions) {
      if (planIds.has(planId)) {
        channelsToNotify.push(channelId);
      }
    }

    if (channelsToNotify.length === 0) return;

    // Check notification settings
    const notifications = this.config.notifications || {};
    let shouldNotify = false;
    let message = null;

    switch (type) {
      case 'node:created':
        if (notifications.on_task_created !== false) {
          shouldNotify = true;
          message = this.formatter.nodeCreatedNotification(data);
        }
        break;

      case 'node:updated':
        if (notifications.on_status_change !== false && data.changes?.status) {
          shouldNotify = true;
          message = this.formatter.statusChangeNotification(data);
        }
        break;

      case 'comment:added':
        if (notifications.on_comment !== false) {
          shouldNotify = true;
          message = this.formatter.commentNotification(data);
        }
        break;

      case 'user:assigned':
        if (notifications.on_assignment !== false) {
          shouldNotify = true;
          message = this.formatter.assignmentNotification(data);
        }
        break;

      case 'plan:updated':
        if (data.changes?.status === 'completed' && notifications.on_milestone !== false) {
          shouldNotify = true;
          message = this.formatter.planCompletedNotification(data);
        }
        break;
    }

    // Send notifications to subscribed channels
    if (shouldNotify && message) {
      for (const channelId of channelsToNotify) {
        this.gateway.send(channelId, message);
      }
    }
  }

  /**
   * Handle WebSocket errors
   */
  handleWebSocketError(error) {
    console.error('[AgentPlanner] WebSocket error:', error.message);
  }

  /**
   * Handle WebSocket reconnection
   */
  handleWebSocketReconnect() {
    console.log('[AgentPlanner] WebSocket reconnected');

    // Re-subscribe to all plans
    const allPlanIds = new Set();
    for (const planIds of this.subscriptions.values()) {
      for (const planId of planIds) {
        allPlanIds.add(planId);
      }
    }

    for (const planId of allPlanIds) {
      this.ws.send({
        type: 'subscribe:plan',
        planId
      });
    }
  }

  /**
   * Cleanup on shutdown
   */
  async shutdown() {
    console.log('[AgentPlanner] Shutting down skill...');

    if (this.ws) {
      await this.ws.disconnect();
    }

    this.subscriptions.clear();
    console.log('[AgentPlanner] Skill shutdown complete');
  }
}
