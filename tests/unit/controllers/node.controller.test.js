/**
 * Unit Tests for Node Controller
 * Tests CRUD operations for plan nodes using DAL mocks
 */

const { v4: uuidv4 } = require('uuid');
const {
  createMockRequest,
  createMockResponse,
  createMockNext,
  createMockUser,
  createMockPlan,
  createMockRootNode,
  createMockPhaseNode,
  createMockTaskNode
} = require('../../fixtures/testData');

// Mock DAL modules
jest.mock('../../../src/db/dal.cjs', () => {
  const plansDal = {
    findById: jest.fn(),
    userHasAccess: jest.fn(),
  };
  const nodesDal = {
    findById: jest.fn(),
    findByIdAndPlan: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    deleteByIds: jest.fn(),
    listByPlan: jest.fn(),
    getRoot: jest.fn(),
    getChildren: jest.fn(),
    getMaxSiblingOrder: jest.fn(),
    setAgentRequest: jest.fn(),
    clearAgentRequest: jest.fn(),
    assignAgent: jest.fn(),
  };
  const usersDal = {
    findById: jest.fn(),
    list: jest.fn(),
  };
  const logsDal = {
    create: jest.fn(),
    listByNode: jest.fn(),
  };
  return { plansDal, nodesDal, usersDal, logsDal };
});

jest.mock('../../../src/websocket/broadcast', () => ({
  broadcastPlanUpdate: jest.fn().mockResolvedValue(true)
}));

jest.mock('../../../src/services/notifications', () => ({
  notifyStatusChange: jest.fn().mockResolvedValue(true),
  notifyAgentRequested: jest.fn().mockResolvedValue(true),
}));

jest.mock('../../../src/utils/logger', () => ({
  error: jest.fn(),
  api: jest.fn(),
}));

const { plansDal, nodesDal, usersDal, logsDal } = require('../../../src/db/dal.cjs');
const nodeController = require('../../../src/controllers/node.controller');

describe('Node Controller', () => {
  let mockUser;
  let mockPlan;
  let mockRootNode;

  beforeEach(() => {
    jest.clearAllMocks();
    mockUser = createMockUser();
    mockPlan = createMockPlan({ owner_id: mockUser.id });
    mockRootNode = createMockRootNode(mockPlan.id, mockPlan.title);
  });

  describe('getNodes', () => {
    it('should return hierarchical tree structure for authorized user', async () => {
      const planId = mockPlan.id;
      const req = createMockRequest({ user: mockUser, params: { id: planId }, query: {} });
      const res = createMockResponse();
      const next = createMockNext();

      const phase = createMockPhaseNode(planId, mockRootNode.id, { order_index: 0 });
      const task1 = createMockTaskNode(planId, phase.id, { order_index: 0 });

      plansDal.userHasAccess.mockResolvedValue({ hasAccess: true, role: 'owner' });
      nodesDal.listByPlan.mockResolvedValue([
        { ...mockRootNode, parentId: null },
        { ...phase, parentId: mockRootNode.id },
        { ...task1, parentId: phase.id }
      ]);

      await nodeController.getNodes(req, res, next);

      expect(res.json).toHaveBeenCalled();
      const tree = res.json.mock.calls[0][0];
      expect(Array.isArray(tree)).toBe(true);
    });

    it('should return 403 when user has no access', async () => {
      const req = createMockRequest({ user: mockUser, params: { id: mockPlan.id }, query: {} });
      const res = createMockResponse();
      const next = createMockNext();

      plansDal.userHasAccess.mockResolvedValue({ hasAccess: false, role: null });

      await nodeController.getNodes(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
    });
  });

  describe('getNode', () => {
    it('should return a specific node for authorized user', async () => {
      const planId = mockPlan.id;
      const nodeId = uuidv4();
      const req = createMockRequest({ user: mockUser, params: { id: planId, nodeId } });
      const res = createMockResponse();
      const next = createMockNext();

      const taskNode = { id: nodeId, planId, nodeType: 'task', title: 'Test Task' };
      plansDal.userHasAccess.mockResolvedValue({ hasAccess: true, role: 'owner' });
      nodesDal.findByIdAndPlan.mockResolvedValue(taskNode);

      await nodeController.getNode(req, res, next);

      expect(res.json).toHaveBeenCalled();
      expect(res.json.mock.calls[0][0].id).toBe(nodeId);
    });

    it('should return 404 when node not found', async () => {
      const req = createMockRequest({ user: mockUser, params: { id: mockPlan.id, nodeId: uuidv4() } });
      const res = createMockResponse();
      const next = createMockNext();

      plansDal.userHasAccess.mockResolvedValue({ hasAccess: true, role: 'owner' });
      nodesDal.findByIdAndPlan.mockResolvedValue(null);

      await nodeController.getNode(req, res, next);

      expect(res.status).toHaveBeenCalledWith(404);
    });

    it('should return 403 when user has no access to plan', async () => {
      const req = createMockRequest({ user: mockUser, params: { id: mockPlan.id, nodeId: uuidv4() } });
      const res = createMockResponse();
      const next = createMockNext();

      plansDal.userHasAccess.mockResolvedValue({ hasAccess: false, role: null });

      await nodeController.getNode(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
    });
  });

  describe('createNode', () => {
    it('should return 400 when title is missing', async () => {
      const req = createMockRequest({
        user: mockUser,
        params: { id: mockPlan.id },
        body: { parent_id: mockRootNode.id, node_type: 'task' }
      });
      const res = createMockResponse();
      const next = createMockNext();

      plansDal.userHasAccess.mockResolvedValue({ hasAccess: true, role: 'owner' });

      await nodeController.createNode(req, res, next);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.stringContaining('title') }));
    });

    it('should return 400 when node_type is missing', async () => {
      const req = createMockRequest({
        user: mockUser,
        params: { id: mockPlan.id },
        body: { parent_id: mockRootNode.id, title: 'Test Task' }
      });
      const res = createMockResponse();
      const next = createMockNext();

      plansDal.userHasAccess.mockResolvedValue({ hasAccess: true, role: 'owner' });

      await nodeController.createNode(req, res, next);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.stringContaining('type') }));
    });

    it('should return 400 when trying to create root node', async () => {
      const req = createMockRequest({
        user: mockUser,
        params: { id: mockPlan.id },
        body: { parent_id: mockRootNode.id, node_type: 'root', title: 'Another Root' }
      });
      const res = createMockResponse();
      const next = createMockNext();

      plansDal.userHasAccess.mockResolvedValue({ hasAccess: true, role: 'owner' });

      await nodeController.createNode(req, res, next);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.stringContaining('root') }));
    });

    it('should return 403 when user has no edit access', async () => {
      const req = createMockRequest({
        user: mockUser,
        params: { id: mockPlan.id },
        body: { parent_id: mockRootNode.id, node_type: 'task', title: 'Test Task' }
      });
      const res = createMockResponse();
      const next = createMockNext();

      plansDal.userHasAccess.mockResolvedValue({ hasAccess: true, role: 'viewer' });

      await nodeController.createNode(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
    });
  });

  describe('updateNode', () => {
    it('should return 403 when user has no edit access', async () => {
      const req = createMockRequest({
        user: mockUser,
        params: { id: mockPlan.id, nodeId: uuidv4() },
        body: { title: 'Updated Title' }
      });
      const res = createMockResponse();
      const next = createMockNext();

      plansDal.userHasAccess.mockResolvedValue({ hasAccess: true, role: 'viewer' });

      await nodeController.updateNode(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
    });

    it('should return 404 when node not found', async () => {
      const req = createMockRequest({
        user: mockUser,
        params: { id: mockPlan.id, nodeId: uuidv4() },
        body: { title: 'Updated Title' }
      });
      const res = createMockResponse();
      const next = createMockNext();

      plansDal.userHasAccess.mockResolvedValue({ hasAccess: true, role: 'owner' });
      nodesDal.findByIdAndPlan.mockResolvedValue(null);

      await nodeController.updateNode(req, res, next);

      expect(res.status).toHaveBeenCalledWith(404);
    });

    it('should return 400 when trying to change root node type', async () => {
      const req = createMockRequest({
        user: mockUser,
        params: { id: mockPlan.id, nodeId: mockRootNode.id },
        body: { node_type: 'task' }
      });
      const res = createMockResponse();
      const next = createMockNext();

      plansDal.userHasAccess.mockResolvedValue({ hasAccess: true, role: 'owner' });
      nodesDal.findByIdAndPlan.mockResolvedValue({ id: mockRootNode.id, nodeType: 'root', status: 'not_started' });

      await nodeController.updateNode(req, res, next);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.stringContaining('root') }));
    });
  });

  describe('addLogEntry', () => {
    it('should create log entry with actor_type agent', async () => {
      const nodeId = uuidv4();
      const planId = mockPlan.id;
      const req = createMockRequest({
        user: mockUser,
        params: { id: planId, nodeId },
        body: { content: 'Agent performed task', log_type: 'progress', actor_type: 'agent' }
      });
      const res = createMockResponse();
      const next = createMockNext();

      plansDal.userHasAccess.mockResolvedValue({ hasAccess: true, role: 'owner' });
      nodesDal.findByIdAndPlan.mockResolvedValue({ id: nodeId });
      logsDal.create.mockResolvedValue({
        id: uuidv4(), planNodeId: nodeId, userId: mockUser.id,
        content: 'Agent performed task', logType: 'progress',
        metadata: { actor_type: 'agent' }, createdAt: new Date()
      });

      await nodeController.addLogEntry(req, res, next);

      expect(res.status).toHaveBeenCalledWith(201);
      expect(res.json).toHaveBeenCalled();
    });

    it('should create log entry with actor_type human', async () => {
      const nodeId = uuidv4();
      const req = createMockRequest({
        user: mockUser,
        params: { id: mockPlan.id, nodeId },
        body: { content: 'Human added note', log_type: 'decision', actor_type: 'human' }
      });
      const res = createMockResponse();
      const next = createMockNext();

      plansDal.userHasAccess.mockResolvedValue({ hasAccess: true, role: 'owner' });
      nodesDal.findByIdAndPlan.mockResolvedValue({ id: nodeId });
      logsDal.create.mockResolvedValue({
        id: uuidv4(), planNodeId: nodeId, content: 'Human added note',
        logType: 'decision', metadata: { actor_type: 'human' }, createdAt: new Date()
      });

      await nodeController.addLogEntry(req, res, next);

      expect(res.status).toHaveBeenCalledWith(201);
    });

    it('should create log entry without actor_type', async () => {
      const nodeId = uuidv4();
      const req = createMockRequest({
        user: mockUser,
        params: { id: mockPlan.id, nodeId },
        body: { content: 'Log without actor', log_type: 'progress' }
      });
      const res = createMockResponse();
      const next = createMockNext();

      plansDal.userHasAccess.mockResolvedValue({ hasAccess: true, role: 'owner' });
      nodesDal.findByIdAndPlan.mockResolvedValue({ id: nodeId });
      logsDal.create.mockResolvedValue({
        id: uuidv4(), planNodeId: nodeId, content: 'Log without actor',
        logType: 'progress', metadata: {}, createdAt: new Date()
      });

      await nodeController.addLogEntry(req, res, next);

      expect(res.status).toHaveBeenCalledWith(201);
    });
  });

  describe('getNodeLogs', () => {
    it('should return logs with actor_type field', async () => {
      const nodeId = uuidv4();
      const req = createMockRequest({
        user: mockUser,
        params: { id: mockPlan.id, nodeId },
        query: {}
      });
      const res = createMockResponse();
      const next = createMockNext();

      plansDal.userHasAccess.mockResolvedValue({ hasAccess: true, role: 'owner' });
      nodesDal.findByIdAndPlan.mockResolvedValue({ id: nodeId });
      logsDal.listByNode.mockResolvedValue([
        { id: uuidv4(), userId: mockUser.id, userName: 'Test', userEmail: 'test@test.com',
          content: 'Agent log', logType: 'progress', metadata: { actor_type: 'agent' }, createdAt: new Date() },
        { id: uuidv4(), userId: mockUser.id, userName: 'Test', userEmail: 'test@test.com',
          content: 'Human log', logType: 'decision', metadata: { actor_type: 'human' }, createdAt: new Date() },
      ]);

      await nodeController.getNodeLogs(req, res, next);

      expect(res.json).toHaveBeenCalled();
      const responseData = res.json.mock.calls[0][0];
      expect(responseData[0].actor_type).toBe('agent');
      expect(responseData[1].actor_type).toBe('human');
      expect(responseData[0].metadata).toBeUndefined();
    });

    it('should default actor_type to human for legacy logs', async () => {
      const nodeId = uuidv4();
      const req = createMockRequest({
        user: mockUser,
        params: { id: mockPlan.id, nodeId },
        query: {}
      });
      const res = createMockResponse();
      const next = createMockNext();

      plansDal.userHasAccess.mockResolvedValue({ hasAccess: true, role: 'owner' });
      nodesDal.findByIdAndPlan.mockResolvedValue({ id: nodeId });
      logsDal.listByNode.mockResolvedValue([
        { id: uuidv4(), userId: mockUser.id, userName: null, userEmail: null,
          content: 'Legacy log', logType: 'progress', metadata: {}, createdAt: new Date() },
        { id: uuidv4(), userId: mockUser.id, userName: null, userEmail: null,
          content: 'Null metadata', logType: 'progress', metadata: null, createdAt: new Date() },
      ]);

      await nodeController.getNodeLogs(req, res, next);

      expect(res.json).toHaveBeenCalled();
      const responseData = res.json.mock.calls[0][0];
      expect(responseData[0].actor_type).toBe('human');
      expect(responseData[1].actor_type).toBe('human');
    });
  });

  describe('checkPlanAccess helper (via getNodes)', () => {
    it('should grant access to plan owner', async () => {
      const req = createMockRequest({ user: mockUser, params: { id: mockPlan.id }, query: {} });
      const res = createMockResponse();
      const next = createMockNext();

      plansDal.userHasAccess.mockResolvedValue({ hasAccess: true, role: 'owner' });
      nodesDal.listByPlan.mockResolvedValue([mockRootNode]);

      await nodeController.getNodes(req, res, next);

      expect(res.status).not.toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalled();
    });

    it('should grant access to collaborator with proper role', async () => {
      const req = createMockRequest({ user: mockUser, params: { id: mockPlan.id }, query: {} });
      const res = createMockResponse();
      const next = createMockNext();

      plansDal.userHasAccess.mockResolvedValue({ hasAccess: true, role: 'editor' });
      nodesDal.listByPlan.mockResolvedValue([mockRootNode]);

      await nodeController.getNodes(req, res, next);

      expect(res.status).not.toHaveBeenCalledWith(403);
    });

    it('should deny access when user is neither owner nor collaborator', async () => {
      const req = createMockRequest({ user: mockUser, params: { id: mockPlan.id }, query: {} });
      const res = createMockResponse();
      const next = createMockNext();

      plansDal.userHasAccess.mockResolvedValue({ hasAccess: false, role: null });

      await nodeController.getNodes(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
    });
  });
});
