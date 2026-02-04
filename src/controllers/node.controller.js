const { v4: uuidv4 } = require('uuid');
const { supabaseAdmin: supabase } = require('../config/supabase');
const { broadcastPlanUpdate } = require('../websocket/broadcast');
const {
  createNodeCreatedMessage,
  createNodeUpdatedMessage,
  createNodeDeletedMessage,
  createNodeMovedMessage,
  createNodeStatusChangedMessage,
  createLogAddedMessage
} = require('../websocket/message-schema');
const { notifyStatusChange } = require('../services/notifications');

/**
 * Helper function to check if a user has access to a plan with specified roles
 * @param {string} planId - Plan ID
 * @param {string} userId - User ID
 * @param {string[]} [roles] - Optional array of required roles (e.g., ['owner', 'admin', 'editor'])
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
 * Get all nodes for a plan (tree structure)
 */
const getNodes = async (req, res, next) => {
  try {
    const { id: planId } = req.params;
    const { include_details } = req.query;
    const userId = req.user.id;

    // Check if the user has access to this plan
    const hasAccess = await checkPlanAccess(planId, userId);
    if (!hasAccess) {
      return res.status(403).json({ error: 'You do not have access to this plan' });
    }

    // Default: Return minimal fields for efficient structure navigation
    // The purpose of this endpoint is to get an overview of the plan structure.
    // For detailed node information, use GET /plans/{id}/nodes/{nodeId}/context
    const minimalFields = `
      id,
      parent_id,
      node_type,
      title,
      status,
      order_index
    `;

    // Full details only when explicitly requested
    const fullFields = `
      id,
      plan_id,
      parent_id,
      node_type,
      title,
      description,
      status,
      order_index,
      due_date,
      created_at,
      updated_at,
      context,
      agent_instructions,
      metadata
    `;

    const fieldsToSelect = include_details === 'true' ? fullFields : minimalFields;

    // Get all nodes for the plan
    const { data: nodes, error } = await supabase
      .from('plan_nodes')
      .select(fieldsToSelect)
      .eq('plan_id', planId)
      .order('order_index', { ascending: true });

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    // Build hierarchical structure
    const buildTree = (parentId = null) => {
      return nodes
        .filter(node => node.parent_id === parentId)
        .map(node => ({
          ...node,
          children: buildTree(node.id),
        }));
    };

    const tree = buildTree();
    res.json(tree);
  } catch (error) {
    next(error);
  }
};

/**
 * Get a specific node
 */
const getNode = async (req, res, next) => {
  try {
    const { id: planId, nodeId } = req.params;
    const userId = req.user.id;

    // Check if the user has access to this plan
    const hasAccess = await checkPlanAccess(planId, userId);
    if (!hasAccess) {
      return res.status(403).json({ error: 'You do not have access to this plan' });
    }

    // Get the node
    const { data: node, error } = await supabase
      .from('plan_nodes')
      .select(`
        id, 
        plan_id, 
        parent_id, 
        node_type, 
        title, 
        description, 
        status, 
        order_index, 
        due_date, 
        created_at, 
        updated_at, 
        context, 
        agent_instructions, 
        metadata
      `)
      .eq('id', nodeId)
      .eq('plan_id', planId)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return res.status(404).json({ error: 'Node not found' });
      }
      return res.status(500).json({ error: error.message });
    }

    res.json(node);
  } catch (error) {
    next(error);
  }
};

/**
 * Create a new node in a plan
 */
const createNode = async (req, res, next) => {
  try {
    const { id: planId } = req.params;
    const {
      parent_id: parentId,
      node_type: nodeType,
      title,
      description,
      status,
      order_index: orderIndex,
      due_date: dueDate,
      context,
      agent_instructions: agentInstructions,
      metadata,
    } = req.body;
    const userId = req.user.id;

    // Check if the user has edit access to this plan
    const hasAccess = await checkPlanAccess(planId, userId, ['owner', 'admin', 'editor']);
    if (!hasAccess) {
      return res.status(403).json({ error: 'You do not have permission to add nodes to this plan' });
    }

    // Validate required fields
    if (!nodeType) {
      return res.status(400).json({ error: 'Node type is required' });
    }

    if (!title) {
      return res.status(400).json({ error: 'Node title is required' });
    }

    // Don't allow creating root nodes (only one per plan should exist)
    if (nodeType === 'root') {
      return res.status(400).json({ error: 'Cannot create additional root nodes (only one allowed)' });
    }

    // If parentId provided, verify it exists in this plan
    let parentIdToUse = parentId;
    if (parentIdToUse) {
      const { data: parentNode, error: parentError } = await supabase
        .from('plan_nodes')
        .select('id')
        .eq('id', parentIdToUse)
        .eq('plan_id', planId)
        .single();

      if (parentError) {
        return res.status(400).json({ error: 'Parent node not found in this plan' });
      }
    } else {
      // If no parentId, assign to root node
      const { data: rootNode, error: rootError } = await supabase
        .from('plan_nodes')
        .select('id')
        .eq('plan_id', planId)
        .eq('node_type', 'root')
        .single();

      if (rootError) {
        return res.status(500).json({ error: 'Plan structure is invalid (no root node)' });
      }
      
      // Use the root node as parent
      parentIdToUse = rootNode.id; // Update parent ID to root node
    }

    // Determine order index if not provided
    let finalOrderIndex = orderIndex;
    if (finalOrderIndex === undefined) {
      // Get the highest order index among siblings
      const { data: siblings, error: siblingsError } = await supabase
        .from('plan_nodes')
        .select('order_index')
        .eq('plan_id', planId)
        .eq('parent_id', parentIdToUse)
        .order('order_index', { ascending: false })
        .limit(1);

      if (siblingsError) {
        return res.status(500).json({ error: siblingsError.message });
      }

      finalOrderIndex = siblings.length > 0 ? siblings[0].order_index + 1 : 0;
    }

    // Create the node
    const now = new Date();
    const nodeId = uuidv4();

    const { data, error } = await supabase
      .from('plan_nodes')
      .insert([
        {
          id: nodeId,
          plan_id: planId,
          parent_id: parentIdToUse,
          node_type: nodeType,
          title,
          description: description || '',
          status: status || 'not_started',
          order_index: finalOrderIndex,
          due_date: dueDate || null,
          created_at: now,
          updated_at: now,
          context: context || description || '',
          agent_instructions: agentInstructions || null,
          metadata: metadata || {},
        },
      ])
      .select();

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    // Add a log entry for this creation
    await supabase.from('plan_node_logs').insert([
      {
        id: uuidv4(),
        plan_node_id: nodeId,
        user_id: userId,
        content: `Created ${nodeType} "${title}"`,
        log_type: 'progress',
        created_at: now,
      },
    ]);

    // Broadcast node creation event
    const userName = req.user.name || req.user.email;
    const message = createNodeCreatedMessage(data[0], userId, userName);
    await broadcastPlanUpdate(planId, message);

    res.status(201).json(data[0]);
  } catch (error) {
    next(error);
  }
};

/**
 * Update a node
 */
const updateNode = async (req, res, next) => {
  try {
    const { id: planId, nodeId } = req.params;
    const {
      node_type: nodeType,
      title,
      description,
      status,
      order_index: orderIndex,
      due_date: dueDate,
      context,
      agent_instructions: agentInstructions,
      metadata,
    } = req.body;
    const userId = req.user.id;

    // Check if the user has edit access to this plan
    const hasAccess = await checkPlanAccess(planId, userId, ['owner', 'admin', 'editor']);
    if (!hasAccess) {
      return res.status(403).json({ error: 'You do not have permission to update nodes in this plan' });
    }

    // Check if node exists and belongs to this plan (also get status for notification)
    const { data: existingNode, error: nodeError } = await supabase
      .from('plan_nodes')
      .select('node_type, status, title')
      .eq('id', nodeId)
      .eq('plan_id', planId)
      .single();

    if (nodeError) {
      if (nodeError.code === 'PGRST116') {
        return res.status(404).json({ error: 'Node not found in this plan' });
      }
      return res.status(500).json({ error: nodeError.message });
    }

    // Store old status for notification comparison
    const oldStatus = existingNode.status;

    // Don't allow changing root node type
    if (existingNode.node_type === 'root' && nodeType && nodeType !== 'root') {
      return res.status(400).json({ error: 'Cannot change root node type' });
    }

    // Update only provided fields
    const updates = { updated_at: new Date() };
    if (nodeType !== undefined) updates.node_type = nodeType;
    if (title !== undefined) updates.title = title;
    if (description !== undefined) updates.description = description;
    if (status !== undefined) updates.status = status;
    if (orderIndex !== undefined) updates.order_index = orderIndex;
    if (dueDate !== undefined) updates.due_date = dueDate;
    if (context !== undefined) updates.context = context;
    if (agentInstructions !== undefined) updates.agent_instructions = agentInstructions;
    if (metadata !== undefined) updates.metadata = metadata;

    // Perform the update
    const { data, error } = await supabase
      .from('plan_nodes')
      .update(updates)
      .eq('id', nodeId)
      .eq('plan_id', planId)
      .select();

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    // If status was updated, add a log entry and send notification
    if (status !== undefined) {
      await supabase.from('plan_node_logs').insert([
        {
          id: uuidv4(),
          plan_node_id: nodeId,
          user_id: userId,
          content: `Updated status to ${status}`,
          log_type: 'progress',
          created_at: new Date(),
        },
      ]);

      // Send webhook notification if status changed
      if (oldStatus !== status) {
        // Get plan info for notification
        const { data: planData } = await supabase
          .from('plans')
          .select('id, title, owner_id')
          .eq('id', planId)
          .single();

        if (planData) {
          const actor = { name: req.user.name || req.user.email, type: 'user' };
          // Fire and forget - don't await
          notifyStatusChange(data[0], planData, actor, oldStatus, status).catch(err => {
            console.error('Notification error:', err);
          });
        }
      }
    }

    // Broadcast node update event
    const userName = req.user.name || req.user.email;
    const message = createNodeUpdatedMessage(data[0], userId, userName);
    await broadcastPlanUpdate(planId, message);

    res.json(data[0]);
  } catch (error) {
    next(error);
  }
};

/**
 * Delete a node
 */
const deleteNode = async (req, res, next) => {
  try {
    const { id: planId, nodeId } = req.params;
    const userId = req.user.id;

    // Check if the user has edit access to this plan
    const hasAccess = await checkPlanAccess(planId, userId, ['owner', 'admin', 'editor']);
    if (!hasAccess) {
      return res.status(403).json({ error: 'You do not have permission to delete nodes in this plan' });
    }

    // Check if node exists and belongs to this plan
    const { data: node, error: nodeError } = await supabase
      .from('plan_nodes')
      .select('node_type, title')
      .eq('id', nodeId)
      .eq('plan_id', planId)
      .single();

    if (nodeError) {
      if (nodeError.code === 'PGRST116') {
        return res.status(404).json({ error: 'Node not found in this plan' });
      }
      return res.status(500).json({ error: nodeError.message });
    }

    // Don't allow deleting root nodes
    if (node.node_type === 'root') {
      return res.status(400).json({ error: 'Cannot delete root node' });
    }

    // Find all child nodes (recursively)
    const getAllChildrenIds = async (parentId) => {
      const { data: children, error } = await supabase
        .from('plan_nodes')
        .select('id')
        .eq('parent_id', parentId);

      if (error) {
        throw error;
      }

      let ids = [parentId];
      for (const child of children) {
        const childIds = await getAllChildrenIds(child.id);
        ids = [...ids, ...childIds];
      }
      return ids;
    };

    // Get all node IDs to delete
    const nodeIdsToDelete = await getAllChildrenIds(nodeId);

    // Delete related data for all affected nodes
    for (const id of nodeIdsToDelete) {
      // Delete comments for this node
      await supabase
        .from('plan_comments')
        .delete()
        .eq('plan_node_id', id);

      // Delete labels for this node
      await supabase
        .from('plan_node_labels')
        .delete()
        .eq('plan_node_id', id);

      // Removed: artifact deletion (Phase 0 simplification - table will be dropped)

      // Delete logs for this node
      await supabase
        .from('plan_node_logs')
        .delete()
        .eq('plan_node_id', id);
    }

    // Delete all affected nodes
    const { error } = await supabase
      .from('plan_nodes')
      .delete()
      .in('id', nodeIdsToDelete);

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    // Broadcast node deletion event
    const userName = req.user.name || req.user.email;
    const message = createNodeDeletedMessage(nodeId, planId, userId, userName);
    await broadcastPlanUpdate(planId, message);

    res.status(204).send();
  } catch (error) {
    next(error);
  }
};

/**
 * Add a comment to a node - DEPRECATED: Use addLogEntry instead
 */
const addComment = async (req, res, next) => {
  // Comments functionality has been removed - use logs instead
  return res.status(410).json({ 
    error: 'Comments functionality has been removed. Please use logs endpoint instead.' 
  });
};

/**
 * Get comments for a node - DEPRECATED: Use getNodeLogs instead
 */
const getComments = async (req, res, next) => {
  // Comments functionality has been removed - use logs instead
  return res.status(410).json({ 
    error: 'Comments functionality has been removed. Please use logs endpoint instead.' 
  });
};

/**
 * Get detailed context for a specific node
 */
const getNodeContext = async (req, res, next) => {
  try {
    const { id: planId, nodeId } = req.params;
    const userId = req.user.id;

    // Check if the user has access to this plan
    const hasAccess = await checkPlanAccess(planId, userId);
    if (!hasAccess) {
      return res.status(403).json({ error: 'You do not have access to this plan' });
    }

    // Get the node
    const { data: node, error: nodeError } = await supabase
      .from('plan_nodes')
      .select(`
        id, 
        plan_id, 
        parent_id, 
        node_type, 
        title, 
        description, 
        status, 
        order_index, 
        due_date, 
        created_at, 
        updated_at, 
        context, 
        agent_instructions, 
        metadata
      `)
      .eq('id', nodeId)
      .eq('plan_id', planId)
      .single();

    if (nodeError) {
      if (nodeError.code === 'PGRST116') {
        return res.status(404).json({ error: 'Node not found' });
      }
      return res.status(500).json({ error: nodeError.message });
    }

    // Comments have been removed - use logs instead
    const comments = [];

    // Get recent logs
    const { data: logs, error: logsError } = await supabase
      .from('plan_node_logs')
      .select(`
        id, 
        content, 
        log_type, 
        created_at,
        user:user_id (id, name, email)
      `)
      .eq('plan_node_id', nodeId)
      .order('created_at', { ascending: false })
      .limit(10);

    if (logsError) {
      return res.status(500).json({ error: logsError.message });
    }

    // Get child nodes
    const { data: children, error: childrenError } = await supabase
      .from('plan_nodes')
      .select(`
        id, 
        node_type, 
        title, 
        description, 
        status
      `)
      .eq('parent_id', nodeId)
      .order('order_index', { ascending: true });

    if (childrenError) {
      return res.status(500).json({ error: childrenError.message });
    }

    // Removed: artifact retrieval (Phase 0 simplification)

    // Get the plan
    const { data: plan, error: planError } = await supabase
      .from('plans')
      .select('id, title, description, status')
      .eq('id', planId)
      .single();

    if (planError) {
      return res.status(500).json({ error: planError.message });
    }

    // Compile rich context
    const context = {
      plan: {
        id: plan.id,
        title: plan.title,
        description: plan.description,
        status: plan.status,
      },
      node,
      children,
      logs,
    };

    res.json(context);
  } catch (error) {
    next(error);
  }
};

/**
 * Get the path from root to this node with context
 */
const getNodeAncestry = async (req, res, next) => {
  try {
    const { id: planId, nodeId } = req.params;
    const userId = req.user.id;

    // Check if the user has access to this plan
    const hasAccess = await checkPlanAccess(planId, userId);
    if (!hasAccess) {
      return res.status(403).json({ error: 'You do not have access to this plan' });
    }

    // Get the current node
    const { data: currentNode, error: nodeError } = await supabase
      .from('plan_nodes')
      .select('id, parent_id, node_type, title, description, status')
      .eq('id', nodeId)
      .eq('plan_id', planId)
      .single();

    if (nodeError) {
      if (nodeError.code === 'PGRST116') {
        return res.status(404).json({ error: 'Node not found' });
      }
      return res.status(500).json({ error: nodeError.message });
    }

    // Function to get ancestors recursively
    const getAncestors = async (node, ancestry = []) => {
      // Add current node to ancestry
      ancestry.unshift(node);

      // If this is the root node, we're done
      if (node.node_type === 'root' || !node.parent_id) {
        return ancestry;
      }

      // Get the parent node
      const { data: parent, error } = await supabase
        .from('plan_nodes')
        .select('id, parent_id, node_type, title, description, status')
        .eq('id', node.parent_id)
        .eq('plan_id', planId)
        .single();

      if (error) {
        throw error;
      }

      // Continue up the tree
      return getAncestors(parent, ancestry);
    };

    // Get the ancestry path
    const ancestry = await getAncestors(currentNode);

    // Get the plan info
    const { data: plan, error: planError } = await supabase
      .from('plans')
      .select('id, title, description, status')
      .eq('id', planId)
      .single();

    if (planError) {
      return res.status(500).json({ error: planError.message });
    }

    // Return plan info and ancestry path
    res.json({
      plan,
      ancestry,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Update the status of a node
 */
const updateNodeStatus = async (req, res, next) => {
  try {
    const { id: planId, nodeId } = req.params;
    const { status } = req.body;
    const userId = req.user.id;

    // Check if the user has edit access to this plan
    const hasAccess = await checkPlanAccess(planId, userId, ['owner', 'admin', 'editor']);
    if (!hasAccess) {
      return res.status(403).json({ error: 'You do not have permission to update nodes in this plan' });
    }

    if (!status) {
      return res.status(400).json({ error: 'Status is required' });
    }

    // Valid statuses
    const validStatuses = ['not_started', 'in_progress', 'completed', 'blocked'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        error: `Invalid status. Valid values are: ${validStatuses.join(', ')}`
      });
    }

    // Get old status first
    const { data: oldNode, error: oldNodeError } = await supabase
      .from('plan_nodes')
      .select('status')
      .eq('id', nodeId)
      .eq('plan_id', planId)
      .single();

    if (oldNodeError) {
      if (oldNodeError.code === 'PGRST116') {
        return res.status(404).json({ error: 'Node not found' });
      }
      return res.status(500).json({ error: oldNodeError.message });
    }

    const oldStatus = oldNode.status;

    // Update the node status
    const { data, error } = await supabase
      .from('plan_nodes')
      .update({
        status,
        updated_at: new Date(),
      })
      .eq('id', nodeId)
      .eq('plan_id', planId)
      .select();

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    if (data.length === 0) {
      return res.status(404).json({ error: 'Node not found' });
    }

    // Add a log entry
    await supabase.from('plan_node_logs').insert([
      {
        id: uuidv4(),
        plan_node_id: nodeId,
        user_id: userId,
        content: `Updated status to ${status}`,
        log_type: 'progress',
        created_at: new Date(),
      },
    ]);

    // Broadcast status change event
    const userName = req.user.name || req.user.email;
    const message = createNodeStatusChangedMessage(
      nodeId,
      planId,
      oldStatus,
      status,
      userId,
      userName
    );
    await broadcastPlanUpdate(planId, message);

    res.json(data[0]);
  } catch (error) {
    next(error);
  }
};

/**
 * Move a node to a different parent or position
 */
const moveNode = async (req, res, next) => {
  try {
    const { id: planId, nodeId } = req.params;
    const { parent_id: newParentId, order_index: newOrderIndex } = req.body;
    const userId = req.user.id;

    // Check if the user has edit access to this plan
    const hasAccess = await checkPlanAccess(planId, userId, ['owner', 'admin', 'editor']);
    if (!hasAccess) {
      return res.status(403).json({ error: 'You do not have permission to move nodes in this plan' });
    }

    // Check if the node exists and capture old state
    const { data: node, error: nodeError } = await supabase
      .from('plan_nodes')
      .select('parent_id, node_type, title, order_index')
      .eq('id', nodeId)
      .eq('plan_id', planId)
      .single();

    if (nodeError) {
      if (nodeError.code === 'PGRST116') {
        return res.status(404).json({ error: 'Node not found' });
      }
      return res.status(500).json({ error: nodeError.message });
    }

    // Store old values for broadcast
    const oldParentId = node.parent_id;
    const oldOrderIndex = node.order_index;

    // Don't allow moving root nodes
    if (node.node_type === 'root') {
      return res.status(400).json({ error: 'Cannot move root nodes' });
    }

    // If no parent ID provided, we're just reordering within the same parent
    let parentId = newParentId || node.parent_id;

    // If changing parents, verify the new parent exists and is in the same plan
    if (newParentId && newParentId !== node.parent_id) {
      const { data: parent, error: parentError } = await supabase
        .from('plan_nodes')
        .select('id')
        .eq('id', newParentId)
        .eq('plan_id', planId)
        .single();

      if (parentError) {
        if (parentError.code === 'PGRST116') {
          return res.status(404).json({ error: 'Parent node not found' });
        }
        return res.status(500).json({ error: parentError.message });
      }
    }

    // Get the new order index
    let orderIndex = newOrderIndex;
    if (orderIndex === undefined) {
      // Get the highest order index among the new siblings
      const { data: siblings, error: siblingsError } = await supabase
        .from('plan_nodes')
        .select('order_index')
        .eq('plan_id', planId)
        .eq('parent_id', parentId)
        .neq('id', nodeId) // Exclude the node we're moving
        .order('order_index', { ascending: false })
        .limit(1);

      if (siblingsError) {
        return res.status(500).json({ error: siblingsError.message });
      }

      orderIndex = siblings.length > 0 ? siblings[0].order_index + 1 : 0;
    }

    // Update the node
    const { data, error } = await supabase
      .from('plan_nodes')
      .update({
        parent_id: parentId,
        order_index: orderIndex,
        updated_at: new Date(),
      })
      .eq('id', nodeId)
      .eq('plan_id', planId)
      .select();

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    // Add a log entry
    const logMessage = newParentId && newParentId !== node.parent_id
      ? `Moved "${node.title}" to a different parent`
      : `Reordered "${node.title}"`;

    await supabase.from('plan_node_logs').insert([
      {
        id: uuidv4(),
        plan_node_id: nodeId,
        user_id: userId,
        content: logMessage,
        log_type: 'progress',
        created_at: new Date(),
      },
    ]);

    // Broadcast node moved event
    const userName = req.user.name || req.user.email;
    const moveData = {
      oldParentId,
      newParentId: parentId,
      oldOrderIndex,
      newOrderIndex: orderIndex
    };
    const message = createNodeMovedMessage(nodeId, planId, moveData, userId, userName);
    await broadcastPlanUpdate(planId, message);

    res.json(data[0]);
  } catch (error) {
    next(error);
  }
};

/**
 * Add a progress log entry (for tracking agent activity)
 */
const addLogEntry = async (req, res, next) => {
  try {
    const { id: planId, nodeId } = req.params;
    const { content, log_type, actor_type } = req.body;
    const userId = req.user.id;

    // Check if the user has access to this plan
    const hasAccess = await checkPlanAccess(planId, userId);
    if (!hasAccess) {
      return res.status(403).json({ error: 'You do not have access to this plan' });
    }

    // Check if node exists and belongs to this plan
    const { data: node, error: nodeError } = await supabase
      .from('plan_nodes')
      .select('id')
      .eq('id', nodeId)
      .eq('plan_id', planId)
      .single();

    if (nodeError) {
      if (nodeError.code === 'PGRST116') {
        return res.status(404).json({ error: 'Node not found in this plan' });
      }
      return res.status(500).json({ error: nodeError.message });
    }

    // Validate content
    if (!content) {
      return res.status(400).json({ error: 'Log content is required' });
    }

    // Validate log type
    const validLogTypes = ['progress', 'reasoning', 'challenge', 'decision'];
    const logType = log_type || 'progress';
    if (!validLogTypes.includes(logType)) {
      return res.status(400).json({ 
        error: `Invalid log type. Valid values are: ${validLogTypes.join(', ')}` 
      });
    }

    // Create the log entry
    const logId = uuidv4();
    const createdAt = new Date();

    // Build metadata with actor_type if provided
    const metadata = actor_type ? { actor_type } : {};

    const { data, error } = await supabase
      .from('plan_node_logs')
      .insert([
        {
          id: logId,
          plan_node_id: nodeId,
          user_id: userId,
          content,
          log_type: logType,
          created_at: createdAt,
          metadata,
        },
      ])
      .select(`
        id,
        content,
        log_type,
        created_at,
        plan_node_id,
        user_id,
        metadata
      `);

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    // Broadcast log creation event
    const userName = req.user.name || req.user.email;
    const message = createLogAddedMessage(data[0], planId, userName);
    await broadcastPlanUpdate(planId, message);

    res.status(201).json(data[0]);
  } catch (error) {
    next(error);
  }
};

/**
 * Get activity logs for a node
 */
const getNodeLogs = async (req, res, next) => {
  try {
    const { id: planId, nodeId } = req.params;
    const userId = req.user.id;

    // Check if the user has access to this plan
    const hasAccess = await checkPlanAccess(planId, userId);
    if (!hasAccess) {
      return res.status(403).json({ error: 'You do not have access to this plan' });
    }

    // Check if node exists and belongs to this plan
    const { data: node, error: nodeError } = await supabase
      .from('plan_nodes')
      .select('id')
      .eq('id', nodeId)
      .eq('plan_id', planId)
      .single();

    if (nodeError) {
      if (nodeError.code === 'PGRST116') {
        return res.status(404).json({ error: 'Node not found in this plan' });
      }
      return res.status(500).json({ error: nodeError.message });
    }

    // Check for query parameters
    const { log_type } = req.query;

    // Build query
    let query = supabase
      .from('plan_node_logs')
      .select(`
        id, 
        content, 
        log_type, 
        created_at,
        user_id,
        metadata
      `)
      .eq('plan_node_id', nodeId);

    // Apply log_type filter if provided
    if (log_type) {
      query = query.eq('log_type', log_type);
    }

    // Execute query
    const { data, error } = await query.order('created_at', { ascending: false });

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    // Transform data to include user info and extract actor_type (remove internal metadata field)
    const logsWithUser = data.map(log => {
      const { metadata, ...logWithoutMetadata } = log;
      return {
        ...logWithoutMetadata,
        actor_type: metadata?.actor_type || 'human', // Default to human for backward compatibility
        user: {
          id: log.user_id,
          name: null,
          email: null
        }
      };
    });

    res.json(logsWithUser);
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getNodes,
  getNode,
  createNode,
  updateNode,
  deleteNode,
  addComment,
  getComments,
  getNodeContext,
  getNodeAncestry,
  updateNodeStatus,
  moveNode,
  addLogEntry,
  getNodeLogs,
};
