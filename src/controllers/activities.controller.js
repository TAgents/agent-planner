const { supabase } = require('../config/supabase');

/**
 * Activities Controller
 * Handles aggregated activity endpoints
 */
const activitiesController = {
  /**
   * Get all activities for a node (logs, status changes, assignments, files)
   */
  async getNodeActivities(req, res) {
    try {
      const { id: planId, nodeId } = req.params;
      const { limit = 50, offset = 0 } = req.query;
      const userId = req.user.id;

      // Verify the node belongs to the plan and user has access
      const { data: node, error: nodeError } = await supabase
        .from('plan_nodes')
        .select('id, plan_id, title')
        .eq('id', nodeId)
        .eq('plan_id', planId)
        .single();

      if (nodeError || !node) {
        return res.status(404).json({ error: 'Node not found in this plan' });
      }

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

      // Fetch all activity types in parallel
      const [
        logsResult,
        commentsResult,
        artifactsResult,
        assignmentsResult,
        statusChangesResult
      ] = await Promise.all([
        // Get logs
        supabase
          .from('logs')
          .select(`
            id,
            content,
            log_type,
            created_at,
            user_id,
            metadata,
            tags,
            user:auth.users!user_id (
              id,
              email,
              raw_user_meta_data
            )
          `)
          .eq('plan_node_id', nodeId)
          .order('created_at', { ascending: false })
          .limit(limit),

        // Get comments
        supabase
          .from('comments')
          .select(`
            id,
            content,
            comment_type,
            created_at,
            user_id,
            user:auth.users!user_id (
              id,
              email,
              raw_user_meta_data
            )
          `)
          .eq('node_id', nodeId)
          .order('created_at', { ascending: false })
          .limit(limit),

        // Get artifacts
        supabase
          .from('artifacts')
          .select(`
            id,
            name,
            content_type,
            url,
            created_at,
            created_by,
            metadata,
            user:auth.users!created_by (
              id,
              email,
              raw_user_meta_data
            )
          `)
          .eq('plan_node_id', nodeId)
          .order('created_at', { ascending: false })
          .limit(limit),

        // Get assignments
        supabase
          .from('node_assignments_with_users')
          .select('*')
          .eq('node_id', nodeId)
          .order('assigned_at', { ascending: false })
          .limit(limit),

        // Get status changes from audit log
        supabase
          .from('audit_logs')
          .select(`
            id,
            action,
            details,
            created_at,
            user_id,
            user:auth.users!user_id (
              id,
              email,
              raw_user_meta_data
            )
          `)
          .eq('resource_type', 'node')
          .eq('resource_id', nodeId)
          .eq('action', 'status_change')
          .order('created_at', { ascending: false })
          .limit(limit)
      ]);

      // Process and combine all activities
      const activities = [];

      // Process logs
      if (logsResult.data) {
        logsResult.data.forEach(log => {
          activities.push({
            id: `log_${log.id}`,
            type: 'log',
            subtype: log.log_type,
            content: log.content,
            timestamp: log.created_at,
            user: log.user ? {
              id: log.user.id,
              email: log.user.email,
              name: log.user.raw_user_meta_data?.name || log.user.email.split('@')[0],
              avatar_url: log.user.raw_user_meta_data?.avatar_url
            } : null,
            metadata: {
              ...log.metadata,
              tags: log.tags
            }
          });
        });
      }

      // Process comments
      if (commentsResult.data) {
        commentsResult.data.forEach(comment => {
          activities.push({
            id: `comment_${comment.id}`,
            type: 'comment',
            subtype: comment.comment_type,
            content: comment.content,
            timestamp: comment.created_at,
            user: comment.user ? {
              id: comment.user.id,
              email: comment.user.email,
              name: comment.user.raw_user_meta_data?.name || comment.user.email.split('@')[0],
              avatar_url: comment.user.raw_user_meta_data?.avatar_url
            } : null,
            metadata: {}
          });
        });
      }

      // Process artifacts
      if (artifactsResult.data) {
        artifactsResult.data.forEach(artifact => {
          activities.push({
            id: `artifact_${artifact.id}`,
            type: 'artifact',
            subtype: 'upload',
            content: `Uploaded ${artifact.name}`,
            timestamp: artifact.created_at,
            user: artifact.user ? {
              id: artifact.user.id,
              email: artifact.user.email,
              name: artifact.user.raw_user_meta_data?.name || artifact.user.email.split('@')[0],
              avatar_url: artifact.user.raw_user_meta_data?.avatar_url
            } : null,
            metadata: {
              name: artifact.name,
              content_type: artifact.content_type,
              url: artifact.url,
              ...artifact.metadata
            }
          });
        });
      }

      // Process assignments
      if (assignmentsResult.data) {
        assignmentsResult.data.forEach(assignment => {
          activities.push({
            id: `assignment_${assignment.id}`,
            type: 'assignment',
            subtype: 'assigned',
            content: `${assignment.assigned_by_name || 'Someone'} assigned ${assignment.user_name || 'a user'} to this task`,
            timestamp: assignment.assigned_at,
            user: {
              id: assignment.assigned_by,
              email: assignment.assigned_by_email,
              name: assignment.assigned_by_name || assignment.assigned_by_email?.split('@')[0],
              avatar_url: null
            },
            metadata: {
              assignee: {
                id: assignment.user_id,
                email: assignment.user_email,
                name: assignment.user_name || assignment.user_email?.split('@')[0]
              }
            }
          });
        });
      }

      // Process status changes
      if (statusChangesResult.data) {
        statusChangesResult.data.forEach(change => {
          activities.push({
            id: `status_${change.id}`,
            type: 'status_change',
            subtype: 'status',
            content: `Status changed from ${change.details?.from_status || 'unknown'} to ${change.details?.to_status || 'unknown'}`,
            timestamp: change.created_at,
            user: change.user ? {
              id: change.user.id,
              email: change.user.email,
              name: change.user.raw_user_meta_data?.name || change.user.email.split('@')[0],
              avatar_url: change.user.raw_user_meta_data?.avatar_url
            } : null,
            metadata: {
              from_status: change.details?.from_status,
              to_status: change.details?.to_status
            }
          });
        });
      }

      // Sort all activities by timestamp (newest first)
      activities.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

      // Apply pagination
      const paginatedActivities = activities.slice(Number(offset), Number(offset) + Number(limit));

      res.json({
        nodeId: nodeId,
        nodeTitle: node.title,
        activities: paginatedActivities,
        total: activities.length,
        limit: Number(limit),
        offset: Number(offset)
      });
    } catch (error) {
      console.error('Error in getNodeActivities:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
};

module.exports = activitiesController;
