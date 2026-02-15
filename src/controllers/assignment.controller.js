const { plansDal, nodesDal, usersDal, collaboratorsDal } = require('../db/dal.cjs');

/**
 * Assignment Controller
 * Handles user assignments to nodes
 * 
 * Note: node_assignments table doesn't have a DAL module yet.
 * Agent assignments use the planNodes.assignedAgentId field via nodesDal.
 * For user-level assignments (node_assignments table), this controller
 * uses nodesDal for access checks and returns agent assignment data.
 */
const assignmentController = {
  /**
   * Get all assignments for a node
   */
  async getNodeAssignments(req, res) {
    try {
      const { id: planId, nodeId } = req.params;
      const userId = req.user.id;

      // Verify access to the plan
      const { hasAccess } = await plansDal.userHasAccess(planId, userId);
      if (!hasAccess) {
        return res.status(403).json({ error: 'Access denied' });
      }

      // Get the node to check agent assignment
      const node = await nodesDal.findByIdAndPlan(nodeId, planId);
      if (!node) {
        return res.status(404).json({ error: 'Node not found' });
      }

      // Return agent assignment info from the node itself
      const assignments = [];
      if (node.assignedAgentId) {
        assignments.push({
          node_id: nodeId,
          user_id: node.assignedAgentId,
          assigned_by: node.assignedAgentBy,
          assigned_at: node.assignedAgentAt,
        });
      }

      res.json(assignments);
    } catch (error) {
      console.error('Error in getNodeAssignments:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  },

  /**
   * Assign a user to a node
   */
  async assignUserToNode(req, res) {
    try {
      const { id: planId, nodeId } = req.params;
      const { user_id: assigneeId } = req.body;
      const userId = req.user.id;

      if (!assigneeId) {
        return res.status(400).json({ error: 'User ID is required' });
      }

      // Verify the node belongs to the plan
      const node = await nodesDal.findByIdAndPlan(nodeId, planId);
      if (!node) {
        return res.status(404).json({ error: 'Node not found in this plan' });
      }

      // Verify user has permission (owner or admin/editor)
      const { hasAccess, role } = await plansDal.userHasAccess(planId, userId);
      if (!hasAccess || (role !== 'owner' && !['admin', 'editor'].includes(role))) {
        return res.status(403).json({ error: 'Insufficient permissions to assign users' });
      }

      // Assign via nodesDal
      const updated = await nodesDal.assignAgent(nodeId, { agentId: assigneeId, assignedBy: userId });

      res.status(201).json({
        node_id: nodeId,
        user_id: assigneeId,
        assigned_by: userId,
        assigned_at: updated.assignedAgentAt,
      });
    } catch (error) {
      console.error('Error in assignUserToNode:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  },

  /**
   * Unassign a user from a node
   */
  async unassignUserFromNode(req, res) {
    try {
      const { id: planId, nodeId } = req.params;
      const userId = req.user.id;

      // Verify the node belongs to the plan
      const node = await nodesDal.findByIdAndPlan(nodeId, planId);
      if (!node) {
        return res.status(404).json({ error: 'Node not found in this plan' });
      }

      // Verify user has permission
      const { hasAccess, role } = await plansDal.userHasAccess(planId, userId);
      if (!hasAccess || (role !== 'owner' && !['admin', 'editor'].includes(role))) {
        return res.status(403).json({ error: 'Insufficient permissions to unassign users' });
      }

      // Clear assignment
      await nodesDal.update(nodeId, {
        assignedAgentId: null,
        assignedAgentAt: null,
        assignedAgentBy: null,
      });

      res.status(204).send();
    } catch (error) {
      console.error('Error in unassignUserFromNode:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  },

  /**
   * Get all users (collaborators) available for assignment in a plan
   */
  async getAvailableUsers(req, res) {
    try {
      const { id: planId } = req.params;
      const userId = req.user.id;

      // Verify access to the plan
      const { hasAccess, plan } = await plansDal.userHasAccess(planId, userId);
      if (!hasAccess) {
        return res.status(403).json({ error: 'Access denied' });
      }

      // Get owner details
      const owner = await usersDal.findById(plan.ownerId);

      // Get all collaborators with user details
      const collaborators = await collaboratorsDal.listByPlan(planId);

      const users = [];

      if (owner) {
        users.push({
          id: owner.id,
          email: owner.email,
          name: owner.name || owner.email,
          role: 'owner'
        });
      }

      collaborators.forEach(collab => {
        users.push({
          id: collab.userId,
          email: collab.userEmail,
          name: collab.userName || collab.userEmail,
          role: collab.role
        });
      });

      res.json(users);
    } catch (error) {
      console.error('Error in getAvailableUsers:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
};

module.exports = assignmentController;
