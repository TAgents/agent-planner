/**
 * Plan Operation Workflows (Hatchet v1 Task API)
 * 
 * Each task handles a plan lifecycle operation.
 */
const { getHatchetClient } = require('./client');

function registerPlanWorkflows() {
  const hatchet = getHatchetClient();
  if (!hatchet) return {};

  const createPlanTask = hatchet.task({
    name: 'create-plan',
    fn: async (input) => {
      const dal = require('../db/dal.cjs');
      const { title, description, ownerId, visibility, metadata } = input;

      const plan = await dal.plansDal.create({
        title,
        description: description || '',
        owner_id: ownerId,
        visibility: visibility || 'private',
        is_public: visibility === 'public',
        status: 'draft',
        metadata: metadata || {},
      });

      // Create root node
      const rootNode = await dal.nodesDal.create({
        plan_id: plan.id,
        title,
        node_type: 'root',
        description: description || '',
        status: 'not_started',
        order_index: 0,
      });

      // Add owner as collaborator
      await dal.collaboratorsDal.addCollaborator({
        plan_id: plan.id,
        user_id: ownerId,
        role: 'owner',
      });

      return { plan, rootNode };
    },
  });

  const updatePlanTask = hatchet.task({
    name: 'update-plan',
    fn: async (input) => {
      const dal = require('../db/dal.cjs');
      const { planId, userId, updates } = input;

      const plan = await dal.plansDal.getById(planId);
      if (!plan) throw new Error('Plan not found');

      // Check access
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
  });

  const deletePlanTask = hatchet.task({
    name: 'delete-plan',
    fn: async (input) => {
      const dal = require('../db/dal.cjs');
      const { planId, userId } = input;

      const plan = await dal.plansDal.getById(planId);
      if (!plan) throw new Error('Plan not found');
      if (plan.owner_id !== userId) throw new Error('Only owner can delete');

      // Delete nodes, collaborators, then plan
      const nodes = await dal.nodesDal.getByPlanId(planId);
      for (const node of nodes) {
        await dal.nodesDal.delete(node.id);
      }
      await dal.collaboratorsDal.removeAllFromPlan(planId);
      await dal.plansDal.delete(planId);

      return { deleted: true, nodeCount: nodes.length };
    },
  });

  return { createPlanTask, updatePlanTask, deletePlanTask };
}

module.exports = { registerPlanWorkflows };
