/**
 * Unit Tests for Plan Controller
 * Tests core CRUD operations for plans using DAL mocks
 */

const { v4: uuidv4 } = require('uuid');
const {
  createMockRequest,
  createMockResponse,
  createMockNext,
  createMockUser,
  createMockPlan,
  createMockRootNode
} = require('../../fixtures/testData');

// Mock DAL modules
jest.mock('../../../src/db/dal.cjs', () => {
  const plansDal = {
    findById: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    listForUser: jest.fn(),
    userHasAccess: jest.fn(),
  };
  const nodesDal = {
    create: jest.fn(),
    getRoot: jest.fn(),
    listByPlan: jest.fn(),
    update: jest.fn(),
  };
  const collaboratorsDal = {
    listByPlan: jest.fn(),
    deleteByPlan: jest.fn(),
  };
  const usersDal = {
    findById: jest.fn(),
  };
  return { plansDal, nodesDal, collaboratorsDal, usersDal };
});

jest.mock('../../../src/websocket/broadcast', () => ({
  broadcastPlanUpdate: jest.fn().mockResolvedValue(true),
  broadcastToAll: jest.fn().mockResolvedValue(true)
}));

const { plansDal, nodesDal, collaboratorsDal, usersDal } = require('../../../src/db/dal.cjs');
const planController = require('../../../src/controllers/plan.controller');

describe('Plan Controller', () => {
  let mockUser;
  let mockPlan;

  beforeEach(() => {
    jest.clearAllMocks();
    mockUser = createMockUser();
    mockPlan = createMockPlan({ owner_id: mockUser.id });
  });

  describe('createPlan', () => {
    it('should create a plan successfully with valid title', async () => {
      const req = createMockRequest({
        user: mockUser,
        body: { title: 'Test Plan', description: 'Test description' }
      });
      const res = createMockResponse();
      const next = createMockNext();

      plansDal.create.mockResolvedValue({
        id: expect.any(String),
        title: 'Test Plan',
        description: 'Test description',
        status: 'draft',
        ownerId: mockUser.id,
      });
      nodesDal.create.mockResolvedValue({ id: uuidv4() });
      nodesDal.listByPlan.mockResolvedValue([]); // for progress calculation

      await planController.createPlan(req, res, next);

      expect(res.status).toHaveBeenCalledWith(201);
      expect(res.json).toHaveBeenCalled();
      const responseData = res.json.mock.calls[0][0];
      expect(responseData.title).toBe('Test Plan');
      expect(responseData.progress).toBe(0);
    });

    it('should return 400 when title is missing', async () => {
      const req = createMockRequest({
        user: mockUser,
        body: { description: 'Test description' }
      });
      const res = createMockResponse();
      const next = createMockNext();

      await planController.createPlan(req, res, next);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ error: 'Title is required' });
    });

    it('should use default status "draft" when not provided', async () => {
      const req = createMockRequest({
        user: mockUser,
        body: { title: 'Test Plan' }
      });
      const res = createMockResponse();
      const next = createMockNext();

      plansDal.create.mockImplementation(async (data) => {
        expect(data.status).toBe('draft');
        return { ...data };
      });
      nodesDal.create.mockResolvedValue({ id: uuidv4() });
      nodesDal.listByPlan.mockResolvedValue([]);

      await planController.createPlan(req, res, next);
      expect(plansDal.create).toHaveBeenCalled();
    });
  });

  describe('getPlan', () => {
    it('should return plan with root node for owner', async () => {
      const planId = uuidv4();
      const req = createMockRequest({
        user: mockUser,
        params: { id: planId }
      });
      const res = createMockResponse();
      const next = createMockNext();

      const planData = { id: planId, ownerId: mockUser.id, title: 'Test', visibility: 'private', isPublic: false };
      plansDal.userHasAccess.mockResolvedValue({ hasAccess: true, role: 'owner' });
      plansDal.findById.mockResolvedValue(planData);
      nodesDal.getRoot.mockResolvedValue({ id: uuidv4(), nodeType: 'root', title: 'Test' });
      nodesDal.listByPlan.mockResolvedValue([]);

      await planController.getPlan(req, res, next);

      expect(res.json).toHaveBeenCalled();
      const responseData = res.json.mock.calls[0][0];
      expect(responseData.id).toBe(planId);
      expect(responseData.root_node).toBeDefined();
      expect(responseData.is_owner).toBe(true);
    });

    it('should return 403 when user has no access', async () => {
      const planId = uuidv4();
      const req = createMockRequest({
        user: mockUser,
        params: { id: planId }
      });
      const res = createMockResponse();
      const next = createMockNext();

      plansDal.userHasAccess.mockResolvedValue({ hasAccess: false, role: null });

      await planController.getPlan(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
    });

    it('should return 404 when plan not found', async () => {
      const planId = uuidv4();
      const req = createMockRequest({
        user: mockUser,
        params: { id: planId }
      });
      const res = createMockResponse();
      const next = createMockNext();

      plansDal.userHasAccess.mockResolvedValue({ hasAccess: true, role: 'owner' });
      plansDal.findById.mockResolvedValue(null);

      await planController.getPlan(req, res, next);

      expect(res.status).toHaveBeenCalledWith(404);
    });
  });

  describe('updatePlan', () => {
    it('should update plan title successfully', async () => {
      const planId = uuidv4();
      const req = createMockRequest({
        user: mockUser,
        params: { id: planId },
        body: { title: 'Updated Title' }
      });
      const res = createMockResponse();
      const next = createMockNext();

      plansDal.userHasAccess.mockResolvedValue({ hasAccess: true, role: 'owner' });
      plansDal.update.mockResolvedValue({ id: planId, title: 'Updated Title', ownerId: mockUser.id });
      nodesDal.getRoot.mockResolvedValue({ id: uuidv4() });
      nodesDal.update.mockResolvedValue({});
      nodesDal.listByPlan.mockResolvedValue([]);

      await planController.updatePlan(req, res, next);

      expect(res.json).toHaveBeenCalled();
      const responseData = res.json.mock.calls[0][0];
      expect(responseData.title).toBe('Updated Title');
    });

    it('should return 403 when user is not owner or admin', async () => {
      const planId = uuidv4();
      const req = createMockRequest({
        user: mockUser,
        params: { id: planId },
        body: { title: 'Updated Title' }
      });
      const res = createMockResponse();
      const next = createMockNext();

      plansDal.userHasAccess.mockResolvedValue({ hasAccess: true, role: 'viewer' });

      await planController.updatePlan(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
    });
  });

  describe('deletePlan', () => {
    it('should delete plan when user is owner', async () => {
      const planId = uuidv4();
      const req = createMockRequest({
        user: mockUser,
        params: { id: planId },
        query: {}
      });
      const res = createMockResponse();
      const next = createMockNext();

      plansDal.findById.mockResolvedValue({ id: planId, ownerId: mockUser.id });
      collaboratorsDal.deleteByPlan.mockResolvedValue();
      plansDal.delete.mockResolvedValue({ id: planId });

      await planController.deletePlan(req, res, next);

      expect(res.status).toHaveBeenCalledWith(204);
      expect(res.send).toHaveBeenCalled();
    });

    it('should archive plan when archive=true', async () => {
      const planId = uuidv4();
      const req = createMockRequest({
        user: mockUser,
        params: { id: planId },
        query: { archive: 'true' }
      });
      const res = createMockResponse();
      const next = createMockNext();

      plansDal.findById.mockResolvedValue({ id: planId, ownerId: mockUser.id });
      plansDal.update.mockResolvedValue({ id: planId, status: 'archived' });

      await planController.deletePlan(req, res, next);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ message: expect.stringContaining('archived') })
      );
    });

    it('should return 403 when user is not owner', async () => {
      const planId = uuidv4();
      const req = createMockRequest({
        user: mockUser,
        params: { id: planId },
        query: {}
      });
      const res = createMockResponse();
      const next = createMockNext();

      plansDal.findById.mockResolvedValue({ id: planId, ownerId: uuidv4() });

      await planController.deletePlan(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
    });

    it('should return 404 when plan not found', async () => {
      const planId = uuidv4();
      const req = createMockRequest({
        user: mockUser,
        params: { id: planId },
        query: {}
      });
      const res = createMockResponse();
      const next = createMockNext();

      plansDal.findById.mockResolvedValue(null);

      await planController.deletePlan(req, res, next);

      expect(res.status).toHaveBeenCalledWith(404);
    });
  });

  describe('listPlans', () => {
    it('should return empty array when user has no plans', async () => {
      const req = createMockRequest({ user: mockUser });
      const res = createMockResponse();
      const next = createMockNext();

      plansDal.listForUser.mockResolvedValue({ owned: [], shared: [] });

      await planController.listPlans(req, res, next);

      expect(res.json).toHaveBeenCalledWith([]);
    });

    it('should return owned plans with owner role', async () => {
      const req = createMockRequest({ user: mockUser });
      const res = createMockResponse();
      const next = createMockNext();

      const ownedPlan = { id: uuidv4(), title: 'My Plan', ownerId: mockUser.id };
      plansDal.listForUser.mockResolvedValue({ owned: [ownedPlan], shared: [] });
      nodesDal.listByPlan.mockResolvedValue([{ status: 'not_started' }]);

      await planController.listPlans(req, res, next);

      expect(res.json).toHaveBeenCalled();
      const responseData = res.json.mock.calls[0][0];
      expect(responseData.length).toBe(1);
      expect(responseData[0].role).toBe('owner');
      expect(responseData[0]).toHaveProperty('progress');
    });
  });

  describe('calculatePlanProgress', () => {
    it('should calculate 0% for plans with no completed nodes', async () => {
      nodesDal.listByPlan.mockResolvedValue([
        { status: 'not_started' },
        { status: 'in_progress' },
      ]);

      const progress = await planController.calculatePlanProgress(uuidv4());
      expect(progress).toBe(0);
    });
  });
});
