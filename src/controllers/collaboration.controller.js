const { plansDal, nodesDal, usersDal } = require('../db/dal.cjs');
const logger = require('../utils/logger');

// This will be set by the main server file
let collaborationServer = null;

/**
 * Set the collaboration server instance
 */
const setCollaborationServer = (server) => {
  collaborationServer = server;
};

/**
 * Collaboration Controller
 * Handles presence and real-time collaboration endpoints
 */
const collaborationController = {
  /**
   * Get currently active users in a plan
   */
  async getActivePlanUsers(req, res) {
    try {
      const { id: planId } = req.params;
      const userId = req.user.id;

      // Verify access to the plan
      const { hasAccess } = await plansDal.userHasAccess(planId, userId);
      if (!hasAccess) {
        return res.status(403).json({ error: 'Access denied' });
      }

      // Get active users from WebSocket server
      let activeUserIds = [];
      if (collaborationServer) {
        activeUserIds = await collaborationServer.getActivePlanUsers(planId);
      }

      // Get user details for active users
      if (activeUserIds.length > 0) {
        const users = await usersDal.findByIds(activeUserIds);
        const activeUsers = users.map(user => ({
          id: user.id,
          email: user.email,
          name: user.name || user.email.split('@')[0],
          avatar_url: user.avatarUrl
        }));

        res.json({ planId, activeUsers, count: activeUsers.length });
      } else {
        res.json({ planId, activeUsers: [], count: 0 });
      }
    } catch (error) {
      console.error('Error in getActivePlanUsers:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  },

  /**
   * Update user presence in a plan
   * Note: user_presence table upsert is not yet in DAL.
   * For now, presence is tracked in-memory via WebSocket server.
   */
  async updatePresence(req, res) {
    try {
      const { id: planId } = req.params;
      const { status = 'active', nodeId = null } = req.body;
      const userId = req.user.id;

      // Verify access to the plan
      const { hasAccess } = await plansDal.userHasAccess(planId, userId);
      if (!hasAccess) {
        return res.status(403).json({ error: 'Access denied' });
      }

      // Presence is tracked via WebSocket server in-memory
      res.json({
        message: 'Presence updated',
        presence: { userId, planId, nodeId, status, lastSeen: new Date().toISOString() }
      });
    } catch (error) {
      console.error('Error in updatePresence:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  },

  /**
   * Get active users for a specific node
   */
  async getActiveNodeUsers(req, res) {
    try {
      const { id: planId, nodeId } = req.params;
      const userId = req.user.id;

      // Verify the node belongs to the plan
      const node = await nodesDal.findByIdAndPlan(nodeId, planId);
      if (!node) {
        return res.status(404).json({ error: 'Node not found' });
      }

      // Verify access to the plan
      const { hasAccess } = await plansDal.userHasAccess(planId, userId);
      if (!hasAccess) {
        return res.status(403).json({ error: 'Access denied' });
      }

      // Get active users from WebSocket server
      let activeUserIds = [];
      let typingUserIds = [];

      if (collaborationServer) {
        activeUserIds = await collaborationServer.getActiveNodeUsers(nodeId);
        typingUserIds = await collaborationServer.getTypingUsers(nodeId);
      }

      const allUserIds = [...new Set([...activeUserIds, ...typingUserIds])];

      if (allUserIds.length > 0) {
        const users = await usersDal.findByIds(allUserIds);
        const userMap = new Map(users.map(u => [u.id, u]));

        const mapUser = (id) => {
          const user = userMap.get(id);
          return user ? {
            id: user.id,
            email: user.email,
            name: user.name || user.email.split('@')[0],
            avatar_url: user.avatarUrl
          } : null;
        };

        const activeUsers = activeUserIds.map(mapUser).filter(Boolean);
        const typingUsers = typingUserIds.map(mapUser).filter(Boolean);

        res.json({
          nodeId,
          activeUsers,
          typingUsers,
          counts: { active: activeUsers.length, typing: typingUsers.length }
        });
      } else {
        res.json({
          nodeId,
          activeUsers: [],
          typingUsers: [],
          counts: { active: 0, typing: 0 }
        });
      }
    } catch (error) {
      console.error('Error in getActiveNodeUsers:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
};

module.exports = {
  collaborationController,
  setCollaborationServer
};
