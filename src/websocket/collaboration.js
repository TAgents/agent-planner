const WebSocket = require('ws');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const dal = require('../db/dal.cjs');
const logger = require('../utils/logger');

class CollaborationServer {
  constructor(server) {
    this.wss = new WebSocket.Server({ server, path: '/ws/collaborate' });
    this.connections = new Map();
    this.planUsers = new Map();
    this.nodeUsers = new Map();
    this.typingUsers = new Map();
    this.setupWebSocketServer();
  }

  setupWebSocketServer() {
    this.wss.on('connection', async (ws, req) => {
      let userId = null;
      let currentPlanId = null;
      let currentNodeId = null;

      try {
        const token = this.extractToken(req);
        const authResult = await this.authenticateUser(token);
        if (!authResult.user) {
          if (authResult.error?.code === 'bad_jwt') {
            ws.close(4001, 'Token expired or invalid');
          } else {
            ws.close(1008, 'Authentication failed');
          }
          return;
        }

        userId = authResult.user.id;
        this.connections.set(userId, ws);
        ws.send(JSON.stringify({ type: 'connection', status: 'connected', userId }));
      } catch (error) {
        ws.close(1008, 'Authentication failed');
        return;
      }

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
              if (currentPlanId && data.message) {
                await this.broadcastToPlan(currentPlanId, { type: 'message', userId, message: data.message, timestamp: new Date() }, userId);
              }
              break;
            case 'ping':
              ws.send(JSON.stringify({ type: 'pong' }));
              break;
          }
        } catch (error) {
          ws.send(JSON.stringify({ type: 'error', message: 'Failed to process message' }));
        }
      });

      ws.on('close', async () => {
        if (userId) {
          this.connections.delete(userId);
          if (currentNodeId) await this.handleLeaveNode(userId, currentNodeId, currentPlanId);
          if (currentPlanId) await this.handleLeavePlan(userId, currentPlanId);
        }
      });

      ws.on('error', async (error) => {
        await logger.error(`WebSocket error for user ${userId}:`, error);
      });
    });
  }

  extractToken(req) {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const token = url.searchParams.get('token');
    if (!token) {
      const auth = req.headers.authorization;
      if (auth?.startsWith('Bearer ')) return auth.substring(7);
    }
    return token;
  }

  async authenticateUser(token) {
    if (!token) return { user: null, error: { code: 'no_token' } };
    try {
      // Try JWT first
      const payload = jwt.verify(token, process.env.JWT_SECRET);
      if (payload && payload.sub) {
        return {
          user: { id: payload.sub, email: payload.email, name: payload.name },
          error: null
        };
      }
    } catch {
      // Not a valid JWT — try API token
    }
    try {
      const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
      const tokenData = await dal.tokensDal.findByHash(tokenHash);
      if (tokenData && !tokenData.revoked) {
        const user = await dal.usersDal.findById(tokenData.userId);
        if (user) {
          return { user: { id: user.id, email: user.email, name: user.name }, error: null };
        }
      }
    } catch {
      // Not a valid API token either
    }
    return { user: null, error: { code: 'invalid_token' } };
  }

  async handleJoinPlan(userId, planId, previousPlanId, ws) {
    if (previousPlanId) await this.handleLeavePlan(userId, previousPlanId);
    if (!this.planUsers.has(planId)) this.planUsers.set(planId, new Set());
    this.planUsers.get(planId).add(userId);
    await this.broadcastToPlan(planId, { type: 'user_joined_plan', userId, timestamp: new Date() }, userId);
    ws.send(JSON.stringify({ type: 'active_users', planId, users: Array.from(this.planUsers.get(planId) || []) }));
  }

  async handleLeavePlan(userId, planId) {
    if (!planId) return;
    if (this.planUsers.has(planId)) {
      this.planUsers.get(planId).delete(userId);
      if (this.planUsers.get(planId).size === 0) this.planUsers.delete(planId);
    }
    await this.broadcastToPlan(planId, { type: 'user_left_plan', userId, timestamp: new Date() }, userId);
  }

  async handleJoinNode(userId, nodeId, previousNodeId, planId, ws) {
    if (previousNodeId) await this.handleLeaveNode(userId, previousNodeId, planId);
    if (!this.nodeUsers.has(nodeId)) this.nodeUsers.set(nodeId, new Set());
    this.nodeUsers.get(nodeId).add(userId);
    await this.broadcastToNode(nodeId, planId, { type: 'user_joined_node', nodeId, userId, timestamp: new Date() }, userId);
    ws.send(JSON.stringify({ type: 'node_viewers', nodeId, users: Array.from(this.nodeUsers.get(nodeId) || []) }));
  }

  async handleLeaveNode(userId, nodeId, planId) {
    if (!nodeId) return;
    if (this.nodeUsers.has(nodeId)) {
      this.nodeUsers.get(nodeId).delete(userId);
      if (this.nodeUsers.get(nodeId).size === 0) this.nodeUsers.delete(nodeId);
    }
    if (this.typingUsers.has(nodeId)) this.typingUsers.get(nodeId).delete(userId);
    await this.broadcastToNode(nodeId, planId, { type: 'user_left_node', nodeId, userId, timestamp: new Date() }, userId);
  }

  async handleTypingStart(userId, nodeId, planId) {
    if (!this.typingUsers.has(nodeId)) this.typingUsers.set(nodeId, new Set());
    this.typingUsers.get(nodeId).add(userId);
    await this.broadcastToNode(nodeId, planId, { type: 'typing_start', nodeId, userId, timestamp: new Date() }, userId);
    setTimeout(() => this.handleTypingStop(userId, nodeId, planId), 5000);
  }

  async handleTypingStop(userId, nodeId, planId) {
    if (this.typingUsers.has(nodeId)) {
      this.typingUsers.get(nodeId).delete(userId);
      if (this.typingUsers.get(nodeId).size === 0) this.typingUsers.delete(nodeId);
    }
    await this.broadcastToNode(nodeId, planId, { type: 'typing_stop', nodeId, userId, timestamp: new Date() }, userId);
  }

  async handleUpdatePresence(userId, status, planId) {
    if (planId) {
      await this.broadcastToPlan(planId, { type: 'presence_update', userId, status, timestamp: new Date() }, userId);
    }
  }

  async broadcastToPlan(planId, message, excludeUserId = null) {
    const planUserIds = this.planUsers.get(planId);
    if (!planUserIds) return;
    for (const userId of planUserIds) {
      if (userId === excludeUserId) continue;
      const ws = this.connections.get(userId);
      if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message));
    }
  }

  async broadcastToNode(nodeId, planId, message, excludeUserId = null) {
    const nodeUserIds = this.nodeUsers.get(nodeId);
    if (!nodeUserIds) return;
    for (const userId of nodeUserIds) {
      if (userId === excludeUserId) continue;
      const ws = this.connections.get(userId);
      if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message));
    }
  }

  async broadcastToAll(message, excludeUserId = null) {
    for (const [userId, ws] of this.connections) {
      if (userId === excludeUserId) continue;
      if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message));
    }
  }

  async getActivePlanUsers(planId) { return Array.from(this.planUsers.get(planId) || []); }
  async getActiveNodeUsers(nodeId) { return Array.from(this.nodeUsers.get(nodeId) || []); }
  async getTypingUsers(nodeId) { return Array.from(this.typingUsers.get(nodeId) || []); }
}

module.exports = CollaborationServer;
