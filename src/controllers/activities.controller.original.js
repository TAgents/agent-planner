const { supabaseAdmin: supabase } = require('../config/supabase');

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
        .from('plan_node_logs')
        .select(`
        id,
        content,
        log_type,
        created_at,
        user_id,
        metadata,
        tags
        `)
        .eq('plan_node_id', nodeId)
        .order('created_at', { ascending: false })
        .limit(limit),

        // Skip comments as they're being removed
        Promise.resolve({ data: [] }),

        // Get artifacts
        supabase
        .from('plan_node_artifacts')
        .select(`
        id,
        name,
        content_type,
        url,
        created_at,
        created_by,
        metadata
        `)
        .eq('plan_node_id', nodeId)
        .order('created_at', { ascending: false })
        .limit(limit),

        // Skip assignments for now - table might not exist
        Promise.resolve({ data: [] }),

        // Skip status changes from audit log for now
        Promise.resolve({ data: [] })
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
            user: {
              id: log.user_id,
              email: null,
              name: null,
              avatar_url: null
            },
            metadata: {
              ...log.metadata,
              tags: log.tags
            }
          });
        });
      }

      // Comments are removed - skip processing

      // Process artifacts
      if (artifactsResult.data) {
        artifactsResult.data.forEach(artifact => {
          activities.push({
            id: `artifact_${artifact.id}`,
            type: 'artifact',
            subtype: 'upload',
            content: `Uploaded ${artifact.name}`,
            timestamp: artifact.created_at,
            user: {
              id: artifact.created_by,
              email: null,
              name: null,
              avatar_url: null
            },
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
            content: `User assigned to this task`,
            timestamp: assignment.assigned_at,
            user: {
              id: assignment.assigned_by || assignment.user_id,
              email: null,
              name: null,
              avatar_url: null
            },
            metadata: {
              assignee: {
                id: assignment.user_id,
                email: null,
                name: null
              }
            }
          });
        });
      }

      // Status changes are skipped for now

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
