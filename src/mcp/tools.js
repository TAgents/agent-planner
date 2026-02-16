/**
 * MCP Tool Bridge — Tool definitions for agents to interact with AgentPlanner
 * 
 * These tools are registered with the MCP server so that AI agents can:
 * - Complete tasks
 * - Evaluate goals
 * - Log knowledge/insights
 * - Query plan status
 */
const dal = require('../db/dal.cjs');
const logger = require('../utils/logger');

/**
 * MCP Tool definitions following the Model Context Protocol spec.
 * Each tool has: name, description, inputSchema, and a handler function.
 */
const tools = [
  {
    name: 'agentplanner_complete_task',
    description: 'Mark a task (plan node) as completed and optionally add a completion note.',
    inputSchema: {
      type: 'object',
      properties: {
        planId: { type: 'string', description: 'The plan UUID' },
        nodeId: { type: 'string', description: 'The task/node UUID to complete' },
        note: { type: 'string', description: 'Optional completion note or summary' },
      },
      required: ['planId', 'nodeId'],
    },
    handler: async ({ planId, nodeId, note }) => {
      try {
        const node = await dal.nodesDal.update(nodeId, { status: 'completed' });

        if (note) {
          await dal.logsDal.create({
            planNodeId: nodeId,
            content: `Task completed by agent: ${note}`,
            logType: 'progress',
            metadata: { source: 'mcp', planId },
          });
        }

        return {
          success: true,
          message: `Task '${node.title}' marked as completed`,
          nodeId,
        };
      } catch (err) {
        return { success: false, error: err.message };
      }
    },
  },

  {
    name: 'agentplanner_update_task',
    description: 'Update a task status or details.',
    inputSchema: {
      type: 'object',
      properties: {
        planId: { type: 'string', description: 'The plan UUID' },
        nodeId: { type: 'string', description: 'The task/node UUID' },
        status: { type: 'string', enum: ['not_started', 'in_progress', 'completed', 'blocked', 'cancelled'] },
        note: { type: 'string', description: 'Optional progress note' },
      },
      required: ['planId', 'nodeId'],
    },
    handler: async ({ planId, nodeId, status, note }) => {
      try {
        const updates = {};
        if (status) updates.status = status;

        const node = await dal.nodesDal.update(nodeId, updates);

        if (note) {
          await dal.logsDal.create({
            planNodeId: nodeId,
            content: note,
            logType: 'progress',
            metadata: { source: 'mcp', planId },
          });
        }

        return {
          success: true,
          message: `Task '${node.title}' updated`,
          nodeId,
          status: node.status,
        };
      } catch (err) {
        return { success: false, error: err.message };
      }
    },
  },

  {
    name: 'agentplanner_evaluate_goal',
    description: 'Submit an evaluation for a goal with a score and reasoning.',
    inputSchema: {
      type: 'object',
      properties: {
        goalId: { type: 'string', description: 'The goal UUID' },
        score: { type: 'number', description: 'Score from 0-100' },
        reasoning: { type: 'string', description: 'Explanation of the evaluation' },
        suggestedActions: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              action: { type: 'string' },
              priority: { type: 'string' },
              description: { type: 'string' },
            },
          },
          description: 'Suggested next actions',
        },
      },
      required: ['goalId', 'score', 'reasoning'],
    },
    handler: async ({ goalId, score, reasoning, suggestedActions }) => {
      try {
        const evaluation = await dal.goalEvaluationsDal.create({
          goalId,
          evaluatedBy: 'agent:mcp',
          score,
          reasoning,
          suggestedActions: suggestedActions || [],
        });

        return {
          success: true,
          message: `Goal evaluated with score ${score}`,
          evaluationId: evaluation.id,
        };
      } catch (err) {
        return { success: false, error: err.message };
      }
    },
  },

  {
    name: 'agentplanner_log_knowledge',
    description: 'Log a knowledge entry (decision, learning, insight, or context).',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Brief title for the knowledge entry' },
        content: { type: 'string', description: 'Full content/description' },
        entryType: {
          type: 'string',
          enum: ['decision', 'learning', 'context', 'constraint', 'reference', 'note'],
          description: 'Type of knowledge entry',
        },
        tags: { type: 'array', items: { type: 'string' }, description: 'Optional tags' },
        planId: { type: 'string', description: 'Optional related plan ID' },
        goalId: { type: 'string', description: 'Optional related goal ID' },
      },
      required: ['title', 'content', 'entryType'],
    },
    handler: async ({ title, content, entryType, tags, planId, goalId }) => {
      try {
        // Generate embedding for semantic search
        let embedding;
        try {
          const embeddings = require('../services/embeddings');
          embedding = await embeddings.generateEmbedding(`${title}\n\n${content}`);
        } catch {
          // Embedding generation is optional — knowledge still gets stored
        }

        const entry = await dal.knowledgeDal.create({
          title,
          content,
          entryType,
          source: 'agent',
          sourceRef: planId || goalId || undefined,
          tags: tags || [],
          embedding,
          metadata: {
            createdVia: 'mcp',
            planId,
            goalId,
          },
        });

        return {
          success: true,
          message: `Knowledge entry '${title}' created`,
          entryId: entry.id,
        };
      } catch (err) {
        return { success: false, error: err.message };
      }
    },
  },

  {
    name: 'agentplanner_get_plan_status',
    description: 'Get the current status of a plan including task completion stats.',
    inputSchema: {
      type: 'object',
      properties: {
        planId: { type: 'string', description: 'The plan UUID' },
      },
      required: ['planId'],
    },
    handler: async ({ planId }) => {
      try {
        const plan = await dal.plansDal.findById(planId);
        if (!plan) return { success: false, error: 'Plan not found' };

        const nodes = await dal.nodesDal.findByPlanId(planId);
        const stats = {
          total: nodes.length,
          completed: nodes.filter(n => n.status === 'completed').length,
          inProgress: nodes.filter(n => n.status === 'in_progress').length,
          blocked: nodes.filter(n => n.status === 'blocked').length,
          notStarted: nodes.filter(n => n.status === 'not_started').length,
        };

        return {
          success: true,
          plan: { id: plan.id, title: plan.title, status: plan.status },
          stats,
          completionPercent: Math.round((stats.completed / stats.total) * 100),
        };
      } catch (err) {
        return { success: false, error: err.message };
      }
    },
  },
];

/**
 * Get tool definitions (without handlers) for MCP registration
 */
function getToolDefinitions() {
  return tools.map(({ name, description, inputSchema }) => ({
    name,
    description,
    inputSchema,
  }));
}

/**
 * Execute a tool by name
 */
async function executeTool(name, args) {
  const tool = tools.find(t => t.name === name);
  if (!tool) {
    return { success: false, error: `Unknown tool: ${name}` };
  }

  try {
    return await tool.handler(args);
  } catch (err) {
    await logger.error(`MCP tool ${name} error: ${err.message}`);
    return { success: false, error: err.message };
  }
}

module.exports = { tools, getToolDefinitions, executeTool };
