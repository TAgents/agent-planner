/**
 * Unit Tests for Decision Controller
 * Tests decision request CRUD, resolution, cancellation, and access control
 */

const { v4: uuidv4 } = require('uuid');
const {
  createMockRequest,
  createMockResponse,
  createMockNext,
  createMockUser,
  createMockPlan
} = require('../../fixtures/testData');

// Mock DAL modules
jest.mock('../../../src/db/dal.cjs', () => {
  const plansDal = {
    findById: jest.fn(),
    userHasAccess: jest.fn(),
  };
  const nodesDal = {
    findByIdAndPlan: jest.fn(),
  };
  const decisionsDal = {
    create: jest.fn(),
    findById: jest.fn(),
    update: jest.fn(),
    resolve: jest.fn(),
    listByPlan: jest.fn(),
  };
  return { plansDal, nodesDal, decisionsDal };
});

jest.mock('../../../src/websocket/broadcast', () => ({
  broadcastPlanUpdate: jest.fn().mockResolvedValue(true)
}));

jest.mock('../../../src/services/notifications', () => ({
  notifyDecisionRequested: jest.fn().mockResolvedValue(true),
  notifyDecisionResolved: jest.fn().mockResolvedValue(true),
}));

const { plansDal, decisionsDal } = require('../../../src/db/dal.cjs');
const decisionController = require('../../../src/controllers/decision.controller');

describe('Decision Controller', () => {
  let mockUser;
  let mockPlan;

  beforeEach(() => {
    jest.clearAllMocks();
    mockUser = createMockUser();
    mockPlan = createMockPlan({ owner_id: mockUser.id });
  });

  describe('createDecisionRequest', () => {
    it('should create a decision request for plan owner', async () => {
      const planId = mockPlan.id;
      const decisionId = uuidv4();
      const req = createMockRequest({
        user: mockUser,
        params: { id: planId },
        body: {
          title: 'Choose database',
          context: 'We need to select a database',
          urgency: 'can_continue',
          options: [
            { option: 'PostgreSQL', pros: ['ACID'], cons: ['Complex'], recommendation: true },
            { option: 'MongoDB', pros: ['Flexible'], cons: ['No ACID'] }
          ]
        }
      });
      const res = createMockResponse();
      const next = createMockNext();

      plansDal.userHasAccess.mockResolvedValue({ hasAccess: true, role: 'owner' });
      plansDal.findById.mockResolvedValue({ id: planId, ownerId: mockUser.id, title: 'Test Plan' });
      decisionsDal.create.mockResolvedValue({
        id: decisionId, planId, title: 'Choose database', status: 'pending', urgency: 'can_continue'
      });

      await decisionController.createDecisionRequest(req, res, next);

      expect(res.status).toHaveBeenCalledWith(201);
      expect(res.json).toHaveBeenCalled();
    });

    it('should reject creation without edit access', async () => {
      const req = createMockRequest({
        user: mockUser,
        params: { id: mockPlan.id },
        body: { title: 'Test decision', context: 'Test context' }
      });
      const res = createMockResponse();
      const next = createMockNext();

      plansDal.userHasAccess.mockResolvedValue({ hasAccess: true, role: 'viewer' });

      await decisionController.createDecisionRequest(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
    });
  });

  describe('resolveDecisionRequest', () => {
    it('should resolve a pending decision', async () => {
      const planId = mockPlan.id;
      const decisionId = uuidv4();
      const req = createMockRequest({
        user: mockUser,
        params: { id: planId, decisionId },
        body: { decision: 'Go with PostgreSQL', rationale: 'Better for relational data' }
      });
      const res = createMockResponse();
      const next = createMockNext();

      plansDal.userHasAccess.mockResolvedValue({ hasAccess: true, role: 'owner' });
      decisionsDal.findById.mockResolvedValue({ id: decisionId, planId, status: 'pending', title: 'Test', expiresAt: null });
      decisionsDal.resolve.mockResolvedValue({
        id: decisionId, status: 'decided', decision: 'Go with PostgreSQL'
      });

      await decisionController.resolveDecisionRequest(req, res, next);

      expect(res.json).toHaveBeenCalled();
    });

    it('should reject resolving already resolved decision', async () => {
      const planId = mockPlan.id;
      const decisionId = uuidv4();
      const req = createMockRequest({
        user: mockUser,
        params: { id: planId, decisionId },
        body: { decision: 'Too late' }
      });
      const res = createMockResponse();
      const next = createMockNext();

      plansDal.userHasAccess.mockResolvedValue({ hasAccess: true, role: 'owner' });
      decisionsDal.findById.mockResolvedValue({ id: decisionId, planId, status: 'decided', title: 'Test' });

      await decisionController.resolveDecisionRequest(req, res, next);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ error: 'Decision request has already been resolved' });
    });
  });

  describe('cancelDecisionRequest', () => {
    it('should preserve existing metadata when cancelling', async () => {
      const planId = mockPlan.id;
      const decisionId = uuidv4();
      const existingMetadata = { source: 'api', custom_field: 'value' };
      const req = createMockRequest({
        user: mockUser,
        params: { id: planId, decisionId },
        body: { reason: 'No longer needed' }
      });
      const res = createMockResponse();
      const next = createMockNext();

      plansDal.userHasAccess.mockResolvedValue({ hasAccess: true, role: 'owner' });
      decisionsDal.findById.mockResolvedValue({
        id: decisionId, planId, status: 'pending', metadata: existingMetadata
      });
      decisionsDal.update.mockImplementation(async (id, data) => {
        expect(data.metadata).toEqual({
          source: 'api',
          custom_field: 'value',
          cancellation_reason: 'No longer needed'
        });
        return { id: decisionId, status: 'cancelled', ...data };
      });

      await decisionController.cancelDecisionRequest(req, res, next);

      expect(decisionsDal.update).toHaveBeenCalled();
    });
  });

  describe('listDecisionRequests', () => {
    it('should return decisions with pagination metadata', async () => {
      const planId = mockPlan.id;
      const req = createMockRequest({
        user: mockUser,
        params: { id: planId },
        query: { limit: 10, offset: 0 }
      });
      const res = createMockResponse();
      const next = createMockNext();

      const mockDecisions = [
        { id: uuidv4(), title: 'Decision 1', status: 'pending' },
        { id: uuidv4(), title: 'Decision 2', status: 'decided' }
      ];

      plansDal.userHasAccess.mockResolvedValue({ hasAccess: true, role: 'owner' });
      decisionsDal.listByPlan.mockResolvedValue(mockDecisions);

      await decisionController.listDecisionRequests(req, res, next);

      expect(res.json).toHaveBeenCalled();
      const response = res.json.mock.calls[0][0];
      expect(response.data).toBeDefined();
    });
  });

  describe('Access Control', () => {
    it('should deny access to non-owner non-collaborator', async () => {
      const req = createMockRequest({
        user: mockUser,
        params: { id: mockPlan.id },
        query: {}
      });
      const res = createMockResponse();
      const next = createMockNext();

      plansDal.userHasAccess.mockResolvedValue({ hasAccess: false, role: null });

      await decisionController.listDecisionRequests(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
    });

    it('should allow access to collaborator with editor role', async () => {
      const req = createMockRequest({
        user: mockUser,
        params: { id: mockPlan.id },
        query: {}
      });
      const res = createMockResponse();
      const next = createMockNext();

      plansDal.userHasAccess.mockResolvedValue({ hasAccess: true, role: 'editor' });
      decisionsDal.listByPlan.mockResolvedValue([]);

      await decisionController.listDecisionRequests(req, res, next);

      expect(res.json).toHaveBeenCalled();
    });
  });
});
