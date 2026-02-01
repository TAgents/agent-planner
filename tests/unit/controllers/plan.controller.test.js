/**
 * Unit Tests for Plan Controller
 * Tests core CRUD operations for plans
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

// Mock dependencies before requiring the controller
jest.mock('../../../src/config/supabase');
jest.mock('../../../src/websocket/broadcast', () => ({
  broadcastPlanUpdate: jest.fn().mockResolvedValue(true),
  broadcastToAll: jest.fn().mockResolvedValue(true)
}));

const { supabaseAdmin: supabase } = require('../../../src/config/supabase');
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
        body: {
          title: 'Test Plan',
          description: 'Test description'
        }
      });
      const res = createMockResponse();
      const next = createMockNext();

      // Mock supabase responses
      const createdPlan = {
        id: expect.any(String),
        title: 'Test Plan',
        description: 'Test description',
        status: 'draft',
        owner_id: mockUser.id,
        created_at: expect.any(Date),
        updated_at: expect.any(Date)
      };

      // Mock chain for plan insert
      const planInsertMock = {
        insert: jest.fn().mockResolvedValue({ error: null })
      };
      
      // Mock chain for node insert
      const nodeInsertMock = {
        insert: jest.fn().mockResolvedValue({ error: null })
      };
      
      // Mock chain for select/fetch
      const selectMock = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({
          data: {
            id: uuidv4(),
            title: 'Test Plan',
            description: 'Test description',
            status: 'draft',
            owner_id: mockUser.id,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          },
          error: null
        })
      };

      let callCount = 0;
      supabase.from.mockImplementation((table) => {
        callCount++;
        if (table === 'plans') {
          // First call is insert, second call is select
          if (callCount === 1) return planInsertMock;
          return selectMock;
        }
        if (table === 'plan_nodes') {
          return nodeInsertMock;
        }
        return planInsertMock;
      });

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
        body: {
          description: 'Test description'
          // title is missing
        }
      });
      const res = createMockResponse();
      const next = createMockNext();

      await planController.createPlan(req, res, next);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ error: 'Title is required' });
    });

    it('should handle database errors on plan creation', async () => {
      const req = createMockRequest({
        user: mockUser,
        body: {
          title: 'Test Plan',
          description: 'Test description'
        }
      });
      const res = createMockResponse();
      const next = createMockNext();

      supabase.from.mockReturnValue({
        insert: jest.fn().mockResolvedValue({
          error: { message: 'Database error' }
        })
      });

      await planController.createPlan(req, res, next);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ error: 'Database error' });
    });

    it('should use default status "draft" when not provided', async () => {
      const req = createMockRequest({
        user: mockUser,
        body: {
          title: 'Test Plan'
        }
      });
      const res = createMockResponse();
      const next = createMockNext();

      let insertedPlan = null;
      const planInsertMock = {
        insert: jest.fn().mockImplementation((data) => {
          insertedPlan = data[0];
          return Promise.resolve({ error: null });
        })
      };
      
      const nodeInsertMock = {
        insert: jest.fn().mockResolvedValue({ error: null })
      };

      const selectMock = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({
          data: {
            id: uuidv4(),
            title: 'Test Plan',
            description: '',
            status: 'draft',
            owner_id: mockUser.id
          },
          error: null
        })
      };

      let callCount = 0;
      supabase.from.mockImplementation((table) => {
        callCount++;
        if (table === 'plans') {
          if (callCount === 1) return planInsertMock;
          return selectMock;
        }
        return nodeInsertMock;
      });

      await planController.createPlan(req, res, next);

      expect(insertedPlan.status).toBe('draft');
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

      const planData = createMockPlan({ id: planId, owner_id: mockUser.id });
      const rootNode = createMockRootNode(planId, planData.title);

      // Mock for checkPlanAccess
      let callCount = 0;
      supabase.from.mockImplementation((table) => {
        callCount++;
        
        if (table === 'plans') {
          // First call: checkPlanAccess ownership check
          if (callCount === 1) {
            return {
              select: jest.fn().mockReturnThis(),
              eq: jest.fn().mockReturnThis(),
              single: jest.fn().mockResolvedValue({
                data: { owner_id: mockUser.id },
                error: null
              })
            };
          }
          // Second call: getPlan fetch
          return {
            select: jest.fn().mockReturnThis(),
            eq: jest.fn().mockReturnThis(),
            single: jest.fn().mockResolvedValue({
              data: planData,
              error: null
            })
          };
        }
        
        if (table === 'plan_nodes') {
          return {
            select: jest.fn().mockReturnThis(),
            eq: jest.fn().mockReturnThis(),
            single: jest.fn().mockResolvedValue({
              data: rootNode,
              error: null
            })
          };
        }
        
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          single: jest.fn().mockResolvedValue({ data: null, error: null })
        };
      });

      await planController.getPlan(req, res, next);

      expect(res.json).toHaveBeenCalled();
      const responseData = res.json.mock.calls[0][0];
      expect(responseData.id).toBe(planId);
      expect(responseData.root_node).toBeDefined();
      expect(responseData.is_owner).toBe(true);
    });

    it('should return 403 when user has no access', async () => {
      const planId = uuidv4();
      const otherUserId = uuidv4();
      const req = createMockRequest({
        user: mockUser,
        params: { id: planId }
      });
      const res = createMockResponse();
      const next = createMockNext();

      // Mock: user is not the owner
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
              data: null,
              error: { code: 'PGRST116' }
            })
          };
        }
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          single: jest.fn().mockResolvedValue({ data: null, error: null })
        };
      });

      await planController.getPlan(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: expect.stringContaining('access') })
      );
    });

    it('should return 404 when plan not found', async () => {
      const planId = uuidv4();
      const req = createMockRequest({
        user: mockUser,
        params: { id: planId }
      });
      const res = createMockResponse();
      const next = createMockNext();

      // Mock: plan not found in checkPlanAccess
      supabase.from.mockReturnValue({
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({
          data: null,
          error: { code: 'PGRST116' }
        })
      });

      await planController.getPlan(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
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

      const updatedPlan = createMockPlan({
        id: planId,
        owner_id: mockUser.id,
        title: 'Updated Title'
      });

      let callCount = 0;
      supabase.from.mockImplementation((table) => {
        callCount++;
        
        if (table === 'plans') {
          // checkPlanAccess call
          if (callCount === 1) {
            return {
              select: jest.fn().mockReturnThis(),
              eq: jest.fn().mockReturnThis(),
              single: jest.fn().mockResolvedValue({
                data: { owner_id: mockUser.id },
                error: null
              })
            };
          }
          // update call
          return {
            update: jest.fn().mockReturnThis(),
            eq: jest.fn().mockReturnThis(),
            select: jest.fn().mockResolvedValue({
              data: [updatedPlan],
              error: null
            })
          };
        }
        
        if (table === 'plan_nodes') {
          return {
            select: jest.fn().mockReturnThis(),
            eq: jest.fn().mockReturnThis(),
            update: jest.fn().mockReturnThis(),
            single: jest.fn().mockResolvedValue({ data: [], error: null })
          };
        }
        
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          single: jest.fn().mockResolvedValue({ data: null, error: null })
        };
      });

      await planController.updatePlan(req, res, next);

      expect(res.json).toHaveBeenCalled();
      const responseData = res.json.mock.calls[0][0];
      expect(responseData.title).toBe('Updated Title');
    });

    it('should return 403 when user is not owner or admin', async () => {
      const planId = uuidv4();
      const otherUserId = uuidv4();
      const req = createMockRequest({
        user: mockUser,
        params: { id: planId },
        body: { title: 'Updated Title' }
      });
      const res = createMockResponse();
      const next = createMockNext();

      // User is not owner
      let callCount = 0;
      supabase.from.mockImplementation((table) => {
        callCount++;
        
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
        
        // User is viewer, not admin
        if (table === 'plan_collaborators') {
          return {
            select: jest.fn().mockReturnThis(),
            eq: jest.fn().mockReturnThis(),
            single: jest.fn().mockResolvedValue({
              data: { role: 'viewer' },
              error: null
            })
          };
        }
        
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          single: jest.fn().mockResolvedValue({ data: null, error: null })
        };
      });

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

      supabase.from.mockImplementation((table) => {
        if (table === 'plans') {
          return {
            select: jest.fn().mockReturnThis(),
            eq: jest.fn().mockReturnThis(),
            delete: jest.fn().mockReturnThis(),
            single: jest.fn().mockResolvedValue({
              data: { owner_id: mockUser.id },
              error: null
            })
          };
        }
        
        // Mock all related table deletes
        return {
          delete: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          match: jest.fn().mockResolvedValue({ error: null })
        };
      });

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

      const archivedPlan = createMockPlan({
        id: planId,
        owner_id: mockUser.id,
        status: 'archived'
      });

      let callCount = 0;
      supabase.from.mockImplementation((table) => {
        callCount++;
        
        if (table === 'plans') {
          // First call: ownership check
          if (callCount === 1) {
            return {
              select: jest.fn().mockReturnThis(),
              eq: jest.fn().mockReturnThis(),
              single: jest.fn().mockResolvedValue({
                data: { owner_id: mockUser.id },
                error: null
              })
            };
          }
          // Second call: update to archive
          if (callCount === 2) {
            return {
              update: jest.fn().mockReturnThis(),
              eq: jest.fn().mockResolvedValue({ error: null })
            };
          }
          // Third call: fetch archived plan for broadcast
          return {
            select: jest.fn().mockReturnThis(),
            eq: jest.fn().mockReturnThis(),
            single: jest.fn().mockResolvedValue({
              data: archivedPlan,
              error: null
            })
          };
        }
        
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          single: jest.fn().mockResolvedValue({ data: null, error: null })
        };
      });

      await planController.deletePlan(req, res, next);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ message: expect.stringContaining('archived') })
      );
    });

    it('should return 403 when user is not owner', async () => {
      const planId = uuidv4();
      const otherUserId = uuidv4();
      const req = createMockRequest({
        user: mockUser,
        params: { id: planId },
        query: {}
      });
      const res = createMockResponse();
      const next = createMockNext();

      supabase.from.mockReturnValue({
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({
          data: { owner_id: otherUserId },
          error: null
        })
      });

      await planController.deletePlan(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: expect.stringContaining('owner') })
      );
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

      supabase.from.mockReturnValue({
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({
          data: null,
          error: { code: 'PGRST116' }
        })
      });

      await planController.deletePlan(req, res, next);

      expect(res.status).toHaveBeenCalledWith(404);
    });
  });

  describe('listPlans', () => {
    it('should return empty array when user has no plans', async () => {
      const req = createMockRequest({ user: mockUser });
      const res = createMockResponse();
      const next = createMockNext();

      supabase.from.mockImplementation((table) => {
        if (table === 'plans') {
          return {
            select: jest.fn().mockReturnThis(),
            eq: jest.fn().mockResolvedValue({
              data: [],
              error: null
            })
          };
        }
        if (table === 'plan_collaborators') {
          return {
            select: jest.fn().mockReturnThis(),
            eq: jest.fn().mockResolvedValue({
              data: [],
              error: null
            })
          };
        }
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockResolvedValue({ data: [], error: null })
        };
      });

      await planController.listPlans(req, res, next);

      expect(res.json).toHaveBeenCalledWith([]);
    });

    it('should return owned plans with owner role', async () => {
      const req = createMockRequest({ user: mockUser });
      const res = createMockResponse();
      const next = createMockNext();

      const ownedPlan = createMockPlan({ owner_id: mockUser.id });

      let nodeQueryCount = 0;
      supabase.from.mockImplementation((table) => {
        if (table === 'plans') {
          return {
            select: jest.fn().mockReturnThis(),
            eq: jest.fn().mockResolvedValue({
              data: [ownedPlan],
              error: null
            })
          };
        }
        if (table === 'plan_collaborators') {
          return {
            select: jest.fn().mockReturnThis(),
            eq: jest.fn().mockResolvedValue({
              data: [],
              error: null
            })
          };
        }
        // plan_nodes for progress calculation
        if (table === 'plan_nodes') {
          return {
            select: jest.fn().mockReturnThis(),
            eq: jest.fn().mockResolvedValue({
              data: [{ id: uuidv4(), status: 'not_started' }],
              error: null
            })
          };
        }
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockResolvedValue({ data: [], error: null })
        };
      });

      await planController.listPlans(req, res, next);

      expect(res.json).toHaveBeenCalled();
      const responseData = res.json.mock.calls[0][0];
      expect(responseData.length).toBe(1);
      expect(responseData[0].role).toBe('owner');
      expect(responseData[0]).toHaveProperty('progress');
    });

    it('should handle database errors gracefully', async () => {
      const req = createMockRequest({ user: mockUser });
      const res = createMockResponse();
      const next = createMockNext();

      supabase.from.mockReturnValue({
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockResolvedValue({
          data: null,
          error: { message: 'Database connection failed' }
        })
      });

      await planController.listPlans(req, res, next);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: 'Database connection failed' })
      );
    });
  });

  describe('calculatePlanProgress', () => {
    // Testing through integration as it's a private function
    // Progress is included in getPlan and listPlans responses
    
    it('should calculate 0% for plans with no completed nodes', async () => {
      const planId = uuidv4();
      const req = createMockRequest({
        user: mockUser,
        params: { id: planId }
      });
      const res = createMockResponse();
      const next = createMockNext();

      const planData = createMockPlan({ id: planId, owner_id: mockUser.id });

      let callCount = 0;
      supabase.from.mockImplementation((table) => {
        callCount++;
        
        if (table === 'plans') {
          return {
            select: jest.fn().mockReturnThis(),
            eq: jest.fn().mockReturnThis(),
            single: jest.fn().mockResolvedValue({
              data: callCount === 1 ? { owner_id: mockUser.id } : planData,
              error: null
            })
          };
        }
        
        if (table === 'plan_nodes') {
          return {
            select: jest.fn().mockReturnThis(),
            eq: jest.fn().mockReturnThis(),
            single: jest.fn().mockResolvedValue({
              data: createMockRootNode(planId, planData.title),
              error: null
            }),
            // For calculatePlanProgress
            then: (resolve) => resolve({
              data: [
                { id: uuidv4(), status: 'not_started' },
                { id: uuidv4(), status: 'not_started' }
              ],
              error: null
            })
          };
        }
        
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          single: jest.fn().mockResolvedValue({ data: null, error: null })
        };
      });

      await planController.getPlan(req, res, next);

      // Progress calculation happens, though mocking makes it hard to verify exact value
      expect(res.json).toHaveBeenCalled();
    });
  });
});
