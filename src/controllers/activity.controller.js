const { v4: uuidv4 } = require('uuid');
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
 * Get all activity logs for a plan
 */
const getPlanActivity = async (req, res, next) => {
  try {
    const { id: planId } = req.params;
    const userId = req.user.id;
    const { page = 1, limit = 20, type } = req.query;
    
    // Convert to numbers
    const pageNum = parseInt(page, 10);
    const limitNum = parseInt(limit, 10);
    
    // Validate params
    if (isNaN(pageNum) || pageNum < 1) {
      return res.status(400).json({ error: 'Page must be a positive number' });
    }
    
    if (isNaN(limitNum) || limitNum < 1 || limitNum > 100) {
      return res.status(400).json({ error: 'Limit must be between 1 and 100' });
    }

    // Check if the user has access to this plan
    const hasAccess = await checkPlanAccess(planId, userId);
    if (!hasAccess) {
      return res.status(403).json({ error: 'You do not have access to this plan' });
    }

    // Get all nodes for the plan
    const { data: nodes, error: nodesError } = await supabase
      .from('plan_nodes')
      .select('id, title, node_type')
      .eq('plan_id', planId);

    if (nodesError) {
      return res.status(500).json({ error: nodesError.message });
    }

    const nodeIds = nodes.map(node => node.id);
    const nodesMap = nodes.reduce((acc, node) => {
      acc[node.id] = node;
      return acc;
    }, {});

    // Calculate offset for pagination
    const offset = (pageNum - 1) * limitNum;

    // Build query for logs
    let logsQuery = supabase
      .from('plan_node_logs')
      .select(`
        id, 
        plan_node_id,
        content, 
        log_type, 
        created_at,
        user:user_id (id, name, email)
      `)
      .in('plan_node_id', nodeIds);
    
    // Filter by type if provided
    if (type) {
      logsQuery = logsQuery.eq('log_type', type);
    }
    
    // Execute the query with pagination
    const { data: logs, error: logsError, count: totalLogs } = await logsQuery
      .order('created_at', { ascending: false })
      .range(offset, offset + limitNum - 1)
      .limit(limitNum);

    if (logsError) {
      return res.status(500).json({ error: logsError.message });
    }

    // Get total count for pagination
    const { count, error: countError } = await supabase
      .from('plan_node_logs')
      .select('id', { count: 'exact', head: true })
      .in('plan_node_id', nodeIds);
      
    if (countError) {
      return res.status(500).json({ error: countError.message });
    }

    // Enhance logs with node info
    const enhancedLogs = logs.map(log => ({
      ...log,
      node: nodesMap[log.plan_node_id]
    }));

    // Format the response with pagination info
    res.json({
      logs: enhancedLogs,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total: count,
        pages: Math.ceil(count / limitNum)
      }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get activity feed for a user across all plans they have access to
 */
const getUserActivityFeed = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { page = 1, limit = 20 } = req.query;
    
    // Convert to numbers
    const pageNum = parseInt(page, 10);
    const limitNum = parseInt(limit, 10);
    
    // Validate params
    if (isNaN(pageNum) || pageNum < 1) {
      return res.status(400).json({ error: 'Page must be a positive number' });
    }
    
    if (isNaN(limitNum) || limitNum < 1 || limitNum > 100) {
      return res.status(400).json({ error: 'Limit must be between 1 and 100' });
    }

    // Calculate offset for pagination
    const offset = (pageNum - 1) * limitNum;

    // Get all plans the user has access to (either as owner or collaborator)
    const { data: ownedPlans, error: ownedPlansError } = await supabase
      .from('plans')
      .select('id, title')
      .eq('owner_id', userId);

    if (ownedPlansError) {
      return res.status(500).json({ error: ownedPlansError.message });
    }

    const { data: collabPlans, error: collabPlansError } = await supabase
      .from('plan_collaborators')
      .select('plan_id, plans:plan_id (id, title)')
      .eq('user_id', userId);

    if (collabPlansError) {
      return res.status(500).json({ error: collabPlansError.message });
    }

    // Combine plan IDs into a single array
    const planIds = [
      ...ownedPlans.map(plan => plan.id),
      ...collabPlans.map(collab => collab.plans.id)
    ];

    // Create a map of plan IDs to plan info
    const plansMap = {};
    ownedPlans.forEach(plan => {
      plansMap[plan.id] = plan;
    });
    collabPlans.forEach(collab => {
      plansMap[collab.plans.id] = collab.plans;
    });

    // If user has no plans, return empty activity feed
    if (planIds.length === 0) {
      return res.json({
        activities: [],
        pagination: {
          page: pageNum,
          limit: limitNum,
          total: 0,
          pages: 0
        }
      });
    }

    // Get all nodes for these plans
    const { data: nodes, error: nodesError } = await supabase
      .from('plan_nodes')
      .select('id, title, node_type, plan_id')
      .in('plan_id', planIds);

    if (nodesError) {
      return res.status(500).json({ error: nodesError.message });
    }

    const nodeIds = nodes.map(node => node.id);
    const nodesMap = nodes.reduce((acc, node) => {
      acc[node.id] = node;
      return acc;
    }, {});

    // Get recent logs for all these nodes
    let { data: logs, error: logsError } = await supabase
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
      .order('created_at', { ascending: false })
      .range(offset, offset + limitNum - 1);

    if (logsError) {
      return res.status(500).json({ error: logsError.message });
    }

    // Get recent comments for all these nodes
    let { data: comments, error: commentsError } = await supabase
      .from('plan_comments')
      .select(`
        id, 
        plan_node_id,
        content, 
        comment_type, 
        created_at,
        user_id
      `)
      .in('plan_node_id', nodeIds)
      .order('created_at', { ascending: false })
      .range(offset, offset + limitNum - 1);

    if (commentsError) {
      // If plan_comments table doesn't exist or has schema issues, continue without comments
      await logger.error('Activity feed comments query failed:', commentsError);
      comments = [];
      commentsError = null;
    }

    // Get total count for pagination
    const { count: logsCount, error: logsCountError } = await supabase
      .from('plan_node_logs')
      .select('id', { count: 'exact', head: true })
      .in('plan_node_id', nodeIds);
      
    if (logsCountError) {
      return res.status(500).json({ error: logsCountError.message });
    }

    let commentsCount = 0;
    const { count: commentsCountResult, error: commentsCountError } = await supabase
      .from('plan_comments')
      .select('id', { count: 'exact', head: true })
      .in('plan_node_id', nodeIds);
      
    if (!commentsCountError) {
      commentsCount = commentsCountResult || 0;
    }

    const totalCount = (logsCount || 0) + commentsCount;

    // Convert logs to activity items
    const logActivities = logs.map(log => ({
      id: log.id,
      type: 'log',
      content: log.content,
      activity_type: log.log_type,
      created_at: log.created_at,
      user: log.user,
      node: nodesMap[log.plan_node_id],
      plan: plansMap[nodesMap[log.plan_node_id].plan_id]
    }));

    // Convert comments to activity items
    const commentActivities = (comments || []).map(comment => ({
      id: comment.id,
      type: 'comment',
      content: comment.content,
      activity_type: comment.comment_type,
      created_at: comment.created_at,
      user: comment.user || { id: comment.user_id },
      node: nodesMap[comment.plan_node_id],
      plan: nodesMap[comment.plan_node_id] ? plansMap[nodesMap[comment.plan_node_id].plan_id] : null
    }));

    // Combine and sort all activities
    const allActivities = [...logActivities, ...commentActivities].sort((a, b) => {
      return new Date(b.created_at) - new Date(a.created_at);
    }).slice(0, limitNum);

    res.json({
      activities: allActivities,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total: totalCount,
        pages: Math.ceil(totalCount / limitNum)
      }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get recent activity for a specific node
 */
const getNodeActivity = async (req, res, next) => {
  try {
    const { id: planId, nodeId } = req.params;
    const userId = req.user.id;
    const { limit = 10 } = req.query;
    
    // Convert to number
    const limitNum = parseInt(limit, 10);
    
    // Validate limit
    if (isNaN(limitNum) || limitNum < 1 || limitNum > 100) {
      return res.status(400).json({ error: 'Limit must be between 1 and 100' });
    }

    // Check if the user has access to this plan
    const hasAccess = await checkPlanAccess(planId, userId);
    if (!hasAccess) {
      return res.status(403).json({ error: 'You do not have access to this plan' });
    }

    // Check if node exists and belongs to this plan
    const { data: node, error: nodeError } = await supabase
      .from('plan_nodes')
      .select('id, title, node_type')
      .eq('id', nodeId)
      .eq('plan_id', planId)
      .single();

    if (nodeError) {
      if (nodeError.code === 'PGRST116') {
        return res.status(404).json({ error: 'Node not found in this plan' });
      }
      return res.status(500).json({ error: nodeError.message });
    }

    // Get recent logs for this node
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
      .limit(limitNum);

    if (logsError) {
      return res.status(500).json({ error: logsError.message });
    }

    // Get recent comments for this node
    const { data: comments, error: commentsError } = await supabase
      .from('plan_comments')
      .select(`
        id, 
        content, 
        comment_type, 
        created_at,
        user:user_id (id, name, email)
      `)
      .eq('plan_node_id', nodeId)
      .order('created_at', { ascending: false })
      .limit(limitNum);

    if (commentsError) {
      return res.status(500).json({ error: commentsError.message });
    }

    // Convert logs to activity items
    const logActivities = logs.map(log => ({
      id: log.id,
      type: 'log',
      content: log.content,
      activity_type: log.log_type,
      created_at: log.created_at,
      user: log.user
    }));

    // Convert comments to activity items
    const commentActivities = comments.map(comment => ({
      id: comment.id,
      type: 'comment',
      content: comment.content,
      activity_type: comment.comment_type,
      created_at: comment.created_at,
      user: comment.user
    }));

    // Combine and sort all activities
    const allActivities = [...logActivities, ...commentActivities].sort((a, b) => {
      return new Date(b.created_at) - new Date(a.created_at);
    }).slice(0, limitNum);

    res.json({
      node,
      activities: allActivities
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Add a richer activity log entry with multiple parameters
 */
const addDetailedLog = async (req, res, next) => {
  try {
    const { id: planId, nodeId } = req.params;
    const { content, log_type, metadata, tags } = req.body;
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
    const finalLogType = log_type || 'progress';
    if (!validLogTypes.includes(finalLogType)) {
      return res.status(400).json({ 
        error: `Invalid log type. Valid values are: ${validLogTypes.join(', ')}` 
      });
    }

    // Create the log entry with metadata
    const { data, error } = await supabase
      .from('plan_node_logs')
      .insert([
        {
          id: uuidv4(),
          plan_node_id: nodeId,
          user_id: userId,
          content,
          log_type: finalLogType,
          created_at: new Date(),
          metadata: metadata || {},
          tags: tags || []
        },
      ])
      .select(`
        id, 
        content, 
        log_type, 
        created_at,
        metadata,
        tags,
        user:user_id (id, name, email)
      `);

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    res.status(201).json(data[0]);
  } catch (error) {
    next(error);
  }
};

/**
 * Get the activity timeline for a plan
 */
const getPlanTimeline = async (req, res, next) => {
  try {
    const { id: planId } = req.params;
    const userId = req.user.id;
    
    // Check if the user has access to this plan
    const hasAccess = await checkPlanAccess(planId, userId);
    if (!hasAccess) {
      return res.status(403).json({ error: 'You do not have access to this plan' });
    }

    // Get plan info
    const { data: plan, error: planError } = await supabase
      .from('plans')
      .select('id, title, description, created_at')
      .eq('id', planId)
      .single();

    if (planError) {
      return res.status(500).json({ error: planError.message });
    }

    // Get all nodes for the plan
    const { data: nodes, error: nodesError } = await supabase
      .from('plan_nodes')
      .select('id, title, node_type, created_at, updated_at, status')
      .eq('plan_id', planId);

    if (nodesError) {
      return res.status(500).json({ error: nodesError.message });
    }

    const nodeIds = nodes.map(node => node.id);
    const nodesMap = nodes.reduce((acc, node) => {
      acc[node.id] = node;
      return acc;
    }, {});

    // Get all logs for these nodes
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
      .order('created_at', { ascending: true });

    if (logsError) {
      return res.status(500).json({ error: logsError.message });
    }

    // Get status change logs and node creation events
    const timeline = [
      // Plan creation event
      {
        id: `plan-creation-${planId}`,
        type: 'plan_created',
        date: plan.created_at,
        title: `Plan "${plan.title}" created`,
        description: plan.description || '',
        entity_id: planId,
        entity_type: 'plan'
      },
      
      // Node creation events
      ...nodes.map(node => ({
        id: `node-creation-${node.id}`,
        type: 'node_created',
        date: node.created_at,
        title: `${node.node_type.charAt(0).toUpperCase() + node.node_type.slice(1)} "${node.title}" created`,
        description: '',
        entity_id: node.id,
        entity_type: 'node',
        node_type: node.node_type,
        status: node.status
      })),
      
      // Status change logs and other significant logs
      ...logs
        .filter(log => 
          log.content.includes('Updated status to') || 
          log.log_type === 'decision' || 
          log.content.includes('Moved "')
        )
        .map(log => ({
          id: log.id,
          type: 'log',
          date: log.created_at,
          title: log.content,
          description: '',
          entity_id: log.plan_node_id,
          entity_type: 'node',
          node_title: nodesMap[log.plan_node_id]?.title || '',
          node_type: nodesMap[log.plan_node_id]?.node_type || '',
          user: log.user
        }))
    ];

    // Get decision requests for this plan
    const { data: decisions } = await supabase
      .from('decision_requests')
      .select(`
        id, title, context, urgency, status, 
        created_at, decided_at,
        requested_by_agent_name,
        decision, rationale,
        node_id
      `)
      .eq('plan_id', planId)
      .order('created_at', { ascending: true });

    if (decisions && decisions.length > 0) {
      // Add decision requested events
      decisions.forEach(dec => {
        timeline.push({
          id: `decision-requested-${dec.id}`,
          type: 'decision_requested',
          date: dec.created_at,
          title: `Decision requested: "${dec.title}"`,
          description: dec.context?.substring(0, 200) + (dec.context?.length > 200 ? '...' : ''),
          entity_id: dec.id,
          entity_type: 'decision',
          urgency: dec.urgency,
          actor_type: dec.requested_by_agent_name ? 'agent' : 'human',
          actor_name: dec.requested_by_agent_name,
          node_id: dec.node_id
        });

        // Add decision resolved events
        if (dec.status === 'decided' && dec.decided_at) {
          timeline.push({
            id: `decision-resolved-${dec.id}`,
            type: 'decision_resolved',
            date: dec.decided_at,
            title: `Decision made: "${dec.title}"`,
            description: dec.decision,
            entity_id: dec.id,
            entity_type: 'decision',
            rationale: dec.rationale
          });
        }
      });
    }

    // Get knowledge entries for this plan
    const { data: stores } = await supabase
      .from('knowledge_stores')
      .select('id')
      .eq('scope', 'plan')
      .eq('scope_id', planId);

    if (stores && stores.length > 0) {
      const storeIds = stores.map(s => s.id);
      const { data: entries } = await supabase
        .from('knowledge_entries')
        .select(`
          id, title, entry_type, created_at,
          metadata
        `)
        .in('store_id', storeIds)
        .order('created_at', { ascending: true });

      if (entries && entries.length > 0) {
        entries.forEach(entry => {
          // Skip auto-captured decisions (they already appear as decision_resolved)
          if (entry.metadata?.source === 'decision_request') return;

          timeline.push({
            id: `knowledge-${entry.id}`,
            type: 'knowledge_added',
            date: entry.created_at,
            title: `Knowledge added: "${entry.title}"`,
            description: '',
            entity_id: entry.id,
            entity_type: 'knowledge',
            entry_type: entry.entry_type
          });
        });
      }
    }

    // Sort timeline by date
    timeline.sort((a, b) => new Date(a.date) - new Date(b.date));

    res.json({
      plan,
      timeline
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getPlanActivity,
  getUserActivityFeed,
  getNodeActivity,
  addDetailedLog,
  getPlanTimeline
};