/**
 * OpenClaw Adapter — dispatches tasks to OpenClaw gateway for agent execution
 * 
 * Sends task payloads to the OpenClaw gateway API, which creates agent sessions
 * to execute tasks. Receives responses via webhooks or polling.
 */
const { BaseAdapter } = require('./base.adapter');
const logger = require('../utils/logger');
const axios = require('axios');

const OPENCLAW_GATEWAY_URL = process.env.OPENCLAW_GATEWAY_URL || 'http://localhost:7680';
const OPENCLAW_API_TOKEN = process.env.OPENCLAW_API_TOKEN || '';

class OpenClawAdapter extends BaseAdapter {
  constructor() {
    super('openclaw');
    this.gatewayUrl = OPENCLAW_GATEWAY_URL;
    this.apiToken = OPENCLAW_API_TOKEN;
  }

  async isConfigured(_userId) {
    return !!this.apiToken && !!this.gatewayUrl;
  }

  async getSettings(_userId) {
    if (!this.apiToken) return null;
    return {
      gatewayUrl: this.gatewayUrl,
      hasToken: true,
    };
  }

  /**
   * Deliver a task/notification to OpenClaw for agent execution
   */
  async deliver(payload) {
    const { event, plan, task, request, actor, message, goals, knowledge } = payload;

    if (!this.apiToken) {
      return { success: false, reason: 'OpenClaw not configured (no API token)' };
    }

    try {
      // Build the agent prompt from task context
      const agentPrompt = this._buildPrompt({ event, plan, task, request, goals, knowledge, message });

      const response = await axios.post(
        `${this.gatewayUrl}/api/v1/sessions`,
        {
          prompt: agentPrompt,
          metadata: {
            source: 'agentplanner',
            event,
            planId: plan?.id,
            taskId: task?.id,
            requestType: request?.type,
          },
          // Callback URL for the agent to report back
          callbackUrl: `${process.env.API_BASE_URL || 'http://localhost:3000'}/api/v2/openclaw/callback`,
        },
        {
          headers: {
            'Authorization': `Bearer ${this.apiToken}`,
            'Content-Type': 'application/json',
          },
          timeout: 30000,
        }
      );

      await logger.api(`OpenClaw: Session created for ${event} — ${response.data?.sessionId || 'unknown'}`);

      return {
        success: true,
        sessionId: response.data?.sessionId,
        status: response.data?.status || 'created',
      };
    } catch (error) {
      const msg = error.response?.data?.message || error.message;
      await logger.error(`OpenClaw delivery error: ${msg}`);
      return { success: false, error: msg };
    }
  }

  /**
   * Dispatch a task specifically for agent execution (richer than deliver)
   */
  async dispatchTask({ task, plan, goals = [], knowledge = [] }) {
    const prompt = this._buildPrompt({
      event: 'agent.task.dispatch',
      plan,
      task,
      goals,
      knowledge,
    });

    return this.deliver({
      event: 'agent.task.dispatch',
      plan,
      task,
      goals,
      knowledge,
      message: prompt,
    });
  }

  /**
   * Build a structured prompt for the agent
   */
  _buildPrompt({ event, plan, task, goals, knowledge, request, message }) {
    const parts = [];

    parts.push(`# Task Assignment`);
    parts.push('');

    if (plan) {
      parts.push(`## Plan: ${plan.title || plan.id}`);
      if (plan.description) parts.push(plan.description);
      parts.push('');
    }

    if (task) {
      parts.push(`## Task: ${task.title || task.id}`);
      parts.push(`**Status:** ${task.status || 'unknown'}`);
      if (task.description) parts.push(`**Description:** ${task.description}`);
      if (task.agent_instructions) {
        parts.push('');
        parts.push('### Agent Instructions');
        parts.push(task.agent_instructions);
      }
      parts.push('');
    }

    if (goals && goals.length > 0) {
      parts.push('## Active Goals');
      for (const g of goals) {
        parts.push(`- **${g.title}** (${g.type}, priority: ${g.priority || 0})`);
        if (g.criteria) parts.push(`  Criteria: ${JSON.stringify(g.criteria)}`);
      }
      parts.push('');
    }

    if (knowledge && knowledge.length > 0) {
      parts.push('## Relevant Context');
      for (const k of knowledge) {
        parts.push(`- **${k.title}**: ${k.content?.substring(0, 300) || ''}`);
      }
      parts.push('');
    }

    if (request?.message) {
      parts.push(`## Request`);
      parts.push(request.message);
      parts.push('');
    }

    // Instructions for the agent on how to report back
    parts.push('## Reporting');
    parts.push('When complete, use the AgentPlanner MCP tools or API to:');
    parts.push('1. Update task status via `agentplanner_complete_task`');
    parts.push('2. Log any learnings via `agentplanner_log_knowledge`');
    parts.push('3. Evaluate relevant goals via `agentplanner_evaluate_goal`');

    return parts.join('\n');
  }
}

module.exports = { OpenClawAdapter };
