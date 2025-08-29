const { supabaseAdmin } = require('../config/supabase');
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
      const { data: plan, error: planError } = await supabaseAdmin
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
        const { data: collaborator } = await supabaseAdmin
          .from('plan_collaborators')
          .select('role')
          .eq('plan_id', planId)
          .eq('user_id', userId)
          .single();

        if (!collaborator) {
          return res.status(403).json({ error: 'Access denied' });
        }
      }

      // Get active users from WebSocket server
      let activeUserIds = [];
      if (collaborationServer) {
        activeUserIds = await collaborationServer.getActivePlanUsers(planId);
      }

      // Get user details for active users
      if (activeUserIds.length > 0) {
        const { data: users } = await supabaseAdmin
          .from('users')
          .select('id, email, name, avatar_url')
          .in('id', activeUserIds);

        const activeUsers = (users || []).map(user => ({
          id: user.id,
          email: user.email,
          name: user.name || user.email.split('@')[0],
          avatar_url: user.avatar_url
        }));

        res.json({
          planId: planId,
          activeUsers: activeUsers,
          count: activeUsers.length
        });
      } else {
        res.json({
          planId: planId,
          activeUsers: [],
          count: 0
        });
      }
    } catch (error) {
      console.error('Error in getActivePlanUsers:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  },

  /**
   * Update user presence in a plan
   */
  async updatePresence(req, res) {
    try {
      const { id: planId } = req.params;
      const { status = 'active', nodeId = null } = req.body;
      const userId = req.user.id;

      // Verify access to the plan
      const { data: plan, error: planError } = await supabaseAdmin
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
        const { data: collaborator } = await supabaseAdmin
          .from('plan_collaborators')
          .select('role')
          .eq('plan_id', planId)
          .eq('user_id', userId)
          .single();

        if (!collaborator) {
          return res.status(403).json({ error: 'Access denied' });
        }
      }

      // Store presence in database (for persistence)
      const { data: presence, error } = await supabaseAdmin
        .from('user_presence')
        .upsert({
          user_id: userId,
          plan_id: planId,
          node_id: nodeId,
          status: status,
          last_seen: new Date().toISOString()
        }, {
          onConflict: 'user_id,plan_id'
        })
        .select()
        .single();

      if (error) {
        console.error('Error updating presence:', error);
        return res.status(500).json({ error: 'Failed to update presence' });
      }

      res.json({
        message: 'Presence updated',
        presence: presence
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
      const { data: node, error: nodeError } = await supabaseAdmin
        .from('plan_nodes')
        .select('id, plan_id')
        .eq('id', nodeId)
        .eq('plan_id', planId)
        .single();

      if (nodeError || !node) {
        return res.status(404).json({ error: 'Node not found' });
      }

      // Verify access to the plan
      const { data: plan, error: planError } = await supabaseAdmin
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
        const { data: collaborator } = await supabaseAdmin
          .from('plan_collaborators')
          .select('role')
          .eq('plan_id', planId)
          .eq('user_id', userId)
          .single();

        if (!collaborator) {
          return res.status(403).json({ error: 'Access denied' });
        }
      }

      // Get active users from WebSocket server
      let activeUserIds = [];
      let typingUserIds = [];
      
      if (collaborationServer) {
        activeUserIds = await collaborationServer.getActiveNodeUsers(nodeId);
        typingUserIds = await collaborationServer.getTypingUsers(nodeId);
      }

      // Get user details
      const allUserIds = [...new Set([...activeUserIds, ...typingUserIds])];
      
      if (allUserIds.length > 0) {
        const { data: users } = await supabaseAdmin
          .from('users')
          .select('id, email, name, avatar_url')
          .in('id', allUserIds);

        const userMap = new Map((users || []).map(u => [u.id, u]));

        const activeUsers = activeUserIds.map(id => {
          const user = userMap.get(id);
          return user ? {
            id: user.id,
            email: user.email,
            name: user.name || user.email.split('@')[0],
            avatar_url: user.avatar_url
          } : null;
        }).filter(Boolean);

        const typingUsers = typingUserIds.map(id => {
          const user = userMap.get(id);
          return user ? {
            id: user.id,
            email: user.email,
            name: user.name || user.email.split('@')[0],
            avatar_url: user.avatar_url
          } : null;
        }).filter(Boolean);

        res.json({
          nodeId: nodeId,
          activeUsers: activeUsers,
          typingUsers: typingUsers,
          counts: {
            active: activeUsers.length,
            typing: typingUsers.length
          }
        });
      } else {
        res.json({
          nodeId: nodeId,
          activeUsers: [],
          typingUsers: [],
          counts: {
            active: 0,
            typing: 0
          }
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
