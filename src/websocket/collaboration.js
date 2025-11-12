const WebSocket = require('ws');
const { supabaseAdmin } = require('../config/supabase');
const logger = require('../utils/logger');

class CollaborationServer {
  constructor(server) {
    this.wss = new WebSocket.Server({ 
      server,
      path: '/ws/collaborate'
    });
    
    // Track active connections
    this.connections = new Map(); // userId -> WebSocket
    this.planUsers = new Map(); // planId -> Set of userIds
    this.nodeUsers = new Map(); // nodeId -> Set of userIds
    this.typingUsers = new Map(); // nodeId -> Set of userIds
    
    this.setupWebSocketServer();
  }

  setupWebSocketServer() {
    this.wss.on('connection', async (ws, req) => {
      let userId = null;
      let currentPlanId = null;
      let currentNodeId = null;

      // Authenticate the connection
      try {
        const token = this.extractToken(req);
        const authResult = await this.authenticateUser(token);
        if (!authResult.user) {
          // Close with specific code for bad JWT to prevent reconnection attempts
          if (authResult.error?.code === 'bad_jwt') {
            ws.close(4001, 'Token expired or invalid');
          } else {
            ws.close(1008, 'Authentication failed');
          }
          return;
        }

        userId = authResult.user.id;
        this.connections.set(userId, ws);

        await logger.api(`WebSocket connection established for user ${userId}`);
        
        // Send initial connection success
        ws.send(JSON.stringify({
          type: 'connection',
          status: 'connected',
          userId: userId
        }));

      } catch (error) {
        await logger.error('WebSocket authentication error:', error);
        ws.close(1008, 'Authentication failed');
        return;
      }

      // Handle messages
      ws.on('message', async (message) => {
        try {
          const data = JSON.parse(message);
          
          switch (data.type) {
            case 'join_plan':
              await this.handleJoinPlan(userId, data.planId, currentPlanId, ws);
              currentPlanId = data.planId;
              break;
              
            case 'leave_plan':
              await this.handleLeavePlan(userId, currentPlanId);
              currentPlanId = null;
              break;
              
            case 'join_node':
              await this.handleJoinNode(userId, data.nodeId, currentNodeId, currentPlanId, ws);
              currentNodeId = data.nodeId;
              break;
              
            case 'leave_node':
              await this.handleLeaveNode(userId, currentNodeId, currentPlanId);
              currentNodeId = null;
              break;
              
            case 'typing_start':
              await this.handleTypingStart(userId, data.nodeId, currentPlanId);
              break;
              
            case 'typing_stop':
              await this.handleTypingStop(userId, data.nodeId, currentPlanId);
              break;
              
            case 'update_presence':
              await this.handleUpdatePresence(userId, data.status, currentPlanId);
              break;
              
            case 'broadcast':
              // Broadcast a message to all users in the plan
              if (currentPlanId && data.message) {
                await this.broadcastToPlan(currentPlanId, {
                  type: 'message',
                  userId: userId,
                  message: data.message,
                  timestamp: new Date()
                }, userId);
              }
              break;
              
            case 'ping':
              ws.send(JSON.stringify({ type: 'pong' }));
              break;
              
            default:
              await logger.warn(`Unknown WebSocket message type: ${data.type}`);
          }
        } catch (error) {
          await logger.error('WebSocket message handling error:', error);
          ws.send(JSON.stringify({
            type: 'error',
            message: 'Failed to process message'
          }));
        }
      });

      // Handle disconnection
      ws.on('close', async () => {
        if (userId) {
          // Clean up user from all tracking
          this.connections.delete(userId);
          
          if (currentNodeId) {
            await this.handleLeaveNode(userId, currentNodeId, currentPlanId);
          }
          
          if (currentPlanId) {
            await this.handleLeavePlan(userId, currentPlanId);
          }
          
          await logger.api(`WebSocket connection closed for user ${userId}`);
        }
      });

      // Handle errors
      ws.on('error', async (error) => {
        await logger.error(`WebSocket error for user ${userId}:`, error);
      });
    });
  }

  extractToken(req) {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const token = url.searchParams.get('token');
    
    if (!token) {
      // Try to get from authorization header
      const auth = req.headers.authorization;
      if (auth && auth.startsWith('Bearer ')) {
        return auth.substring(7);
      }
    }
    
    return token;
  }

  async authenticateUser(token) {
    if (!token) return { user: null, error: { code: 'no_token' } };

    try {
      // Verify token using Supabase's getUser method with admin client (same as REST API middleware)
      const { data: userData, error } = await supabaseAdmin.auth.getUser(token);

      if (error || !userData.user) {
        // Only log non-JWT errors (bad_jwt is expected during development reconnection attempts)
        if (error?.code !== 'bad_jwt') {
          if (error) {
            await logger.error(`WebSocket token verification failed: ${JSON.stringify(error)}`);
          } else {
            await logger.error('WebSocket token verification failed: No user data');
          }
        }
        return { user: null, error };
      }

      return {
        user: {
          id: userData.user.id,
          email: userData.user.email,
          name: userData.user.user_metadata?.name
        },
        error: null
      };
    } catch (error) {
      await logger.error('WebSocket authentication error:', error);
      return { user: null, error };
    }
  }

  async handleJoinPlan(userId, planId, previousPlanId, ws) {
    // Leave previous plan if any
    if (previousPlanId) {
      await this.handleLeavePlan(userId, previousPlanId);
    }
    
    // Add user to plan tracking
    if (!this.planUsers.has(planId)) {
      this.planUsers.set(planId, new Set());
    }
    this.planUsers.get(planId).add(userId);
    
    // Notify other users in the plan
    await this.broadcastToPlan(planId, {
      type: 'user_joined_plan',
      userId: userId,
      timestamp: new Date()
    }, userId);
    
    // Send current active users to the joining user
    const activeUsers = Array.from(this.planUsers.get(planId) || []);
    ws.send(JSON.stringify({
      type: 'active_users',
      planId: planId,
      users: activeUsers
    }));
    
    await logger.api(`User ${userId} joined plan ${planId}`);
  }

  async handleLeavePlan(userId, planId) {
    if (!planId) return;
    
    // Remove user from plan tracking
    if (this.planUsers.has(planId)) {
      this.planUsers.get(planId).delete(userId);
      
      // Clean up empty sets
      if (this.planUsers.get(planId).size === 0) {
        this.planUsers.delete(planId);
      }
    }
    
    // Notify other users in the plan
    await this.broadcastToPlan(planId, {
      type: 'user_left_plan',
      userId: userId,
      timestamp: new Date()
    }, userId);
    
    await logger.api(`User ${userId} left plan ${planId}`);
  }

  async handleJoinNode(userId, nodeId, previousNodeId, planId, ws) {
    // Leave previous node if any
    if (previousNodeId) {
      await this.handleLeaveNode(userId, previousNodeId, planId);
    }
    
    // Add user to node tracking
    if (!this.nodeUsers.has(nodeId)) {
      this.nodeUsers.set(nodeId, new Set());
    }
    this.nodeUsers.get(nodeId).add(userId);
    
    // Notify other users viewing the node
    await this.broadcastToNode(nodeId, planId, {
      type: 'user_joined_node',
      nodeId: nodeId,
      userId: userId,
      timestamp: new Date()
    }, userId);
    
    // Send current users viewing this node
    const nodeViewers = Array.from(this.nodeUsers.get(nodeId) || []);
    ws.send(JSON.stringify({
      type: 'node_viewers',
      nodeId: nodeId,
      users: nodeViewers
    }));
    
    await logger.api(`User ${userId} joined node ${nodeId}`);
  }

  async handleLeaveNode(userId, nodeId, planId) {
    if (!nodeId) return;
    
    // Remove from node tracking
    if (this.nodeUsers.has(nodeId)) {
      this.nodeUsers.get(nodeId).delete(userId);
      
      // Clean up empty sets
      if (this.nodeUsers.get(nodeId).size === 0) {
        this.nodeUsers.delete(nodeId);
      }
    }
    
    // Remove from typing users if present
    if (this.typingUsers.has(nodeId)) {
      this.typingUsers.get(nodeId).delete(userId);
    }
    
    // Notify other users
    await this.broadcastToNode(nodeId, planId, {
      type: 'user_left_node',
      nodeId: nodeId,
      userId: userId,
      timestamp: new Date()
    }, userId);
    
    await logger.api(`User ${userId} left node ${nodeId}`);
  }

  async handleTypingStart(userId, nodeId, planId) {
    if (!this.typingUsers.has(nodeId)) {
      this.typingUsers.set(nodeId, new Set());
    }
    this.typingUsers.get(nodeId).add(userId);
    
    // Notify others viewing the node
    await this.broadcastToNode(nodeId, planId, {
      type: 'typing_start',
      nodeId: nodeId,
      userId: userId,
      timestamp: new Date()
    }, userId);
    
    // Auto-stop typing after 5 seconds
    setTimeout(() => {
      this.handleTypingStop(userId, nodeId, planId);
    }, 5000);
  }

  async handleTypingStop(userId, nodeId, planId) {
    if (this.typingUsers.has(nodeId)) {
      this.typingUsers.get(nodeId).delete(userId);
      
      // Clean up empty sets
      if (this.typingUsers.get(nodeId).size === 0) {
        this.typingUsers.delete(nodeId);
      }
    }
    
    // Notify others
    await this.broadcastToNode(nodeId, planId, {
      type: 'typing_stop',
      nodeId: nodeId,
      userId: userId,
      timestamp: new Date()
    }, userId);
  }

  async handleUpdatePresence(userId, status, planId) {
    // Broadcast presence update to plan users
    if (planId) {
      await this.broadcastToPlan(planId, {
        type: 'presence_update',
        userId: userId,
        status: status,
        timestamp: new Date()
      }, userId);
    }
  }

  async broadcastToPlan(planId, message, excludeUserId = null) {
    const planUserIds = this.planUsers.get(planId);
    if (!planUserIds) return;
    
    for (const userId of planUserIds) {
      if (userId === excludeUserId) continue;
      
      const ws = this.connections.get(userId);
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(message));
      }
    }
  }

  async broadcastToNode(nodeId, planId, message, excludeUserId = null) {
    const nodeUserIds = this.nodeUsers.get(nodeId);
    if (!nodeUserIds) return;

    for (const userId of nodeUserIds) {
      if (userId === excludeUserId) continue;

      const ws = this.connections.get(userId);
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(message));
      }
    }
  }

  async broadcastToAll(message, excludeUserId = null) {
    // Broadcast to all connected users
    for (const [userId, ws] of this.connections) {
      if (userId === excludeUserId) continue;

      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(message));
      }
    }
  }

  // HTTP endpoints for getting active users
  async getActivePlanUsers(planId) {
    return Array.from(this.planUsers.get(planId) || []);
  }

  async getActiveNodeUsers(nodeId) {
    return Array.from(this.nodeUsers.get(nodeId) || []);
  }

  async getTypingUsers(nodeId) {
    return Array.from(this.typingUsers.get(nodeId) || []);
  }
}

module.exports = CollaborationServer;
