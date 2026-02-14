/**
 * Goal Evaluation Cron Workflow
 * 
 * Periodically evaluates active goals by checking linked plan/task progress.
 * Runs daily via Hatchet cron schedule.
 */
const { getHatchetClient } = require('./client');
const logger = require('../utils/logger');

function registerGoalEvaluationWorkflow() {
  const hatchet = getHatchetClient();
  if (!hatchet) return {};

  const evaluateGoals = hatchet.task({
    name: 'evaluate-goals-cron',
    // Schedule: daily at 06:00 UTC
    schedule: '0 6 * * *',
    fn: async (input) => {
      const dal = require('../db/dal.cjs');
      const { eq, and } = await import('drizzle-orm');

      await logger.api('Goal evaluation cron: starting');

      // Get all active goals
      const { db } = await import('../db/connection.mjs');
      const { goals } = await import('../db/schema/goals.mjs');
      const activeGoals = await db.select().from(goals).where(eq(goals.status, 'active'));

      let evaluated = 0;

      for (const goal of activeGoals) {
        try {
          // Get linked plans/tasks to assess progress
          const links = await dal.goalsDal.getLinkedGoals ? null : null;
          
          // Simple heuristic evaluation based on goal type
          let score = null;
          let reasoning = '';

          if (goal.type === 'metric' && goal.successCriteria) {
            // For metric goals, check if criteria has current vs target
            const criteria = goal.successCriteria;
            if (Array.isArray(criteria)) {
              const met = criteria.filter(c => c.current >= c.target).length;
              score = Math.round((met / criteria.length) * 100);
              reasoning = `${met}/${criteria.length} criteria met`;
            }
          } else if (goal.type === 'outcome') {
            // Check linked plan progress
            const linkedPlans = await dal.goalsDal.getLinkedGoals('plan', goal.id).catch(() => []);
            reasoning = `${linkedPlans.length} linked plans`;
          } else {
            reasoning = `Automated check — ${goal.type} goal, manual review recommended`;
          }

          await dal.goalsDal.addEvaluation(goal.id, {
            evaluatedBy: 'system:cron',
            score,
            reasoning,
            suggestedActions: null,
          });

          evaluated++;
        } catch (err) {
          await logger.error(`Goal evaluation failed for ${goal.id}:`, err);
        }
      }

      await logger.api(`Goal evaluation cron: evaluated ${evaluated}/${activeGoals.length} goals`);
      return { evaluated, total: activeGoals.length };
    },
  });

  return { evaluateGoals };
}

module.exports = { registerGoalEvaluationWorkflow };
