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

// Mock dependencies
jest.mock('../../../src/config/supabase');
jest.mock('../../../src/websocket/broadcast', () => ({
  broadcastPlanUpdate: jest.fn().mockResolvedValue(true)
}));

const { supabaseAdmin: supabase } = require('../../../src/config/supabase');
const decisionController = require('../../../src/controllers/decision.controller');

describe('Decision Controller', () => {
  let mockUser;
  let mockPlan;
  
  beforeEach(() => {
    jest.clearAllMocks();
    mockUser = createMockUser();
    mockPlan = createMockPlan({ owner_id: mockUser.id });
  });

  /**
   * Helper to setup plan access mock (owner)
   */
  const setupPlanAccessMock = (ownerId = mockUser.id) => {
    return {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({
        data: { owner_id: ownerId },
        error: null
      })
    };
  };

  /**
   * Helper to setup collaborator check mock (no collaboration)
   */
  const setupNoCollaboratorMock = () => {
    return {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({
        data: null,
        error: { code: 'PGRST116' }
      })
    };
  };

  describe('createDecisionRequest', () => {
    it('should create a decision request for plan owner', async () => {
      const planId = mockPlan.id;
      const decisionId = uuidv4();
      
      const req = createMockRequest({
        user: mockUser,
        params: { id: planId },
        body: {
          title: 'Choose database',
          context: 'We need to select a database for the project',
          urgency: 'can_continue',
          options: [
            { option: 'PostgreSQL', pros: ['ACID'], cons: ['Complex'], recommendation: true },
            { option: 'MongoDB', pros: ['Flexible'], cons: ['No ACID'] }
          ]
        }
      });
      const res = createMockResponse();
      const next = createMockNext();

      supabase.from.mockImplementation((table) => {
        if (table === 'plans') {
          return setupPlanAccessMock();
        }
        if (table === 'plan_collaborators') {
          return setupNoCollaboratorMock();
        }
        if (table === 'decision_requests') {
          return {
            insert: jest.fn().mockReturnThis(),
            select: jest.fn().mockReturnThis(),
            single: jest.fn().mockResolvedValue({
              data: {
                id: decisionId,
                plan_id: planId,
                title: 'Choose database',
                status: 'pending',
                urgency: 'can_continue'
              },
              error: null
            })
          };
        }
        return setupNoCollaboratorMock();
      });

      await decisionController.createDecisionRequest(req, res, next);

      expect(res.status).toHaveBeenCalledWith(201);
      expect(res.json).toHaveBeenCalled();
    });

    it('should reject creation without edit access', async () => {
      const planId = mockPlan.id;
      const otherUserId = uuidv4();
      
      const req = createMockRequest({
        user: mockUser,
        params: { id: planId },
        body: {
          title: 'Test decision',
          context: 'Test context'
        }
      });
      const res = createMockResponse();
      const next = createMockNext();

      supabase.from.mockImplementation((table) => {
        if (table === 'plans') {
          return {
            select: jest.fn().mockReturnThis(),
            eq: jest.fn().mockReturnThis(),
            single: jest.fn().mockResolvedValue({
              data: { owner_id: otherUserId }, // Different owner
              error: null
            })
          };
        }
        if (table === 'plan_collaborators') {
          return setupNoCollaboratorMock(); // Not a collaborator
        }
        return setupNoCollaboratorMock();
      });

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
        body: {
          decision: 'Go with PostgreSQL',
          rationale: 'Better for our relational data model'
        }
      });
      const res = createMockResponse();
      const next = createMockNext();

      supabase.from.mockImplementation((table) => {
        if (table === 'plans') {
          return setupPlanAccessMock();
        }
        if (table === 'plan_collaborators') {
          return setupNoCollaboratorMock();
        }
        if (table === 'decision_requests') {
          return {
            select: jest.fn().mockReturnThis(),
            eq: jest.fn().mockReturnValue({
              eq: jest.fn().mockReturnThis(),
              single: jest.fn().mockResolvedValue({
                data: { status: 'pending', title: 'Test', expires_at: null },
                error: null
              })
            }),
            update: jest.fn().mockReturnThis(),
            or: jest.fn().mockReturnThis()
          };
        }
        return setupNoCollaboratorMock();
      });

      // Mock the update chain separately
      const updateMock = {
        update: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        or: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({
          data: {
            id: decisionId,
            status: 'decided',
            decision: 'Go with PostgreSQL',
            rationale: 'Better for our relational data model'
          },
          error: null
        })
      };

      let callCount = 0;
      supabase.from.mockImplementation((table) => {
        if (table === 'plans') {
          return setupPlanAccessMock();
        }
        if (table === 'plan_collaborators') {
          return setupNoCollaboratorMock();
        }
        if (table === 'decision_requests') {
          callCount++;
          if (callCount === 1) {
            // First call: check exists
            return {
              select: jest.fn().mockReturnThis(),
              eq: jest.fn().mockReturnValue({
                eq: jest.fn().mockReturnThis(),
                single: jest.fn().mockResolvedValue({
                  data: { status: 'pending', title: 'Test', expires_at: null },
                  error: null
                })
              })
            };
          }
          // Second call: update
          return updateMock;
        }
        return setupNoCollaboratorMock();
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
        body: {
          decision: 'Too late'
        }
      });
      const res = createMockResponse();
      const next = createMockNext();

      supabase.from.mockImplementation((table) => {
        if (table === 'plans') {
          return setupPlanAccessMock();
        }
        if (table === 'plan_collaborators') {
          return setupNoCollaboratorMock();
        }
        if (table === 'decision_requests') {
          return {
            select: jest.fn().mockReturnThis(),
            eq: jest.fn().mockReturnValue({
              eq: jest.fn().mockReturnThis(),
              single: jest.fn().mockResolvedValue({
                data: { status: 'decided', title: 'Test' }, // Already decided
                error: null
              })
            })
          };
        }
        return setupNoCollaboratorMock();
      });

      await decisionController.resolveDecisionRequest(req, res, next);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ 
        error: 'Decision request has already been resolved' 
      });
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

      let capturedUpdate = null;
      
      const updateMock = {
        update: jest.fn().mockImplementation((data) => {
          capturedUpdate = data;
          return updateMock;
        }),
        eq: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({
          data: { id: decisionId, status: 'cancelled' },
          error: null
        })
      };

      let callCount = 0;
      supabase.from.mockImplementation((table) => {
        if (table === 'plans') {
          return setupPlanAccessMock();
        }
        if (table === 'plan_collaborators') {
          return setupNoCollaboratorMock();
        }
        if (table === 'decision_requests') {
          callCount++;
          if (callCount === 1) {
            return {
              select: jest.fn().mockReturnThis(),
              eq: jest.fn().mockReturnValue({
                eq: jest.fn().mockReturnThis(),
                single: jest.fn().mockResolvedValue({
                  data: { status: 'pending', metadata: existingMetadata },
                  error: null
                })
              })
            };
          }
          return updateMock;
        }
        return setupNoCollaboratorMock();
      });

      await decisionController.cancelDecisionRequest(req, res, next);

      // Verify metadata was merged, not replaced
      expect(capturedUpdate.metadata).toEqual({
        source: 'api',
        custom_field: 'value',
        cancellation_reason: 'No longer needed'
      });
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

      supabase.from.mockImplementation((table) => {
        if (table === 'plans') {
          return setupPlanAccessMock();
        }
        if (table === 'plan_collaborators') {
          return setupNoCollaboratorMock();
        }
        if (table === 'decision_requests') {
          return {
            select: jest.fn().mockReturnThis(),
            eq: jest.fn().mockReturnThis(),
            order: jest.fn().mockReturnThis(),
            range: jest.fn().mockResolvedValue({
              data: mockDecisions,
              error: null,
              count: 15 // Total count
            })
          };
        }
        return setupNoCollaboratorMock();
      });

      await decisionController.listDecisionRequests(req, res, next);

      expect(res.json).toHaveBeenCalled();
      const response = res.json.mock.calls[0][0];
      
      expect(response.data).toEqual(mockDecisions);
      expect(response.pagination).toEqual({
        total: 15,
        limit: 10,
        offset: 0,
        has_more: true
      });
    });
  });

  describe('Access Control', () => {
    it('should deny access to non-owner non-collaborator', async () => {
      const planId = mockPlan.id;
      const otherUserId = uuidv4();
      
      const req = createMockRequest({
        user: mockUser,
        params: { id: planId },
        query: {}
      });
      const res = createMockResponse();
      const next = createMockNext();

      supabase.from.mockImplementation((table) => {
        if (table === 'plans') {
          return {
            select: jest.fn().mockReturnThis(),
            eq: jest.fn().mockReturnThis(),
            single: jest.fn().mockResolvedValue({
              data: { owner_id: otherUserId },
              error: null
            })
          };
        }
        if (table === 'plan_collaborators') {
          return setupNoCollaboratorMock();
        }
        return setupNoCollaboratorMock();
      });

      await decisionController.listDecisionRequests(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
    });

    it('should allow access to collaborator with editor role', async () => {
      const planId = mockPlan.id;
      const otherUserId = uuidv4();
      
      const req = createMockRequest({
        user: mockUser,
        params: { id: planId },
        query: {}
      });
      const res = createMockResponse();
      const next = createMockNext();

      supabase.from.mockImplementation((table) => {
        if (table === 'plans') {
          return {
            select: jest.fn().mockReturnThis(),
            eq: jest.fn().mockReturnThis(),
            single: jest.fn().mockResolvedValue({
              data: { owner_id: otherUserId },
              error: null
            })
          };
        }
        if (table === 'plan_collaborators') {
          return {
            select: jest.fn().mockReturnThis(),
            eq: jest.fn().mockReturnThis(),
            single: jest.fn().mockResolvedValue({
              data: { role: 'editor' },
              error: null
            })
          };
        }
        if (table === 'decision_requests') {
          return {
            select: jest.fn().mockReturnThis(),
            eq: jest.fn().mockReturnThis(),
            order: jest.fn().mockReturnThis(),
            range: jest.fn().mockResolvedValue({
              data: [],
              error: null,
              count: 0
            })
          };
        }
        return setupNoCollaboratorMock();
      });

      await decisionController.listDecisionRequests(req, res, next);

      expect(res.json).toHaveBeenCalled();
    });
  });
});
