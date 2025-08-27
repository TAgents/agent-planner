const { supabase } = require('../config/supabase');

/**
 * Assignment Controller
 * Handles user assignments to nodes
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
      const { data: plan, error: planError } = await supabase
        .from('plans')
        .select('id, owner_id')
        .eq('id', planId)
        .single();

      if (planError || !plan) {
        return res.status(404).json({ error: 'Plan not found' });
      }

      // Check if user has access
      const isOwner = plan.owner_id === userId;
      if (!isOwner) {
        const { data: collaborator } = await supabase
          .from('plan_collaborators')
          .select('role')
          .eq('plan_id', planId)
          .eq('user_id', userId)
          .single();

        if (!collaborator) {
          return res.status(403).json({ error: 'Access denied' });
        }
      }

      // Get assignments with user details
      const { data: assignments, error } = await supabase
        .from('node_assignments_with_users')
        .select('*')
        .eq('node_id', nodeId);

      if (error) {
        console.error('Error fetching node assignments:', error);
        return res.status(500).json({ error: 'Failed to fetch assignments' });
      }

      res.json(assignments || []);
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
      const { data: node, error: nodeError } = await supabase
        .from('plan_nodes')
        .select('id, plan_id')
        .eq('id', nodeId)
        .eq('plan_id', planId)
        .single();

      if (nodeError || !node) {
        return res.status(404).json({ error: 'Node not found in this plan' });
      }

      // Verify user has permission to assign (owner or admin/editor)
      const { data: plan, error: planError } = await supabase
        .from('plans')
        .select('owner_id')
        .eq('id', planId)
        .single();

      if (planError || !plan) {
        return res.status(404).json({ error: 'Plan not found' });
      }

      const isOwner = plan.owner_id === userId;
      let hasPermission = isOwner;

      if (!isOwner) {
        const { data: collaborator } = await supabase
          .from('plan_collaborators')
          .select('role')
          .eq('plan_id', planId)
          .eq('user_id', userId)
          .single();

        hasPermission = collaborator && ['admin', 'editor'].includes(collaborator.role);
      }

      if (!hasPermission) {
        return res.status(403).json({ error: 'Insufficient permissions to assign users' });
      }

      // Verify the assignee is a collaborator on the plan
      const isAssigneeOwner = plan.owner_id === assigneeId;
      if (!isAssigneeOwner) {
        const { data: assigneeCollaborator } = await supabase
          .from('plan_collaborators')
          .select('user_id')
          .eq('plan_id', planId)
          .eq('user_id', assigneeId)
          .single();

        if (!assigneeCollaborator) {
          return res.status(400).json({ 
            error: 'User must be a collaborator on the plan to be assigned to nodes' 
          });
        }
      }

      // Check if already assigned
      const { data: existingAssignment } = await supabase
        .from('node_assignments')
        .select('id')
        .eq('node_id', nodeId)
        .eq('user_id', assigneeId)
        .single();

      if (existingAssignment) {
        return res.status(400).json({ error: 'User is already assigned to this node' });
      }

      // Create the assignment
      const { data: assignment, error: assignError } = await supabase
        .from('node_assignments')
        .insert({
          node_id: nodeId,
          user_id: assigneeId,
          assigned_by: userId
        })
        .select()
        .single();

      if (assignError) {
        console.error('Error creating assignment:', assignError);
        return res.status(500).json({ error: 'Failed to create assignment' });
      }

      // Get the assignment with user details
      const { data: fullAssignment } = await supabase
        .from('node_assignments_with_users')
        .select('*')
        .eq('id', assignment.id)
        .single();

      res.status(201).json(fullAssignment || assignment);
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
      const { user_id: assigneeId } = req.body;
      const userId = req.user.id;

      if (!assigneeId) {
        return res.status(400).json({ error: 'User ID is required' });
      }

      // Verify the node belongs to the plan
      const { data: node, error: nodeError } = await supabase
        .from('plan_nodes')
        .select('id, plan_id')
        .eq('id', nodeId)
        .eq('plan_id', planId)
        .single();

      if (nodeError || !node) {
        return res.status(404).json({ error: 'Node not found in this plan' });
      }

      // Verify user has permission to unassign (owner or admin/editor)
      const { data: plan, error: planError } = await supabase
        .from('plans')
        .select('owner_id')
        .eq('id', planId)
        .single();

      if (planError || !plan) {
        return res.status(404).json({ error: 'Plan not found' });
      }

      const isOwner = plan.owner_id === userId;
      let hasPermission = isOwner;

      if (!isOwner) {
        const { data: collaborator } = await supabase
          .from('plan_collaborators')
          .select('role')
          .eq('plan_id', planId)
          .eq('user_id', userId)
          .single();

        hasPermission = collaborator && ['admin', 'editor'].includes(collaborator.role);
      }

      if (!hasPermission) {
        return res.status(403).json({ error: 'Insufficient permissions to unassign users' });
      }

      // Delete the assignment
      const { error: deleteError } = await supabase
        .from('node_assignments')
        .delete()
        .eq('node_id', nodeId)
        .eq('user_id', assigneeId);

      if (deleteError) {
        console.error('Error deleting assignment:', deleteError);
        return res.status(500).json({ error: 'Failed to delete assignment' });
      }

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
      const { data: plan, error: planError } = await supabase
        .from('plans')
        .select('id, owner_id')
        .eq('id', planId)
        .single();

      if (planError || !plan) {
        return res.status(404).json({ error: 'Plan not found' });
      }

      // Check if user has access
      const isOwner = plan.owner_id === userId;
      if (!isOwner) {
        const { data: collaborator } = await supabase
          .from('plan_collaborators')
          .select('role')
          .eq('plan_id', planId)
          .eq('user_id', userId)
          .single();

        if (!collaborator) {
          return res.status(403).json({ error: 'Access denied' });
        }
      }

      // Get owner details
      const { data: owner } = await supabase
        .from('auth.users')
        .select('id, email, raw_user_meta_data')
        .eq('id', plan.owner_id)
        .single();

      // Get all collaborators
      const { data: collaborators } = await supabase
        .from('plan_collaborators')
        .select(`
          user_id,
          role,
          user:auth.users!user_id (
            id,
            email,
            raw_user_meta_data
          )
        `)
        .eq('plan_id', planId);

      // Combine owner and collaborators
      const users = [];
      
      if (owner) {
        users.push({
          id: owner.id,
          email: owner.email,
          name: owner.raw_user_meta_data?.name || owner.email,
          role: 'owner'
        });
      }

      if (collaborators) {
        collaborators.forEach(collab => {
          if (collab.user) {
            users.push({
              id: collab.user.id,
              email: collab.user.email,
              name: collab.user.raw_user_meta_data?.name || collab.user.email,
              role: collab.role
            });
          }
        });
      }

      res.json(users);
    } catch (error) {
      console.error('Error in getAvailableUsers:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
};

module.exports = assignmentController;
