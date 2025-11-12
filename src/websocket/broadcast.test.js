/**
 * Unit tests for WebSocket broadcast utility module
 */

const {
  setCollaborationServer,
  getCollaborationServer,
  isServerAvailable,
  broadcastPlanUpdate,
  broadcastNodeUpdate,
  sendToUser,
  getActivePlanUsers,
  getActiveNodeUsers,
  getTypingUsers
} = require('./broadcast');

// Mock logger to suppress output during tests
jest.mock('../utils/logger', () => ({
  api: jest.fn(),
  error: jest.fn()
}));

describe('WebSocket Broadcast Utility', () => {
  let mockCollaborationServer;

  beforeEach(() => {
    // Create mock collaboration server
    mockCollaborationServer = {
      broadcastToPlan: jest.fn(),
      broadcastToNode: jest.fn(),
      getActivePlanUsers: jest.fn().mockResolvedValue([]),
      getActiveNodeUsers: jest.fn().mockResolvedValue([]),
      getTypingUsers: jest.fn().mockResolvedValue([]),
      connections: new Map()
    };

    // Reset the server instance before each test
    setCollaborationServer(null);
  });

  describe('Server Instance Management', () => {
    test('should set and get collaboration server', () => {
      setCollaborationServer(mockCollaborationServer);
      expect(getCollaborationServer()).toBe(mockCollaborationServer);
    });

    test('should report server availability correctly', () => {
      expect(isServerAvailable()).toBe(false);

      setCollaborationServer(mockCollaborationServer);
      expect(isServerAvailable()).toBe(true);

      setCollaborationServer(null);
      expect(isServerAvailable()).toBe(false);
    });
  });

  describe('broadcastPlanUpdate', () => {
    test('should broadcast to plan when server is available', async () => {
      setCollaborationServer(mockCollaborationServer);

      const planId = 'plan-123';
      const message = { type: 'test.event', payload: { data: 'test' } };

      const result = await broadcastPlanUpdate(planId, message);

      expect(result).toBe(true);
      expect(mockCollaborationServer.broadcastToPlan).toHaveBeenCalledWith(
        planId,
        message,
        null
      );
    });

    test('should exclude user when specified', async () => {
      setCollaborationServer(mockCollaborationServer);

      const planId = 'plan-123';
      const message = { type: 'test.event', payload: {} };
      const excludeUserId = 'user-456';

      await broadcastPlanUpdate(planId, message, excludeUserId);

      expect(mockCollaborationServer.broadcastToPlan).toHaveBeenCalledWith(
        planId,
        message,
        excludeUserId
      );
    });

    test('should return false when server is not available', async () => {
      // Don't set server
      const result = await broadcastPlanUpdate('plan-123', { type: 'test' });

      expect(result).toBe(false);
      expect(mockCollaborationServer.broadcastToPlan).not.toHaveBeenCalled();
    });

    test('should handle broadcast errors gracefully', async () => {
      setCollaborationServer(mockCollaborationServer);
      mockCollaborationServer.broadcastToPlan.mockImplementation(() => {
        throw new Error('WebSocket error');
      });

      const result = await broadcastPlanUpdate('plan-123', { type: 'test' });

      expect(result).toBe(false);
    });
  });

  describe('broadcastNodeUpdate', () => {
    test('should broadcast to node when server is available', async () => {
      setCollaborationServer(mockCollaborationServer);

      const nodeId = 'node-123';
      const planId = 'plan-456';
      const message = { type: 'test.event', payload: { data: 'test' } };

      const result = await broadcastNodeUpdate(nodeId, planId, message);

      expect(result).toBe(true);
      expect(mockCollaborationServer.broadcastToNode).toHaveBeenCalledWith(
        nodeId,
        planId,
        message,
        null
      );
    });

    test('should return false when server is not available', async () => {
      const result = await broadcastNodeUpdate('node-123', 'plan-456', { type: 'test' });

      expect(result).toBe(false);
      expect(mockCollaborationServer.broadcastToNode).not.toHaveBeenCalled();
    });
  });

  describe('sendToUser', () => {
    test('should send message to connected user', async () => {
      setCollaborationServer(mockCollaborationServer);

      const userId = 'user-123';
      const mockWebSocket = {
        readyState: 1, // WebSocket.OPEN
        send: jest.fn()
      };

      mockCollaborationServer.connections.set(userId, mockWebSocket);

      const message = { type: 'notification', payload: { text: 'Hello' } };
      const result = await sendToUser(userId, message);

      expect(result).toBe(true);
      expect(mockWebSocket.send).toHaveBeenCalledWith(JSON.stringify(message));
    });

    test('should return false for disconnected user', async () => {
      setCollaborationServer(mockCollaborationServer);

      const userId = 'user-123';
      const result = await sendToUser(userId, { type: 'test' });

      expect(result).toBe(false);
    });

    test('should return false when WebSocket is not open', async () => {
      setCollaborationServer(mockCollaborationServer);

      const userId = 'user-123';
      const mockWebSocket = {
        readyState: 0, // WebSocket.CONNECTING
        send: jest.fn()
      };

      mockCollaborationServer.connections.set(userId, mockWebSocket);

      const result = await sendToUser(userId, { type: 'test' });

      expect(result).toBe(false);
      expect(mockWebSocket.send).not.toHaveBeenCalled();
    });

    test('should handle send errors gracefully', async () => {
      setCollaborationServer(mockCollaborationServer);

      const userId = 'user-123';
      const mockWebSocket = {
        readyState: 1,
        send: jest.fn(() => {
          throw new Error('Send failed');
        })
      };

      mockCollaborationServer.connections.set(userId, mockWebSocket);

      const result = await sendToUser(userId, { type: 'test' });

      expect(result).toBe(false);
    });
  });

  describe('Utility Functions', () => {
    test('should get active plan users', async () => {
      setCollaborationServer(mockCollaborationServer);

      const activeUsers = ['user-1', 'user-2', 'user-3'];
      mockCollaborationServer.getActivePlanUsers.mockResolvedValue(activeUsers);

      const result = await getActivePlanUsers('plan-123');

      expect(result).toEqual(activeUsers);
      expect(mockCollaborationServer.getActivePlanUsers).toHaveBeenCalledWith('plan-123');
    });

    test('should return empty array when server unavailable', async () => {
      const result = await getActivePlanUsers('plan-123');
      expect(result).toEqual([]);
    });

    test('should get active node users', async () => {
      setCollaborationServer(mockCollaborationServer);

      const activeUsers = ['user-1', 'user-2'];
      mockCollaborationServer.getActiveNodeUsers.mockResolvedValue(activeUsers);

      const result = await getActiveNodeUsers('node-123');

      expect(result).toEqual(activeUsers);
      expect(mockCollaborationServer.getActiveNodeUsers).toHaveBeenCalledWith('node-123');
    });

    test('should get typing users', async () => {
      setCollaborationServer(mockCollaborationServer);

      const typingUsers = ['user-1'];
      mockCollaborationServer.getTypingUsers.mockResolvedValue(typingUsers);

      const result = await getTypingUsers('node-123');

      expect(result).toEqual(typingUsers);
      expect(mockCollaborationServer.getTypingUsers).toHaveBeenCalledWith('node-123');
    });

    test('should handle utility function errors', async () => {
      setCollaborationServer(mockCollaborationServer);

      mockCollaborationServer.getActivePlanUsers.mockRejectedValue(new Error('DB error'));

      const result = await getActivePlanUsers('plan-123');

      expect(result).toEqual([]);
    });
  });

  describe('Integration with Message Schema', () => {
    test('should work with message schema factory functions', async () => {
      setCollaborationServer(mockCollaborationServer);

      const { createNodeCreatedMessage } = require('./message-schema');

      const node = {
        id: 'node-123',
        plan_id: 'plan-456',
        title: 'Test Node',
        node_type: 'task',
        status: 'not_started',
        created_at: new Date().toISOString()
      };

      const message = createNodeCreatedMessage(node, 'user-789', 'Test User');
      await broadcastPlanUpdate(node.plan_id, message);

      expect(mockCollaborationServer.broadcastToPlan).toHaveBeenCalledWith(
        'plan-456',
        expect.objectContaining({
          type: 'node.created',
          payload: expect.objectContaining({
            id: 'node-123',
            title: 'Test Node'
          }),
          metadata: expect.objectContaining({
            userId: 'user-789',
            userName: 'Test User',
            planId: 'plan-456'
          })
        }),
        null
      );
    });
  });
});
