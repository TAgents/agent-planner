/**
 * Node Operation Workflows (v0 registerWorkflow API)
 */

function getNodeWorkflows() {
  return [
    {
      id: 'create-node',
      description: 'Create a new node in a plan',
      steps: [{
        name: 'create-node-step',
        run: async (ctx) => {
          const dal = require('../db/dal.cjs');
          const { planId, parentId, title, nodeType, description, userId, metadata } = ctx.workflowInput();

          const plan = await dal.plansDal.getById(planId);
          if (!plan) throw new Error('Plan not found');

          const siblings = await dal.nodesDal.getByPlanId(planId);
          const sameParent = siblings.filter(n => n.parent_id === parentId);

          const node = await dal.nodesDal.create({
            plan_id: planId,
            parent_id: parentId || null,
            title,
            node_type: nodeType,
            description: description || '',
            status: 'not_started',
            order_index: sameParent.length,
            metadata: metadata || {},
          });

          await dal.logsDal.create({
            plan_node_id: node.id,
            user_id: userId,
            content: `Created ${nodeType} "${title}"`,
            log_type: 'progress',
          });

          return { node };
        },
      }],
    },
    {
      id: 'update-node',
      description: 'Update an existing node',
      steps: [{
        name: 'update-node-step',
        run: async (ctx) => {
          const dal = require('../db/dal.cjs');
          const { nodeId, planId, userId, updates } = ctx.workflowInput();

          const node = await dal.nodesDal.getById(nodeId);
          if (!node) throw new Error('Node not found');
          if (node.plan_id !== planId) throw new Error('Node does not belong to plan');

          const updated = await dal.nodesDal.update(nodeId, {
            ...updates,
            updated_at: new Date().toISOString(),
          });

          if (updates.status && updates.status !== node.status) {
            await dal.logsDal.create({
              plan_node_id: nodeId,
              user_id: userId,
              content: `Updated status to ${updates.status}`,
              log_type: 'progress',
            });
          }

          return { node: updated };
        },
      }],
    },
    {
      id: 'move-node',
      description: 'Move a node to a new parent',
      steps: [{
        name: 'move-node-step',
        run: async (ctx) => {
          const dal = require('../db/dal.cjs');
          const { nodeId, planId, newParentId, userId } = ctx.workflowInput();

          const node = await dal.nodesDal.getById(nodeId);
          if (!node) throw new Error('Node not found');

          const siblings = await dal.nodesDal.getByPlanId(planId);
          const newSiblings = siblings.filter(n => n.parent_id === newParentId);

          const updated = await dal.nodesDal.update(nodeId, {
            parent_id: newParentId,
            order_index: newSiblings.length,
            updated_at: new Date().toISOString(),
          });

          await dal.logsDal.create({
            plan_node_id: nodeId,
            user_id: userId,
            content: 'Moved to new parent',
            log_type: 'progress',
          });

          return { node: updated };
        },
      }],
    },
  ];
}

module.exports = { getNodeWorkflows };
