const { supabaseAdmin: supabase } = require('../config/supabase');

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

      // Get assignments
      const { data: assignments, error } = await supabase
        .from('node_assignments')
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

      res.status(201).json(assignment);
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

      // Get owner details from users table
      const { data: owner } = await supabase
        .from('users')
        .select('id, email, name')
        .eq('id', plan.owner_id)
        .single();

      // Get all collaborators
      const { data: collaborators } = await supabase
        .from('plan_collaborators')
        .select(`
          user_id,
          role
        `)
        .eq('plan_id', planId);

      // Get user details for collaborators
      const collaboratorIds = collaborators ? collaborators.map(c => c.user_id) : [];
      let collaboratorUsers = [];
      if (collaboratorIds.length > 0) {
        const { data: users } = await supabase
          .from('users')
          .select('id, email, name')
          .in('id', collaboratorIds);
        collaboratorUsers = users || [];
      }

      // Combine owner and collaborators
      const users = [];
      
      if (owner) {
        users.push({
          id: owner.id,
          email: owner.email,
          name: owner.name || owner.email,
          role: 'owner'
        });
      }

      if (collaborators) {
        collaborators.forEach(collab => {
          const user = collaboratorUsers.find(u => u.id === collab.user_id);
          if (user) {
            users.push({
              id: user.id,
              email: user.email,
              name: user.name || user.email,
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
