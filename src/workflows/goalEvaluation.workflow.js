/**
 * Goal Evaluation Cron Workflow (v0 registerWorkflow API)
 * 
 * Periodically evaluates active goals. Runs daily at 06:00 UTC.
 */
const logger = require('../utils/logger');

function getGoalEvaluationWorkflows() {
  return [
    {
      id: 'evaluate-goals-cron',
      description: 'Daily evaluation of active goals',
      on: { crons: ['0 6 * * *'] },
      steps: [{
        name: 'evaluate-goals-step',
        run: async (ctx) => {
          const dal = require('../db/dal.cjs');
          const { eq } = await import('drizzle-orm');

          await logger.api('Goal evaluation cron: starting');

          const { db } = await import('../db/connection.mjs');
          const { goals } = await import('../db/schema/goals.mjs');
          const activeGoals = await db.select().from(goals).where(eq(goals.status, 'active'));

          let evaluated = 0;

          for (const goal of activeGoals) {
            try {
              let score = null;
              let reasoning = '';

              if (goal.type === 'metric' && goal.successCriteria) {
                const criteria = goal.successCriteria;
                if (Array.isArray(criteria)) {
                  const met = criteria.filter(c => c.current >= c.target).length;
                  score = Math.round((met / criteria.length) * 100);
                  reasoning = `${met}/${criteria.length} criteria met`;
                }
              } else if (goal.type === 'outcome') {
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
      }],
    },
  ];
}

module.exports = { getGoalEvaluationWorkflows };
