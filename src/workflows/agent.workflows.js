/**
 * Agent Task Execution Workflows (v0 registerWorkflow API)
 */

function getAgentWorkflows() {
  return [
    {
      id: 'assign-agent-task',
      description: 'Assign a task to an agent',
      steps: [{
        name: 'assign-agent-task-step',
        run: async (ctx) => {
          const dal = require('../db/dal.cjs');
          const { nodeId, planId, agentId, userId, message } = ctx.workflowInput();

          let goalContext = [];
          try {
            const planGoals = await dal.goalsDal.getLinkedGoals('plan', planId);
            const ownerGoals = await dal.goalsDal.getActiveGoalsForOwner(userId);
            const seen = new Set();
            goalContext = [...planGoals, ...ownerGoals].filter(g => {
              if (seen.has(g.id)) return false;
              seen.add(g.id);
              return g.status === 'active';
            }).map(g => ({
              id: g.id, title: g.title, type: g.type,
              priority: g.priority, successCriteria: g.successCriteria,
            }));
          } catch (err) {
            // Goal injection is non-fatal
          }

          const node = await dal.nodesDal.update(nodeId, {
            assigned_agent_id: agentId,
            assigned_agent_at: new Date().toISOString(),
            assigned_agent_by: userId,
            agent_requested: true,
            agent_requested_at: new Date().toISOString(),
            agent_requested_by: userId,
            agent_request_message: message || null,
            agent_goal_context: goalContext.length > 0 ? JSON.stringify(goalContext) : null,
            status: 'in_progress',
            updated_at: new Date().toISOString(),
          });

          await dal.logsDal.create({
            plan_node_id: nodeId,
            user_id: userId,
            content: `Assigned to agent ${agentId}` + (goalContext.length > 0 ? ` (with ${goalContext.length} active goals)` : ''),
            log_type: 'progress',
          });

          return { node, agentId, goalContext };
        },
      }],
    },
    {
      id: 'process-agent-result',
      description: 'Process result from an agent task',
      steps: [{
        name: 'process-agent-result-step',
        run: async (ctx) => {
          const dal = require('../db/dal.cjs');
          const { nodeId, agentId, result, status } = ctx.workflowInput();

          const finalStatus = status || 'completed';

          const node = await dal.nodesDal.update(nodeId, {
            status: finalStatus,
            updated_at: new Date().toISOString(),
          });

          await dal.logsDal.create({
            plan_node_id: nodeId,
            user_id: agentId,
            content: result || `Agent completed task with status: ${finalStatus}`,
            log_type: 'progress',
          });

          return { node, status: finalStatus };
        },
      }],
    },
  ];
}

module.exports = { getAgentWorkflows };
