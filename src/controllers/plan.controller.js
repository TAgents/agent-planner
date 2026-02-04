const { v4: uuidv4 } = require('uuid');
const { supabaseAdmin: supabase } = require('../config/supabase');
const { broadcastPlanUpdate, broadcastToAll } = require('../websocket/broadcast');
const {
  createPlanCreatedMessage,
  createPlanUpdatedMessage,
  createPlanDeletedMessage
} = require('../websocket/message-schema');

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
      .select('id, title, description, status, created_at, updated_at, owner_id, visibility, is_public, github_repo_owner, github_repo_name, github_repo_url, github_repo_full_name')
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
        .select('id, title, description, status, created_at, updated_at, owner_id, visibility, is_public, github_repo_owner, github_repo_name, github_repo_url, github_repo_full_name')
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
    const { title, description, status, metadata, organization_id } = req.body;
    const userId = req.user.id;

    if (!title) {
      return res.status(400).json({ error: 'Title is required' });
    }

    // Validate organization membership if organization_id provided
    let validOrgId = null;
    if (organization_id) {
      const { data: membership } = await supabase
        .from('organization_members')
        .select('role')
        .eq('organization_id', organization_id)
        .eq('user_id', userId)
        .single();
      
      if (!membership) {
        return res.status(403).json({ error: 'You must be a member of the organization to create plans in it' });
      }
      validOrgId = organization_id;
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
          organization_id: validOrgId,
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
      .select('id, title, description, status, created_at, updated_at, owner_id')
      .eq('id', planId)
      .single();

    if (fetchError) {
      return res.status(500).json({ error: fetchError.message });
    }

    // Add progress (will be 0 for a new plan)
    newPlan.progress = 0;

    // Broadcast plan created event to all users (so plans list updates)
    const userName = req.user.name || req.user.email;
    const message = createPlanCreatedMessage(newPlan, req.user.id, userName);
    await broadcastToAll(message);

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
      .select('id, title, description, status, created_at, updated_at, owner_id, metadata, visibility, is_public, github_repo_owner, github_repo_name, github_repo_url, github_repo_full_name')
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
      visibility: plan.visibility || 'private',
      is_public: plan.is_public || false,
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
    const { title, description, status, metadata, organization_id } = req.body;
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
    
    // Handle organization assignment
    if (organization_id !== undefined) {
      if (organization_id === null) {
        // Allow removing org assignment
        updates.organization_id = null;
      } else {
        // Verify user is member of the target organization
        const { data: membership } = await supabase
          .from('organization_members')
          .select('role')
          .eq('organization_id', organization_id)
          .eq('user_id', userId)
          .single();
        
        if (!membership) {
          return res.status(403).json({ error: 'You must be a member of the organization to assign plans to it' });
        }
        updates.organization_id = organization_id;
      }
    }

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

    // Broadcast plan updated event
    const userName = req.user.name || req.user.email;
    const message = createPlanUpdatedMessage(data[0], req.user.id, userName);
    await broadcastPlanUpdate(id, message);

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

      // Broadcast plan updated event (status changed to archived)
      const userName = req.user.name || req.user.email;
      const { data: archivedPlan } = await supabase
        .from('plans')
        .select('*')
        .eq('id', id)
        .single();

      if (archivedPlan) {
        const message = createPlanUpdatedMessage(archivedPlan, userId, userName);
        await broadcastPlanUpdate(id, message);
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

    // Broadcast plan deleted event to all users (so plans list updates)
    const userName = req.user.name || req.user.email;
    const message = createPlanDeletedMessage(id, userId, userName);
    await broadcastToAll(message);

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
    const { user_id, email, role } = req.body;
    const userId = req.user.id;

    // Either user_id or email must be provided
    if (!user_id && !email) {
      return res.status(400).json({ error: 'Either user_id or email is required' });
    }

    if (!role) {
      return res.status(400).json({ error: 'Role is required' });
    }

    // Check if the user is the owner or admin of this plan
    const hasAccess = await checkPlanAccess(id, userId, ['owner', 'admin']);
    if (!hasAccess) {
      return res.status(403).json({ error: 'You do not have permission to add collaborators' });
    }

    let targetUserId = user_id;

    // If email provided instead of user_id, look up the user
    if (!targetUserId && email) {
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
      targetUserId = user.id;
    }

    // Check if the user is already a collaborator
    const { data: existingCollab, error: collabError } = await supabase
      .from('plan_collaborators')
      .select('id')
      .eq('plan_id', id)
      .eq('user_id', targetUserId);

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
          user_id: targetUserId,
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
      .select('id, title, description, status, created_at, updated_at, metadata, github_repo_owner, github_repo_name, github_repo_url, github_repo_full_name')
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
        github_repo_owner: plan.github_repo_owner,
        github_repo_name: plan.github_repo_name,
        github_repo_url: plan.github_repo_url,
        github_repo_full_name: plan.github_repo_full_name,
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
      total_nodes: totalNodes, 
      completed_nodes: completedNodes,
      in_progress_nodes: nodes.filter(n => n.status === 'in_progress').length,
      not_started_nodes: nodes.filter(n => n.status === 'not_started').length,
      blocked_nodes: nodes.filter(n => n.status === 'blocked').length,
      completion_percentage: progress,
      // Also include camelCase for backwards compatibility
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

/**
 * List all public plans (no authentication required)
 */
const listPublicPlans = async (req, res, next) => {
  try {
    const {
      sortBy = 'recent',
      limit = 12,
      page = 1,
      status,
      hasGithubLink,
      owner,
      updatedAfter,
      updatedBefore,
      search
    } = req.query;

    const limitNum = Math.min(parseInt(limit) || 12, 100); // Max 100
    const pageNum = Math.max(parseInt(page) || 1, 1); // Min page 1
    const offsetNum = (pageNum - 1) * limitNum;

    // Validate sortBy parameter
    if (!['recent', 'alphabetical', 'completion'].includes(sortBy)) {
      return res.status(400).json({
        error: 'Invalid sortBy value. Must be one of: recent, alphabetical, completion'
      });
    }

    // Validate filter values
    if (status && !['active', 'completed', 'draft', 'archived'].includes(status)) {
      return res.status(400).json({
        error: 'Invalid status value. Must be one of: active, completed, draft, archived'
      });
    }

    if (hasGithubLink && !['true', 'false'].includes(hasGithubLink)) {
      return res.status(400).json({
        error: 'Invalid hasGithubLink value. Must be "true" or "false"'
      });
    }

    // Validate date formats
    if (updatedAfter) {
      const date = new Date(updatedAfter);
      if (isNaN(date.getTime())) {
        return res.status(400).json({
          error: 'Invalid updatedAfter value. Must be a valid ISO date string'
        });
      }
    }

    if (updatedBefore) {
      const date = new Date(updatedBefore);
      if (isNaN(date.getTime())) {
        return res.status(400).json({
          error: 'Invalid updatedBefore value. Must be a valid ISO date string'
        });
      }
    }

    // Build query for public plans
    let query = supabase
      .from('plans')
      .select('id, title, description, status, created_at, updated_at, view_count, github_repo_owner, github_repo_name, owner_id', { count: 'exact' })
      .eq('visibility', 'public');

    // Apply status filter
    if (status) {
      query = query.eq('status', status);
    }

    // Apply GitHub link filter
    if (hasGithubLink === 'true') {
      query = query.not('github_repo_owner', 'is', null);
    } else if (hasGithubLink === 'false') {
      query = query.is('github_repo_owner', null);
    }

    // Apply owner filter (by user_id)
    if (owner) {
      query = query.eq('owner_id', owner);
    }

    // Apply date range filters
    if (updatedAfter) {
      query = query.gte('updated_at', updatedAfter);
    }

    if (updatedBefore) {
      query = query.lte('updated_at', updatedBefore);
    }

    // Apply sorting - for completion, we need to fetch all and sort in memory
    // For recent and alphabetical, we can use database sorting
    if (sortBy === 'recent') {
      query = query.order('updated_at', { ascending: false });
      // Apply pagination
      query = query.range(offsetNum, offsetNum + limitNum - 1);
    } else if (sortBy === 'alphabetical') {
      query = query.order('title', { ascending: true });
      // Apply pagination
      query = query.range(offsetNum, offsetNum + limitNum - 1);
    }
    // For completion sort, we'll handle pagination after sorting in memory

    const { data: plans, error, count } = await query;

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    // Fetch owner information and calculate stats for each plan
    let plansWithMetadata = await Promise.all(
      plans.map(async (plan) => {
        // Get owner info
        const { data: owner } = await supabase
          .from('users')
          .select('id, name, email, github_username, avatar_url')
          .eq('id', plan.owner_id)
          .single();

        // Get task counts
        const { data: nodes } = await supabase
          .from('plan_nodes')
          .select('id, status')
          .eq('plan_id', plan.id)
          .neq('node_type', 'root'); // Exclude root node from task count

        const task_count = nodes ? nodes.length : 0;
        const completed_count = nodes ? nodes.filter(n => n.status === 'completed').length : 0;
        const completion_percentage = task_count > 0 ? Math.round((completed_count / task_count) * 100) : 0;

        // Get star count
        const { count: starCount } = await supabase
          .from('plan_stars')
          .select('*', { count: 'exact', head: true })
          .eq('plan_id', plan.id);

        return {
          id: plan.id,
          title: plan.title,
          description: plan.description,
          status: plan.status,
          view_count: plan.view_count,
          created_at: plan.created_at,
          updated_at: plan.updated_at,
          github_repo_owner: plan.github_repo_owner,
          github_repo_name: plan.github_repo_name,
          owner: owner || { id: plan.owner_id, name: 'Unknown', email: '', github_username: null, avatar_url: null },
          task_count,
          completed_count,
          completion_percentage,
          star_count: starCount || 0
        };
      })
    );

    // Apply search filter (case-insensitive)
    if (search && search.trim()) {
      const searchLower = search.trim().toLowerCase();
      plansWithMetadata = plansWithMetadata.filter(plan => {
        const titleMatch = plan.title && plan.title.toLowerCase().includes(searchLower);
        const descMatch = plan.description && plan.description.toLowerCase().includes(searchLower);
        const usernameMatch = plan.owner.github_username && plan.owner.github_username.toLowerCase().includes(searchLower);
        const nameMatch = plan.owner.name && plan.owner.name.toLowerCase().includes(searchLower);

        return titleMatch || descMatch || usernameMatch || nameMatch;
      });
    }

    // Handle completion sorting - sort in memory and apply pagination
    // Note: When search is applied, we need to re-paginate after filtering
    let finalPlans = plansWithMetadata;
    let totalCount = count || 0;

    if (sortBy === 'completion') {
      // Sort by completion_percentage DESC
      finalPlans.sort((a, b) => b.completion_percentage - a.completion_percentage);
      // Apply pagination manually
      totalCount = finalPlans.length; // Update total if sorting in memory
      finalPlans = finalPlans.slice(offsetNum, offsetNum + limitNum);
    } else if (search && search.trim()) {
      // If search was applied, we need to re-paginate
      totalCount = finalPlans.length;
      finalPlans = finalPlans.slice(offsetNum, offsetNum + limitNum);
    }

    res.json({
      plans: finalPlans,
      total: totalCount,
      limit: limitNum,
      page: pageNum,
      total_pages: totalCount ? Math.ceil(totalCount / limitNum) : 0
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get a public plan (no authentication required)
 */
const getPublicPlan = async (req, res, next) => {
  try {
    const { id } = req.params;

    // Get the plan
    const { data: plan, error: planError } = await supabase
      .from('plans')
      .select('id, title, description, status, created_at, updated_at, owner_id, metadata, visibility, view_count, github_repo_owner, github_repo_name, github_repo_url, github_repo_full_name')
      .eq('id', id)
      .single();

    if (planError) {
      if (planError.code === 'PGRST116') {
        return res.status(404).json({ error: 'Plan not found' });
      }
      return res.status(500).json({ error: planError.message });
    }

    // Check if plan is public
    if (plan.visibility !== 'public') {
      return res.status(403).json({ error: 'This plan is not public' });
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

    // Get owner info
    const { data: owner } = await supabase
      .from('users')
      .select('id, name, email, github_username, avatar_url')
      .eq('id', plan.owner_id)
      .single();

    // Calculate progress for this plan
    const progress = await calculatePlanProgress(id);

    // Build response
    const result = {
      id: plan.id,
      title: plan.title,
      description: plan.description,
      status: plan.status,
      view_count: plan.view_count,
      created_at: plan.created_at,
      updated_at: plan.updated_at,
      github_repo_owner: plan.github_repo_owner,
      github_repo_name: plan.github_repo_name,
      github_repo_url: plan.github_repo_url,
      github_repo_full_name: plan.github_repo_full_name,
      metadata: plan.metadata,
      owner: owner || { id: plan.owner_id, name: 'Unknown', email: '', github_username: null, avatar_url: null },
      root_node: rootNode,
      progress
    };

    res.json(result);
  } catch (error) {
    next(error);
  }
};

/**
 * Get a public plan with full node hierarchy (no authentication required)
 */
const getPublicPlanById = async (req, res, next) => {
  try {
    const { id } = req.params;

    // Get the plan
    const { data: plan, error: planError } = await supabase
      .from('plans')
      .select('id, title, description, status, created_at, updated_at, owner_id, metadata, visibility, view_count, github_repo_owner, github_repo_name, github_repo_url, github_repo_full_name')
      .eq('id', id)
      .single();

    if (planError) {
      if (planError.code === 'PGRST116') {
        return res.status(404).json({ error: 'Plan not found' });
      }
      return res.status(500).json({ error: planError.message });
    }

    // Check if plan is public
    if (plan.visibility !== 'public') {
      return res.status(404).json({ error: 'Plan not found' });
    }

    // Get all nodes for the plan
    const { data: nodes, error: nodesError } = await supabase
      .from('plan_nodes')
      .select('id, parent_id, node_type, title, description, status, context, agent_instructions, acceptance_criteria, created_at, updated_at')
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

    // Get owner info
    const { data: owner } = await supabase
      .from('users')
      .select('id, name, email, github_username, avatar_url')
      .eq('id', plan.owner_id)
      .single();

    // Calculate progress for this plan
    const progress = await calculatePlanProgress(id);

    // Build response
    const result = {
      plan: {
        id: plan.id,
        title: plan.title,
        description: plan.description,
        status: plan.status,
        view_count: plan.view_count,
        created_at: plan.created_at,
        updated_at: plan.updated_at,
        github_repo_owner: plan.github_repo_owner,
        github_repo_name: plan.github_repo_name,
        github_repo_url: plan.github_repo_url,
        github_repo_full_name: plan.github_repo_full_name,
        metadata: plan.metadata,
        progress: progress,
        owner: owner || { id: plan.owner_id, name: 'Unknown', email: '', github_username: null, avatar_url: null }
      },
      structure: nodeMap[rootNode.id],
    };

    res.json(result);
  } catch (error) {
    next(error);
  }
};

/**
 * Update plan visibility settings (public/private)
 */
const updatePlanVisibility = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { visibility, github_repo_owner, github_repo_name } = req.body;
    const userId = req.user.id;

    // Support both old (is_public) and new (visibility) parameters for backward compatibility
    let visibilityValue = visibility;
    if (visibility === undefined && req.body.is_public !== undefined) {
      // Convert old boolean is_public to new visibility string
      visibilityValue = req.body.is_public ? 'public' : 'private';
    }

    if (!visibilityValue) {
      return res.status(400).json({ error: 'visibility field is required (or is_public for backward compatibility)' });
    }

    if (!['public', 'private'].includes(visibilityValue)) {
      return res.status(400).json({ error: 'visibility must be either "public" or "private"' });
    }

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
      return res.status(403).json({ error: 'Only the plan owner can change visibility settings' });
    }

    // Update visibility settings
    const updates = {
      visibility: visibilityValue,
      // Also update is_public for backward compatibility
      is_public: visibilityValue === 'public',
      updated_at: new Date()
    };

    if (github_repo_owner !== undefined) {
      updates.github_repo_owner = github_repo_owner || null;
    }

    if (github_repo_name !== undefined) {
      updates.github_repo_name = github_repo_name || null;
    }

    const { data, error } = await supabase
      .from('plans')
      .update(updates)
      .eq('id', id)
      .select('id, visibility, is_public, github_repo_owner, github_repo_name');

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    if (data.length === 0) {
      return res.status(404).json({ error: 'Plan not found' });
    }

    res.json(data[0]);
  } catch (error) {
    next(error);
  }
};

/**
 * Increment view count for a public plan
 */
const incrementViewCount = async (req, res, next) => {
  try {
    const { id } = req.params;

    // First check if plan exists and is public
    const { data: plan, error: planError } = await supabase
      .from('plans')
      .select('id, visibility, view_count')
      .eq('id', id)
      .single();

    if (planError) {
      if (planError.code === 'PGRST116') {
        return res.status(404).json({ error: 'Plan not found' });
      }
      return res.status(500).json({ error: planError.message });
    }

    if (plan.visibility !== 'public') {
      return res.status(403).json({ error: 'This plan is not public' });
    }

    // Call the database function to increment view count
    const { error: funcError } = await supabase
      .rpc('increment_plan_view_count', { plan_uuid: id });

    if (funcError) {
      return res.status(500).json({ error: funcError.message });
    }

    // Return updated view count
    res.json({ view_count: plan.view_count + 1 });
  } catch (error) {
    next(error);
  }
};

/**
 * Link a GitHub repository to a plan
 */
const linkGitHubRepo = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { github_repo_owner, github_repo_name } = req.body;
    const userId = req.user.id;

    // Validate input
    if (!github_repo_owner || !github_repo_name) {
      return res.status(400).json({
        error: 'github_repo_owner and github_repo_name are required'
      });
    }

    // Validate format (alphanumeric, hyphens, underscores, dots)
    const repoRegex = /^[a-zA-Z0-9._-]+$/;
    if (!repoRegex.test(github_repo_owner) || !repoRegex.test(github_repo_name)) {
      return res.status(400).json({
        error: 'Invalid repository owner or name format'
      });
    }

    // Check plan ownership
    const { data: plan, error: fetchError } = await supabase
      .from('plans')
      .select('id, owner_id')
      .eq('id', id)
      .single();

    if (fetchError) {
      if (fetchError.code === 'PGRST116') {
        return res.status(404).json({ error: 'Plan not found' });
      }
      return res.status(500).json({ error: fetchError.message });
    }

    if (!plan) {
      return res.status(404).json({ error: 'Plan not found' });
    }

    if (plan.owner_id !== userId) {
      return res.status(403).json({ error: 'Only plan owner can link repository' });
    }

    // Update plan with GitHub repo
    const github_repo_full_name = `${github_repo_owner}/${github_repo_name}`;
    const github_repo_url = `https://github.com/${github_repo_full_name}`;

    const { data: updated, error: updateError } = await supabase
      .from('plans')
      .update({
        github_repo_owner,
        github_repo_name,
        github_repo_url,
        github_repo_full_name,
        updated_at: new Date().toISOString()
      })
      .eq('id', id)
      .select()
      .single();

    if (updateError) {
      return res.status(500).json({ error: updateError.message });
    }

    res.json({
      message: 'GitHub repository linked successfully',
      plan: updated
    });
  } catch (error) {
    next(error);
  }
};

// Note: AI plan generation has been moved to A2A architecture.
// The UI now calls the Planner Agent directly via A2A protocol at http://localhost:4001/a2a/message
// instead of using this backend endpoint. The old /plans/generate-with-ai endpoint has been removed.

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
  listPublicPlans,
  getPublicPlan,
  getPublicPlanById,
  updatePlanVisibility,
  incrementViewCount,
  linkGitHubRepo,
  calculatePlanProgress,
};
