const { supabaseAdmin: supabase } = require('../config/supabase');

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
 * Search for nodes in a plan
 */
const searchNodes = async (req, res, next) => {
  try {
    const { id: planId } = req.params;
    const { 
      query, 
      status, 
      node_type: nodeType, 
      date_from: dateFrom, 
      date_to: dateTo 
    } = req.query;
    const userId = req.user.id;

    // Check if the user has access to this plan
    const hasAccess = await checkPlanAccess(planId, userId);
    if (!hasAccess) {
      return res.status(403).json({ error: 'You do not have access to this plan' });
    }

    // Build the search query
    let planNodesQuery = supabase
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
        acceptance_criteria, 
        metadata
      `)
      .eq('plan_id', planId);

    // Add full-text search if query param is provided
    if (query) {
      planNodesQuery = planNodesQuery.or(`title.ilike.%${query}%,description.ilike.%${query}%,context.ilike.%${query}%,agent_instructions.ilike.%${query}%,acceptance_criteria.ilike.%${query}%`);
    }

    // Add status filter if provided
    if (status) {
      const statuses = status.split(',');
      planNodesQuery = planNodesQuery.in('status', statuses);
    }

    // Add node type filter if provided
    if (nodeType) {
      const nodeTypes = nodeType.split(',');
      planNodesQuery = planNodesQuery.in('node_type', nodeTypes);
    }

    // Add date range filter if provided
    if (dateFrom) {
      planNodesQuery = planNodesQuery.gte('created_at', dateFrom);
    }
    if (dateTo) {
      planNodesQuery = planNodesQuery.lte('created_at', dateTo);
    }

    // Execute the query
    const { data: nodes, error } = await planNodesQuery.order('created_at', { ascending: false });

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    // Return the results
    res.json(nodes);
  } catch (error) {
    next(error);
  }
};

/**
 * Search for artifacts (deprecated - returns empty array)
 * @deprecated Artifacts have been removed (Phase 0 simplification)
 */
const searchArtifacts = async (req, res, next) => {
  // Artifacts have been removed
  res.json([]);
};

/**
 * Search across all resources (plans, nodes, comments, logs)
 */
const globalSearch = async (req, res, next) => {
  try {
    const { query } = req.query;
    const userId = req.user.id;

    if (!query || query.trim().length < 3) {
      return res.status(400).json({ error: 'Search query must be at least 3 characters' });
    }

    // Get all plans the user has access to (either as owner or collaborator)
    const { data: ownedPlans, error: ownedPlansError } = await supabase
      .from('plans')
      .select('id, title, description, status, created_at, updated_at')
      .eq('owner_id', userId)
      .or(`title.ilike.%${query}%,description.ilike.%${query}%`);

    if (ownedPlansError) {
      return res.status(500).json({ error: ownedPlansError.message });
    }

    const { data: collabPlans, error: collabPlansError } = await supabase
      .from('plan_collaborators')
      .select('plans:plan_id (id, title, description, status, created_at, updated_at)')
      .eq('user_id', userId);

    if (collabPlansError) {
      return res.status(500).json({ error: collabPlansError.message });
    }

    // Process collaborator plans and filter by search term
    const collabPlanObjects = collabPlans
      .map(collab => collab.plans)
      .filter(plan => 
        plan.title.toLowerCase().includes(query.toLowerCase()) ||
        (plan.description && plan.description.toLowerCase().includes(query.toLowerCase()))
      );

    // Combine plan IDs into a single array for further queries
    const allPlans = [...ownedPlans, ...collabPlanObjects];
    const planIds = allPlans.map(plan => plan.id);

    // If user has no matching plans, continue with empty array
    let matchingNodes = [];
    let matchingComments = [];
    let matchingLogs = [];

    if (planIds.length > 0) {
      // Search for nodes
      const { data: nodes, error: nodesError } = await supabase
        .from('plan_nodes')
        .select(`
          id, 
          plan_id, 
          node_type, 
          title, 
          description, 
          status, 
          created_at
        `)
        .in('plan_id', planIds)
        .or(`title.ilike.%${query}%,description.ilike.%${query}%,context.ilike.%${query}%,agent_instructions.ilike.%${query}%,acceptance_criteria.ilike.%${query}%`)
        .order('created_at', { ascending: false });

      if (nodesError) {
        return res.status(500).json({ error: nodesError.message });
      }
      
      matchingNodes = nodes;
      const nodeIds = nodes.map(node => node.id);

      // Search for comments if we have matching nodes
      if (nodeIds.length > 0) {
        const { data: comments, error: commentsError } = await supabase
          .from('plan_comments')
          .select(`
            id, 
            plan_node_id,
            content, 
            comment_type, 
            created_at,
            user:user_id (id, name, email)
          `)
          .in('plan_node_id', planNodeIds)
          .ilike('content', `%${query}%`)
          .order('created_at', { ascending: false });

        if (commentsError) {
          return res.status(500).json({ error: commentsError.message });
        }
        
        matchingComments = comments;
        
        // Search for logs
        const { data: logs, error: logsError } = await supabase
          .from('plan_node_logs')
          .select(`
            id, 
            plan_node_id,
            content, 
            log_type, 
            created_at,
            user:user_id (id, name, email)
          `)
          .in('plan_node_id', nodeIds)
          .ilike('content', `%${query}%`)
          .order('created_at', { ascending: false });

        if (logsError) {
          return res.status(500).json({ error: logsError.message });
        }
        
        matchingLogs = logs;
        
        // Removed: artifact search (Phase 0 simplification)
      }
    }

    // Create a map of nodes for quick reference
    const nodesMap = matchingNodes.reduce((acc, node) => {
      acc[node.id] = node;
      return acc;
    }, {});

    // Map comments and logs to their parent nodes
    const mappedComments = matchingComments.map(comment => ({
      id: comment.id,
      type: 'comment',
      content: comment.content,
      created_at: comment.created_at,
      user: comment.user,
      node: nodesMap[comment.plan_node_id]
    }));

    const mappedLogs = matchingLogs.map(log => ({
      id: log.id,
      type: 'log',
      content: log.content,
      created_at: log.created_at,
      user: log.user,
      node: nodesMap[log.plan_node_id]
    }));

    // Format plans results
    const mappedPlans = allPlans.map(plan => ({
      id: plan.id,
      type: 'plan',
      title: plan.title,
      description: plan.description,
      status: plan.status,
      created_at: plan.created_at,
      updated_at: plan.updated_at
    }));

    // Format nodes results
    const mappedNodes = matchingNodes.map(node => ({
      id: node.id,
      type: 'node',
      node_type: node.node_type,
      title: node.title,
      description: node.description,
      status: node.status,
      created_at: node.created_at,
      plan_id: node.plan_id
    }));

    // Return categorized results
    res.json({
      query,
      results: {
        plans: mappedPlans,
        nodes: mappedNodes,
        comments: mappedComments,
        logs: mappedLogs
      },
      counts: {
        plans: mappedPlans.length,
        nodes: mappedNodes.length,
        comments: mappedComments.length,
        logs: mappedLogs.length,
        total: mappedPlans.length + mappedNodes.length + mappedComments.length + mappedLogs.length
      }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Search within a plan using the database function
 */
const searchPlan = async (req, res, next) => {
  try {
    const { plan_id: planId } = req.params;
    const { query } = req.query;
    const userId = req.user.id;

    if (!query || query.trim().length < 2) {
      return res.status(400).json({ error: 'Search query must be at least 2 characters' });
    }

    // Check if the user has access to this plan
    const hasAccess = await checkPlanAccess(planId, userId);
    if (!hasAccess) {
      return res.status(403).json({ error: 'You do not have access to this plan' });
    }

    // Call the database function to search across all resources in the plan
    // Using the correct parameter names as defined in the database function
    const { data: searchResults, error: rpcError } = await supabase.rpc('search_plan', {
      input_plan_id: planId, // Use the correct parameter name from the function definition
      search_query: query
    });

    if (rpcError) {
      console.error('Error calling search_plan RPC:', rpcError);
      return res.status(500).json({ error: rpcError.message });
    }

    // Sort results by created_at (most recent first)
    const sortedResults = searchResults || [];
    sortedResults.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    // Return the search results
    res.json({
      query,
      results: sortedResults,
      count: sortedResults.length
    });
  } catch (error) {
    console.error('Error in searchPlan:', error);
    next(error);
  }
};

module.exports = {
  searchNodes,
  searchArtifacts,
  globalSearch,
  searchPlan
};