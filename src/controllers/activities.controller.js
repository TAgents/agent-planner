const { plansDal, nodesDal, logsDal, commentsDal } = require('../db/dal.cjs');

/**
 * Activities Controller
 * Handles aggregated activity endpoints
 */
const activitiesController = {
  /**
   * Get all activities for a node (logs, comments, assignments)
   */
  async getNodeActivities(req, res) {
    try {
      const { id: planId, nodeId } = req.params;
      const { limit = 50, offset = 0 } = req.query;
      const userId = req.user?.id;

      if (!userId) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      // Verify the node belongs to the plan and user has access
      const node = await nodesDal.findByIdAndPlan(nodeId, planId);
      if (!node) {
        return res.status(404).json({ error: 'Node not found in this plan' });
      }

      // Verify access to the plan
      const { hasAccess } = await plansDal.userHasAccess(planId, userId);
      if (!hasAccess) {
        return res.status(403).json({ error: 'Access denied' });
      }

      const activities = [];

      // Get logs
      const logs = await logsDal.listByNode(nodeId, { limit: Number(limit) });
      logs.forEach(log => {
        activities.push({
          id: `log_${log.id}`,
          type: 'log',
          subtype: log.logType,
          content: log.content,
          timestamp: log.createdAt,
          user: {
            id: log.userId,
            email: log.userEmail || null,
            name: log.userName || 'User',
            avatar_url: null
          },
          metadata: log.metadata || {}
        });
      });

      // Get comments
      const comments = await commentsDal.listByNode(nodeId, { limit: Number(limit) });
      comments.forEach(comment => {
        activities.push({
          id: `comment_${comment.id}`,
          type: 'comment',
          subtype: comment.commentType || 'user',
          content: comment.content,
          timestamp: comment.createdAt,
          user: {
            id: comment.userId,
            email: comment.userEmail || null,
            name: comment.userName || 'User',
            avatar_url: null
          },
          metadata: {}
        });
      });

      // Get status changes from logs
      const statusLogs = await logsDal.listStatusChanges(nodeId, { limit: 10 });
      statusLogs.forEach(log => {
        const match = log.content.match(/Updated status to (\w+)/);
        if (match) {
          activities.push({
            id: `status_${log.id}`,
            type: 'status_change',
            subtype: 'status',
            content: log.content,
            timestamp: log.createdAt,
            user: { id: log.userId, email: null, name: 'User', avatar_url: null },
            metadata: { to_status: match[1] }
          });
        }
      });

      // Sort all activities by timestamp (newest first)
      activities.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

      // Apply pagination
      const paginatedActivities = activities.slice(Number(offset), Number(offset) + Number(limit));

      res.json({
        nodeId,
        nodeTitle: node.title,
        activities: paginatedActivities,
        total: activities.length,
        limit: Number(limit),
        offset: Number(offset)
      });
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
