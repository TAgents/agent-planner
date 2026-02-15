/**
 * Plan Operation Workflows (v0 registerWorkflow API)
 */

function getPlanWorkflows() {
  return [
    {
      id: 'create-plan',
      description: 'Create a new plan with root node and owner collaborator',
      steps: [{
        name: 'create-plan-step',
        run: async (ctx) => {
          const dal = require('../db/dal.cjs');
          const { title, description, ownerId, visibility, metadata } = ctx.workflowInput();

          const plan = await dal.plansDal.create({
            title,
            description: description || '',
            owner_id: ownerId,
            visibility: visibility || 'private',
            is_public: visibility === 'public',
            status: 'draft',
            metadata: metadata || {},
          });

          const rootNode = await dal.nodesDal.create({
            plan_id: plan.id,
            title,
            node_type: 'root',
            description: description || '',
            status: 'not_started',
            order_index: 0,
          });

          await dal.collaboratorsDal.addCollaborator({
            plan_id: plan.id,
            user_id: ownerId,
            role: 'owner',
          });

          return { plan, rootNode };
        },
      }],
    },
    {
      id: 'update-plan',
      description: 'Update an existing plan',
      steps: [{
        name: 'update-plan-step',
        run: async (ctx) => {
          const dal = require('../db/dal.cjs');
          const { planId, userId, updates } = ctx.workflowInput();

          const plan = await dal.plansDal.getById(planId);
          if (!plan) throw new Error('Plan not found');

          if (plan.owner_id !== userId) {
            const collab = await dal.collaboratorsDal.getByPlanAndUser(planId, userId);
            if (!collab || !['admin', 'editor'].includes(collab.role)) {
              throw new Error('Insufficient permissions');
            }
          }

          const updated = await dal.plansDal.update(planId, {
            ...updates,
            updated_at: new Date().toISOString(),
          });

          return { plan: updated };
        },
      }],
    },
    {
      id: 'delete-plan',
      description: 'Delete a plan and all its nodes',
      steps: [{
        name: 'delete-plan-step',
        run: async (ctx) => {
          const dal = require('../db/dal.cjs');
          const { planId, userId } = ctx.workflowInput();

          const plan = await dal.plansDal.getById(planId);
          if (!plan) throw new Error('Plan not found');
          if (plan.owner_id !== userId) throw new Error('Only owner can delete');

          const nodes = await dal.nodesDal.getByPlanId(planId);
          for (const node of nodes) {
            await dal.nodesDal.delete(node.id);
          }
          await dal.collaboratorsDal.removeAllFromPlan(planId);
          await dal.plansDal.delete(planId);

          return { deleted: true, nodeCount: nodes.length };
        },
      }],
    },
  ];
}

module.exports = { getPlanWorkflows };
