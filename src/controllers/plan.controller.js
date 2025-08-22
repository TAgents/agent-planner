const { v4: uuidv4 } = require('uuid');
const { supabaseAdmin: supabase } = require('../config/supabase');

/**
 * Calculate progress percentage for a plan based on node completion
 * @param {string} planId - The ID of the plan
 * @returns {Promise<number>} - The calculated progress percentage (0-100)
 */
const calculatePlanProgress = async (planId) => {
  // Fetch all nodes for the plan
  const { data: nodes, error } = await supabase
    .from('plan_nodes')
    .select('id, status')
    .eq('plan_id', planId);
  
  if (error || !nodes || nodes.length === 0) {
    return 0; // Return 0 progress if there's an error or no nodes
  }
  
  // Calculate the percentage of completed nodes
  const totalNodes = nodes.length;
  const completedNodes = nodes.filter(node => node.status === 'completed').length;
  
  return Math.round((completedNodes / totalNodes) * 100);
};

/**
 * List all plans accessible to the user
 */
const listPlans = async (req, res, next) => {
  try {
    const userId = req.user.id;

    // Query plans that the user owns or is a collaborator on
    const { data: ownedPlans, error: ownedError } = await supabase
      .from('plans')
      .select('id, title, description, status, created_at, updated_at')
      .eq('owner_id', userId);

    if (ownedError) {
      return res.status(500).json({ error: ownedError.message });
    }

    // Get plans where the user is a collaborator
    const { data: collaborations, error: collabError } = await supabase
      .from('plan_collaborators')
      .select('plan_id, role')
      .eq('user_id', userId);

    if (collabError) {
      return res.status(500).json({ error: collabError.message });
    }

    // If user has collaborations, fetch those plans
    let sharedPlans = [];
    if (collaborations && collaborations.length > 0) {
      const sharedPlanIds = collaborations.map(collab => collab.plan_id);
      
      const { data: sharedData, error: sharedError } = await supabase
        .from('plans')
        .select('id, title, description, status, created_at, updated_at')
        .in('id', sharedPlanIds);

      if (sharedError) {
        return res.status(500).json({ error: sharedError.message });
      }

      // Add collaboration role to each plan
      sharedPlans = sharedData.map(plan => {
        const collab = collaborations.find(c => c.plan_id === plan.id);
        return {
          ...plan,
          role: collab ? collab.role : null,
        };
      });
    }

    // Mark owned plans with owner role
    const ownedWithRole = ownedPlans.map(plan => ({
      ...plan,
      role: 'owner',
    }));

    // Combine owned and shared plans
    const allPlans = [...ownedWithRole, ...sharedPlans];

    // Calculate progress for each plan
    const plansWithProgress = await Promise.all(
      allPlans.map(async (plan) => {
        const progress = await calculatePlanProgress(plan.id);
        return {
          ...plan,
          progress
        };
      })
    );

    res.json(plansWithProgress);
  } catch (error) {
    next(error);
  }
};

/**
 * Create a new plan
 */
const createPlan = async (req, res, next) => {
  try {
    const { title, description, status, metadata } = req.body;
    const userId = req.user.id;

    if (!title) {
      return res.status(400).json({ error: 'Title is required' });
    }

    const planId = uuidv4();
    const now = new Date();

    // Create the plan
    const { error: planError } = await supabase
      .from('plans')
      .insert([
        {
          id: planId,
          title,
          description: description || '',
          owner_id: userId,
          created_at: now,
          updated_at: now,
          status: status || 'draft',
          metadata: metadata || {},
        },
      ]);

    if (planError) {
      return res.status(400).json({ error: planError.message });
    }

    // Create the root node for the plan
    const { error: nodeError } = await supabase
      .from('plan_nodes')
      .insert([
        {
          id: uuidv4(),
          plan_id: planId,
          parent_id: null, // Root node has no parent
          node_type: 'root',
          title: title,
          description: description || '',
          status: 'not_started',
          order_index: 0,
          created_at: now,
          updated_at: now,
          context: description || '',
        },
      ]);

    if (nodeError) {
      return res.status(400).json({ error: nodeError.message });
    }

    // Return the newly created plan
    const { data: newPlan, error: fetchError } = await supabase
      .from('plans')
      .select('id, title, description, status, created_at, updated_at')
      .eq('id', planId)
      .single();

    if (fetchError) {
      return res.status(500).json({ error: fetchError.message });
    }

    // Add progress (will be 0 for a new plan)
    newPlan.progress = 0;

    res.status(201).json(newPlan);
  } catch (error) {
    next(error);
  }
};

/**
 * Get a specific plan with its root node
 */
const getPlan = async (req, res, next) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    // First check if the user has access to this plan
    const hasAccess = await checkPlanAccess(id, userId);
    if (!hasAccess) {
      return res.status(403).json({ error: 'You do not have access to this plan' });
    }

    // Get the plan
    const { data: plan, error: planError } = await supabase
      .from('plans')
      .select('id, title, description, status, created_at, updated_at, owner_id, metadata')
      .eq('id', id)
      .single();

    if (planError) {
      if (planError.code === 'PGRST116') {
        return res.status(404).json({ error: 'Plan not found' });
      }
      return res.status(500).json({ error: planError.message });
    }

    // Get the root node
    const { data: rootNode, error: nodeError } = await supabase
      .from('plan_nodes')
      .select('id, node_type, title, description, status, created_at, updated_at, context, agent_instructions, acceptance_criteria')
      .eq('plan_id', id)
      .eq('node_type', 'root')
      .single();

    if (nodeError) {
      return res.status(500).json({ error: nodeError.message });
    }

    // Calculate progress for this plan
    const progress = await calculatePlanProgress(id);

    // Add node information and progress to the plan
    const result = {
      ...plan,
      root_node: rootNode,
      is_owner: plan.owner_id === userId,
      progress
    };

    res.json(result);
  } catch (error) {
    next(error);
  }
};

/**
 * Update a plan's properties
 */
const updatePlan = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { title, description, status, metadata } = req.body;
    const userId = req.user.id;

    // Check if the user has access to this plan
    const hasAccess = await checkPlanAccess(id, userId, ['owner', 'admin']);
    if (!hasAccess) {
      return res.status(403).json({ error: 'You do not have permission to update this plan' });
    }

    // Update fields that were provided
    const updates = { updated_at: new Date() };
    if (title !== undefined) updates.title = title;
    if (description !== undefined) updates.description = description;
    if (status !== undefined) updates.status = status;
    if (metadata !== undefined) updates.metadata = metadata;

    // Update the plan
    const { data, error } = await supabase
      .from('plans')
      .update(updates)
      .eq('id', id)
      .select();

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    if (data.length === 0) {
      return res.status(404).json({ error: 'Plan not found' });
    }

    // Also update the root node if title or description changed
    if (title !== undefined || description !== undefined) {
      const nodeUpdates = { updated_at: new Date() };
      if (title !== undefined) nodeUpdates.title = title;
      if (description !== undefined) nodeUpdates.description = description;
      if (description !== undefined) nodeUpdates.context = description;

      await supabase
        .from('plan_nodes')
        .update(nodeUpdates)
        .eq('plan_id', id)
        .eq('node_type', 'root');
    }

    // Calculate progress
    const progress = await calculatePlanProgress(id);
    data[0].progress = progress;

    res.json(data[0]);
  } catch (error) {
    next(error);
  }
};

/**
 * Delete a plan (or archive it)
 */
const deletePlan = async (req, res, next) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    const { archive } = req.query; // If archive=true, archive instead of delete

    // Check if the user is the owner of this plan
    const { data: plan, error: planError } = await supabase
      .from('plans')
      .select('owner_id')
      .eq('id', id)
      .single();

    if (planError) {
      if (planError.code === 'PGRST116') {
        return res.status(404).json({ error: 'Plan not found' });
      }
      return res.status(500).json({ error: planError.message });
    }

    if (plan.owner_id !== userId) {
      return res.status(403).json({ error: 'Only the plan owner can delete this plan' });
    }

    // Archive instead of delete if requested
    if (archive === 'true') {
      const { error } = await supabase
        .from('plans')
        .update({ status: 'archived', updated_at: new Date() })
        .eq('id', id);

      if (error) {
        return res.status(400).json({ error: error.message });
      }

      return res.status(200).json({ message: 'Plan archived successfully' });
    }

    // Otherwise, delete the plan and all associated data
    // Note: In a real production system, you might want to use a transaction here
    
    // Delete plan collaborators
    await supabase
      .from('plan_collaborators')
      .delete()
      .eq('plan_id', id);
    
    // Delete plan comments
    await supabase
      .from('plan_comments')
      .delete()
      .match({ 'plan_id': id });
    
    // Delete plan node labels
    await supabase
      .from('plan_node_labels')
      .delete()
      .match({ 'plan_id': id });
    
    // Delete plan node artifacts
    await supabase
      .from('plan_node_artifacts')
      .delete()
      .match({ 'plan_id': id });
    
    // Delete plan node logs
    await supabase
      .from('plan_node_logs')
      .delete()
      .match({ 'plan_id': id });
    
    // Delete plan nodes
    await supabase
      .from('plan_nodes')
      .delete()
      .eq('plan_id', id);
    
    // Finally, delete the plan itself
    const { error } = await supabase
      .from('plans')
      .delete()
      .eq('id', id);

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    res.status(204).send();
  } catch (error) {
    next(error);
  }
};

/**
 * List collaborators on a plan
 */
const listCollaborators = async (req, res, next) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    // Check if the user has access to this plan
    const hasAccess = await checkPlanAccess(id, userId);
    if (!hasAccess) {
      return res.status(403).json({ error: 'You do not have access to this plan' });
    }

    // Get collaborators along with user info
    const { data, error } = await supabase
      .from('plan_collaborators')
      .select(`
        id, role, created_at,
        user:user_id (id, name, email)
      `)
      .eq('plan_id', id);

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    // Get the plan owner
    const { data: plan, error: planError } = await supabase
      .from('plans')
      .select('owner_id')
      .eq('id', id)
      .single();

    if (planError) {
      return res.status(500).json({ error: planError.message });
    }

    // Get owner info
    const { data: owner, error: ownerError } = await supabase
      .from('users')
      .select('id, name, email')
      .eq('id', plan.owner_id)
      .single();

    if (ownerError) {
      return res.status(500).json({ error: ownerError.message });
    }

    // Format collaborators
    const collaborators = data.map(collab => ({
      id: collab.id,
      user: collab.user,
      role: collab.role,
      created_at: collab.created_at,
    }));

    // Add owner to the response
    const result = {
      owner: owner,
      collaborators: collaborators,
    };

    res.json(result);
  } catch (error) {
    next(error);
  }
};

/**
 * Add a collaborator to a plan
 */
const addCollaborator = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { email, role } = req.body;
    const userId = req.user.id;

    if (!email || !role) {
      return res.status(400).json({ error: 'Email and role are required' });
    }

    // Check if the user is the owner or admin of this plan
    const hasAccess = await checkPlanAccess(id, userId, ['owner', 'admin']);
    if (!hasAccess) {
      return res.status(403).json({ error: 'You do not have permission to add collaborators' });
    }

    // Find the user by email
    const { data: user, error: userError } = await supabase
      .from('users')
      .select('id')
      .eq('email', email)
      .single();

    if (userError) {
      if (userError.code === 'PGRST116') {
        return res.status(404).json({ error: 'User not found with this email' });
      }
      return res.status(500).json({ error: userError.message });
    }

    // Check if the user is already a collaborator
    const { data: existingCollab, error: collabError } = await supabase
      .from('plan_collaborators')
      .select('id')
      .eq('plan_id', id)
      .eq('user_id', user.id);

    if (collabError) {
      return res.status(500).json({ error: collabError.message });
    }

    if (existingCollab && existingCollab.length > 0) {
      // Update the existing collaboration
      const { data, error } = await supabase
        .from('plan_collaborators')
        .update({ role })
        .eq('id', existingCollab[0].id)
        .select();

      if (error) {
        return res.status(400).json({ error: error.message });
      }

      return res.json(data[0]);
    }

    // Add new collaborator
    const { data, error } = await supabase
      .from('plan_collaborators')
      .insert([
        {
          id: uuidv4(),
          plan_id: id,
          user_id: user.id,
          role,
          created_at: new Date(),
        },
      ])
      .select();

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    res.status(201).json(data[0]);
  } catch (error) {
    next(error);
  }
};

/**
 * Remove a collaborator from a plan
 */
const removeCollaborator = async (req, res, next) => {
  try {
    const { id, userId: collaboratorId } = req.params;
    const currentUserId = req.user.id;

    // Check if the current user is the owner or admin of this plan
    const hasAccess = await checkPlanAccess(id, currentUserId, ['owner', 'admin']);
    
    // Users can also remove themselves
    const isSelf = currentUserId === collaboratorId;
    
    if (!hasAccess && !isSelf) {
      return res.status(403).json({ error: 'You do not have permission to remove collaborators' });
    }

    // Remove the collaborator
    const { error } = await supabase
      .from('plan_collaborators')
      .delete()
      .eq('plan_id', id)
      .eq('user_id', collaboratorId);

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    res.status(204).send();
  } catch (error) {
    next(error);
  }
};

/**
 * Get a compiled context of the entire plan suitable for agents
 */
const getPlanContext = async (req, res, next) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    // Check if the user has access to this plan
    const hasAccess = await checkPlanAccess(id, userId);
    if (!hasAccess) {
      return res.status(403).json({ error: 'You do not have access to this plan' });
    }

    // Get the plan
    const { data: plan, error: planError } = await supabase
      .from('plans')
      .select('id, title, description, status, created_at, updated_at, metadata')
      .eq('id', id)
      .single();

    if (planError) {
      return res.status(500).json({ error: planError.message });
    }

    // Get all nodes for the plan
    const { data: nodes, error: nodesError } = await supabase
      .from('plan_nodes')
      .select('id, parent_id, node_type, title, description, status, context, agent_instructions, acceptance_criteria')
      .eq('plan_id', id)
      .order('created_at', { ascending: true });

    if (nodesError) {
      return res.status(500).json({ error: nodesError.message });
    }

    // Build hierarchical structure
    const rootNode = nodes.find(node => node.node_type === 'root');
    if (!rootNode) {
      return res.status(500).json({ error: 'Plan structure is invalid (no root node)' });
    }

    // Build node hierarchy
    const nodeMap = {};
    nodes.forEach(node => {
      nodeMap[node.id] = {
        ...node,
        children: [],
      };
    });

    // Connect parent-child relationships
    nodes.forEach(node => {
      if (node.parent_id && nodeMap[node.parent_id]) {
        nodeMap[node.parent_id].children.push(nodeMap[node.id]);
      }
    });

    // Calculate progress
    const progress = await calculatePlanProgress(id);

    // Compile context
    const context = {
      plan: {
        id: plan.id,
        title: plan.title,
        description: plan.description,
        status: plan.status,
        created_at: plan.created_at,
        updated_at: plan.updated_at,
        metadata: plan.metadata,
        progress: progress
      },
      structure: nodeMap[rootNode.id],
    };

    res.json(context);
  } catch (error) {
    next(error);
  }
};

/**
 * Get plan progress
 */
const getPlanProgress = async (req, res, next) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    // Check if the user has access to this plan
    const hasAccess = await checkPlanAccess(id, userId);
    if (!hasAccess) {
      return res.status(403).json({ error: 'You do not have access to this plan' });
    }

    // Get all nodes for the plan
    const { data: nodes, error } = await supabase
      .from('plan_nodes')
      .select('status')
      .eq('plan_id', id);
    
    if (error) {
      return res.status(500).json({ error: 'Failed to fetch nodes' });
    }
    
    // Calculate progress
    const totalNodes = nodes.length;
    const completedNodes = nodes.filter(n => n.status === 'completed').length;
    const progress = totalNodes > 0 ? Math.round((completedNodes / totalNodes) * 100) : 0;
    
    res.json({ 
      progress, 
      totalNodes, 
      completedNodes,
      inProgress: nodes.filter(n => n.status === 'in_progress').length,
      notStarted: nodes.filter(n => n.status === 'not_started').length,
      blocked: nodes.filter(n => n.status === 'blocked').length
    });
  } catch (error) {
    console.error('Error calculating plan progress:', error);
    res.status(500).json({ error: 'Failed to calculate progress' });
  }
};

/**
 * Helper function to check if a user has access to a plan
 * @param {string} planId - Plan ID
 * @param {string} userId - User ID
 * @param {string[]} [roles] - Optional array of required roles (e.g., ['owner', 'admin'])
 * @returns {Promise<boolean>} - Whether the user has access
 */
const checkPlanAccess = async (planId, userId, roles = []) => {
  // Check if the user is the owner
  const { data: plan, error: planError } = await supabase
    .from('plans')
    .select('owner_id')
    .eq('id', planId)
    .single();

  if (planError) {
    // Plan not found or other error
    return false;
  }

  // If user is the owner, they always have access
  if (plan.owner_id === userId) {
    return roles.length === 0 || roles.includes('owner');
  }

  // Otherwise, check if they're a collaborator with appropriate role
  const { data: collab, error: collabError } = await supabase
    .from('plan_collaborators')
    .select('role')
    .eq('plan_id', planId)
    .eq('user_id', userId)
    .single();

  if (collabError) {
    // Not a collaborator or other error
    return false;
  }

  // If roles specified, check if the user's role is included
  if (roles.length > 0) {
    return roles.includes(collab.role);
  }

  // Otherwise, any collaborator role grants access
  return true;
};

module.exports = {
  listPlans,
  createPlan,
  getPlan,
  updatePlan,
  deletePlan,
  listCollaborators,
  addCollaborator,
  removeCollaborator,
  getPlanContext,
  getPlanProgress,
};
