const { supabaseAdmin: supabase } = require('../config/supabase');

/**
 * Activities Controller - Fixed version with debugging
 * Handles aggregated activity endpoints with proper database table names
 */
const activitiesController = {
  /**
   * Get all activities for a node (logs, comments, assignments)
   */
  async getNodeActivities(req, res) {
    console.log('=== Activities endpoint hit ===');
    console.log('Request params:', req.params);
    console.log('Request query:', req.query);
    console.log('User:', req.user?.id);
    
    try {
      const { id: planId, nodeId } = req.params;
      const { limit = 50, offset = 0 } = req.query;
      const userId = req.user?.id;

      if (!userId) {
        console.error('No user ID in request');
        return res.status(401).json({ error: 'Unauthorized' });
      }

      console.log(`Getting activities for node ${nodeId} in plan ${planId}`);

      // Verify the node belongs to the plan and user has access
      const { data: node, error: nodeError } = await supabase
        .from('plan_nodes')
        .select('id, plan_id, title')
        .eq('id', nodeId)
        .eq('plan_id', planId)
        .single();

      if (nodeError) {
        console.error('Error fetching node:', nodeError);
        return res.status(404).json({ 
          error: 'Node not found in this plan',
          details: nodeError.message 
        });
      }

      if (!node) {
        return res.status(404).json({ error: 'Node not found' });
      }

      // Verify access to the plan
      const { data: plan, error: planError } = await supabase
        .from('plans')
        .select('id, owner_id')
        .eq('id', planId)
        .single();

      if (planError || !plan) {
        console.error('Error fetching plan:', planError);
        return res.status(404).json({ 
          error: 'Plan not found',
          details: planError?.message 
        });
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
          console.log('User is not a collaborator');
          return res.status(403).json({ error: 'Access denied' });
        }
      }

      console.log('Access verified, fetching activities...');

      // Initialize activities array
      const activities = [];

      // Get logs (using correct table name)
      console.log('Fetching logs...');
      const { data: logs, error: logsError } = await supabase
        .from('plan_node_logs')
        .select('*')
        .eq('plan_node_id', nodeId)
        .order('created_at', { ascending: false })
        .limit(limit);

      if (logsError) {
        console.error('Error fetching logs:', logsError);
      } else if (logs && logs.length > 0) {
        console.log(`Found ${logs.length} logs`);
        logs.forEach(log => {
          activities.push({
            id: `log_${log.id}`,
            type: 'log',
            subtype: log.log_type,
            content: log.content,
            timestamp: log.created_at,
            user: {
              id: log.user_id,
              email: null,
              name: 'User',
              avatar_url: null
            },
            metadata: log.metadata || {}
          });
        });
      }

      // Get comments (skipping if deprecated)
      console.log('Fetching comments...');
      const { data: comments, error: commentsError } = await supabase
        .from('plan_comments')
        .select('*')
        .eq('plan_node_id', nodeId)
        .order('created_at', { ascending: false })
        .limit(limit);

      if (!commentsError && comments && comments.length > 0) {
        console.log(`Found ${comments.length} comments`);
        comments.forEach(comment => {
          activities.push({
            id: `comment_${comment.id}`,
            type: 'comment',
            subtype: comment.comment_type || 'user',
            content: comment.content,
            timestamp: comment.created_at,
            user: {
              id: comment.user_id,
              email: null,
              name: 'User',
              avatar_url: null
            },
            metadata: {}
          });
        });
      }

      // Removed: artifact activities (Phase 0 simplification)

      // Get assignments
      console.log('Fetching assignments...');
      const { data: assignments, error: assignmentsError } = await supabase
        .from('node_assignments')
        .select('*')
        .eq('node_id', nodeId)
        .order('assigned_at', { ascending: false })
        .limit(limit);

      if (!assignmentsError && assignments && assignments.length > 0) {
        console.log(`Found ${assignments.length} assignments`);
        assignments.forEach(assignment => {
          activities.push({
            id: `assignment_${assignment.id}`,
            type: 'assignment',
            subtype: 'assigned',
            content: `User assigned to this task`,
            timestamp: assignment.assigned_at,
            user: {
              id: assignment.assigned_by || assignment.user_id,
              email: null,
              name: 'User',
              avatar_url: null
            },
            metadata: {
              assignee_id: assignment.user_id
            }
          });
        });
      }

      // Try to get status changes from logs
      console.log('Fetching status changes...');
      const { data: statusLogs } = await supabase
        .from('plan_node_logs')
        .select('*')
        .eq('plan_node_id', nodeId)
        .eq('log_type', 'progress')
        .like('content', 'Updated status%')
        .order('created_at', { ascending: false })
        .limit(10);

      if (statusLogs && statusLogs.length > 0) {
        console.log(`Found ${statusLogs.length} status changes`);
        statusLogs.forEach(log => {
          const match = log.content.match(/Updated status to (\w+)/);
          if (match) {
            activities.push({
              id: `status_${log.id}`,
              type: 'status_change',
              subtype: 'status',
              content: log.content,
              timestamp: log.created_at,
              user: {
                id: log.user_id,
                email: null,
                name: 'User',
                avatar_url: null
              },
              metadata: {
                to_status: match[1]
              }
            });
          }
        });
      }

      // Sort all activities by timestamp (newest first)
      activities.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

      // Apply pagination
      const paginatedActivities = activities.slice(Number(offset), Number(offset) + Number(limit));

      console.log(`Returning ${paginatedActivities.length} activities out of ${activities.length} total`);

      const response = {
        nodeId: nodeId,
        nodeTitle: node.title,
        activities: paginatedActivities,
        total: activities.length,
        limit: Number(limit),
        offset: Number(offset)
      };

      console.log('=== Activities endpoint success ===');
      res.json(response);
    } catch (error) {
      console.error('Error in getNodeActivities:', error);
      res.status(500).json({ 
        error: 'Internal server error',
        message: error.message,
        stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
      });
    }
  }
};

module.exports = activitiesController;
