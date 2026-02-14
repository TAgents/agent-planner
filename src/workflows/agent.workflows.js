/**
 * Agent Task Execution Workflows (Hatchet v1 Task API)
 */
const { getHatchetClient } = require('./client');

function registerAgentWorkflows() {
  const hatchet = getHatchetClient();
  if (!hatchet) return {};

  const assignTaskToAgent = hatchet.task({
    name: 'assign-agent-task',
    fn: async (input) => {
      const dal = require('../db/dal.cjs');
      const { nodeId, planId, agentId, userId, message } = input;

      // Inject relevant active goals as context
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
  });

  const processAgentResult = hatchet.task({
    name: 'process-agent-result',
    fn: async (input) => {
      const dal = require('../db/dal.cjs');
      const { nodeId, agentId, result, status } = input;

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
  });

  return { assignTaskToAgent, processAgentResult };
}

module.exports = { registerAgentWorkflows };
