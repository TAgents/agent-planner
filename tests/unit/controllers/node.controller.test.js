/**
 * Unit Tests for Node Controller
 * Tests CRUD operations for plan nodes
 */

const { v4: uuidv4 } = require('uuid');
const {
  createMockRequest,
  createMockResponse,
  createMockNext,
  createMockUser,
  createMockPlan,
  createMockNode,
  createMockRootNode,
  createMockPhaseNode,
  createMockTaskNode
} = require('../../fixtures/testData');

// Mock dependencies before requiring the controller
jest.mock('../../../src/config/supabase');
jest.mock('../../../src/websocket/broadcast', () => ({
  broadcastPlanUpdate: jest.fn().mockResolvedValue(true)
}));

const { supabaseAdmin: supabase } = require('../../../src/config/supabase');
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

  /**
   * Helper to setup supabase mock for plan access granted
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

  describe('getNodes', () => {
    it('should return hierarchical tree structure for authorized user', async () => {
      const planId = mockPlan.id;
      const req = createMockRequest({
        user: mockUser,
        params: { id: planId },
        query: {}
      });
      const res = createMockResponse();
      const next = createMockNext();

      const phase = createMockPhaseNode(planId, mockRootNode.id, { order_index: 0 });
      const task1 = createMockTaskNode(planId, phase.id, { order_index: 0 });

      let callCount = 0;
      supabase.from.mockImplementation((table) => {
        callCount++;
        
        // First two calls are for checkPlanAccess
        if (callCount <= 2 && table === 'plans') {
          return setupPlanAccessMock();
        }
        
        if (table === 'plan_nodes') {
          return {
            select: jest.fn().mockReturnThis(),
            eq: jest.fn().mockReturnThis(),
            order: jest.fn().mockResolvedValue({
              data: [
                { ...mockRootNode, parent_id: null },
                { ...phase, parent_id: mockRootNode.id },
                { ...task1, parent_id: phase.id }
              ],
              error: null
            })
          };
        }
        
        // plan_collaborators check
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          single: jest.fn().mockResolvedValue({
            data: null,
            error: { code: 'PGRST116' }
          })
        };
      });

      await nodeController.getNodes(req, res, next);

      expect(res.json).toHaveBeenCalled();
      const tree = res.json.mock.calls[0][0];
      expect(Array.isArray(tree)).toBe(true);
    });

    it('should return 403 when user has no access', async () => {
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

      await nodeController.getNodes(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
    });
  });

  describe('getNode', () => {
    it('should return a specific node for authorized user', async () => {
      const planId = mockPlan.id;
      const nodeId = uuidv4();
      const req = createMockRequest({
        user: mockUser,
        params: { id: planId, nodeId }
      });
      const res = createMockResponse();
      const next = createMockNext();

      const taskNode = createMockTaskNode(planId, mockRootNode.id, { id: nodeId });

      let callCount = 0;
      supabase.from.mockImplementation((table) => {
        callCount++;
        
        if (callCount <= 2 && table === 'plans') {
          return setupPlanAccessMock();
        }
        
        if (table === 'plan_nodes') {
          return {
            select: jest.fn().mockReturnThis(),
            eq: jest.fn().mockReturnThis(),
            single: jest.fn().mockResolvedValue({
              data: taskNode,
              error: null
            })
          };
        }
        
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          single: jest.fn().mockResolvedValue({
            data: null,
            error: { code: 'PGRST116' }
          })
        };
      });

      await nodeController.getNode(req, res, next);

      expect(res.json).toHaveBeenCalled();
      const responseData = res.json.mock.calls[0][0];
      expect(responseData.id).toBe(nodeId);
    });

    it('should return 404 when node not found', async () => {
      const planId = mockPlan.id;
      const nodeId = uuidv4();
      const req = createMockRequest({
        user: mockUser,
        params: { id: planId, nodeId }
      });
      const res = createMockResponse();
      const next = createMockNext();

      let callCount = 0;
      supabase.from.mockImplementation((table) => {
        callCount++;
        
        if (callCount <= 2 && table === 'plans') {
          return setupPlanAccessMock();
        }
        
        if (table === 'plan_nodes') {
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
          single: jest.fn().mockResolvedValue({
            data: null,
            error: { code: 'PGRST116' }
          })
        };
      });

      await nodeController.getNode(req, res, next);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({ error: 'Node not found' });
    });

    it('should return 403 when user has no access to plan', async () => {
      const planId = mockPlan.id;
      const nodeId = uuidv4();
      const otherUserId = uuidv4();
      const req = createMockRequest({
        user: mockUser,
        params: { id: planId, nodeId }
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

      await nodeController.getNode(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
    });
  });

  describe('createNode', () => {
    it('should return 400 when title is missing', async () => {
      const planId = mockPlan.id;
      const req = createMockRequest({
        user: mockUser,
        params: { id: planId },
        body: {
          parent_id: mockRootNode.id,
          node_type: 'task'
          // title is missing
        }
      });
      const res = createMockResponse();
      const next = createMockNext();

      let callCount = 0;
      supabase.from.mockImplementation((table) => {
        callCount++;
        if (callCount <= 2 && table === 'plans') {
          return setupPlanAccessMock();
        }
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          single: jest.fn().mockResolvedValue({
            data: null,
            error: { code: 'PGRST116' }
          })
        };
      });

      await nodeController.createNode(req, res, next);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: expect.stringContaining('title') })
      );
    });

    it('should return 400 when node_type is missing', async () => {
      const planId = mockPlan.id;
      const req = createMockRequest({
        user: mockUser,
        params: { id: planId },
        body: {
          parent_id: mockRootNode.id,
          title: 'Test Task'
          // node_type is missing
        }
      });
      const res = createMockResponse();
      const next = createMockNext();

      let callCount = 0;
      supabase.from.mockImplementation((table) => {
        callCount++;
        if (callCount <= 2 && table === 'plans') {
          return setupPlanAccessMock();
        }
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          single: jest.fn().mockResolvedValue({
            data: null,
            error: { code: 'PGRST116' }
          })
        };
      });

      await nodeController.createNode(req, res, next);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: expect.stringContaining('type') })
      );
    });

    it('should return 400 when trying to create root node', async () => {
      const planId = mockPlan.id;
      const req = createMockRequest({
        user: mockUser,
        params: { id: planId },
        body: {
          parent_id: mockRootNode.id,
          node_type: 'root',
          title: 'Another Root'
        }
      });
      const res = createMockResponse();
      const next = createMockNext();

      let callCount = 0;
      supabase.from.mockImplementation((table) => {
        callCount++;
        if (callCount <= 2 && table === 'plans') {
          return setupPlanAccessMock();
        }
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          single: jest.fn().mockResolvedValue({
            data: null,
            error: { code: 'PGRST116' }
          })
        };
      });

      await nodeController.createNode(req, res, next);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: expect.stringContaining('root') })
      );
    });

    it('should return 403 when user has no edit access', async () => {
      const planId = mockPlan.id;
      const otherUserId = uuidv4();
      const req = createMockRequest({
        user: mockUser,
        params: { id: planId },
        body: {
          parent_id: mockRootNode.id,
          node_type: 'task',
          title: 'Test Task'
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
              data: { role: 'viewer' },  // Viewer can't create
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

      await nodeController.createNode(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
    });
  });

  describe('updateNode', () => {
    it('should return 403 when user has no edit access', async () => {
      const planId = mockPlan.id;
      const nodeId = uuidv4();
      const otherUserId = uuidv4();
      const req = createMockRequest({
        user: mockUser,
        params: { id: planId, nodeId },
        body: { title: 'Updated Title' }
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

      await nodeController.updateNode(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
    });

    it('should return 404 when node not found', async () => {
      const planId = mockPlan.id;
      const nodeId = uuidv4();
      const req = createMockRequest({
        user: mockUser,
        params: { id: planId, nodeId },
        body: { title: 'Updated Title' }
      });
      const res = createMockResponse();
      const next = createMockNext();

      let callCount = 0;
      supabase.from.mockImplementation((table) => {
        callCount++;
        
        if (callCount <= 2 && table === 'plans') {
          return setupPlanAccessMock();
        }
        
        if (table === 'plan_nodes') {
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
          single: jest.fn().mockResolvedValue({
            data: null,
            error: { code: 'PGRST116' }
          })
        };
      });

      await nodeController.updateNode(req, res, next);

      expect(res.status).toHaveBeenCalledWith(404);
    });

    it('should return 400 when trying to change root node type', async () => {
      const planId = mockPlan.id;
      const req = createMockRequest({
        user: mockUser,
        params: { id: planId, nodeId: mockRootNode.id },
        body: { node_type: 'task' }  // Trying to change root to task
      });
      const res = createMockResponse();
      const next = createMockNext();

      let callCount = 0;
      supabase.from.mockImplementation((table) => {
        callCount++;
        
        if (callCount <= 2 && table === 'plans') {
          return setupPlanAccessMock();
        }
        
        if (table === 'plan_nodes') {
          return {
            select: jest.fn().mockReturnThis(),
            eq: jest.fn().mockReturnThis(),
            single: jest.fn().mockResolvedValue({
              data: { node_type: 'root' },  // Node is root type
              error: null
            })
          };
        }
        
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          single: jest.fn().mockResolvedValue({
            data: null,
            error: { code: 'PGRST116' }
          })
        };
      });

      await nodeController.updateNode(req, res, next);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: expect.stringContaining('root') })
      );
    });
  });

  describe('checkPlanAccess helper (via getNodes)', () => {
    it('should grant access to plan owner', async () => {
      const planId = mockPlan.id;
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
              data: { owner_id: mockUser.id },
              error: null
            })
          };
        }
        if (table === 'plan_nodes') {
          return {
            select: jest.fn().mockReturnThis(),
            eq: jest.fn().mockReturnThis(),
            order: jest.fn().mockResolvedValue({
              data: [mockRootNode],
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

      await nodeController.getNodes(req, res, next);

      expect(res.status).not.toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalled();
    });

    it('should grant access to collaborator with proper role', async () => {
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
        if (table === 'plan_nodes') {
          return {
            select: jest.fn().mockReturnThis(),
            eq: jest.fn().mockReturnThis(),
            order: jest.fn().mockResolvedValue({
              data: [mockRootNode],
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

      await nodeController.getNodes(req, res, next);

      expect(res.status).not.toHaveBeenCalledWith(403);
    });

    it('should deny access when user is neither owner nor collaborator', async () => {
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

      await nodeController.getNodes(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
    });
  });

  describe('addLogEntry', () => {
    const setupAddLogMocks = (nodeId, planId, ownerId = mockUser.id) => {
      supabase.from.mockImplementation((table) => {
        // Plan access check
        if (table === 'plans') {
          return {
            select: jest.fn().mockReturnThis(),
            eq: jest.fn().mockReturnThis(),
            single: jest.fn().mockResolvedValue({
              data: { owner_id: ownerId },
              error: null
            })
          };
        }
        
        // Collaborators check
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
        
        // Node exists check
        if (table === 'plan_nodes') {
          return {
            select: jest.fn().mockReturnThis(),
            eq: jest.fn().mockReturnValue({
              eq: jest.fn().mockReturnThis(),
              single: jest.fn().mockResolvedValue({
                data: { id: nodeId },
                error: null
              })
            })
          };
        }
        
        // Insert log entry
        if (table === 'plan_node_logs') {
          return {
            insert: jest.fn().mockReturnThis(),
            select: jest.fn().mockResolvedValue({
              data: [{
                id: uuidv4(),
                plan_node_id: nodeId,
                user_id: mockUser.id,
                content: 'Test log content',
                log_type: 'progress',
                metadata: {},
                created_at: new Date().toISOString()
              }],
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
    };

    it('should create log entry with actor_type agent', async () => {
      const nodeId = uuidv4();
      const planId = mockPlan.id;
      
      const req = createMockRequest({
        user: mockUser,
        params: { id: planId, nodeId },
        body: {
          content: 'Agent performed task',
          log_type: 'progress',
          actor_type: 'agent'
        }
      });
      const res = createMockResponse();
      const next = createMockNext();

      setupAddLogMocks(nodeId, planId);

      await nodeController.addLogEntry(req, res, next);

      expect(res.status).toHaveBeenCalledWith(201);
      expect(res.json).toHaveBeenCalled();
    });

    it('should create log entry with actor_type human', async () => {
      const nodeId = uuidv4();
      const planId = mockPlan.id;
      
      const req = createMockRequest({
        user: mockUser,
        params: { id: planId, nodeId },
        body: {
          content: 'Human added note',
          log_type: 'decision',
          actor_type: 'human'
        }
      });
      const res = createMockResponse();
      const next = createMockNext();

      setupAddLogMocks(nodeId, planId);

      await nodeController.addLogEntry(req, res, next);

      expect(res.status).toHaveBeenCalledWith(201);
    });

    it('should create log entry without actor_type (defaults on read)', async () => {
      const nodeId = uuidv4();
      const planId = mockPlan.id;
      
      const req = createMockRequest({
        user: mockUser,
        params: { id: planId, nodeId },
        body: {
          content: 'Log without explicit actor',
          log_type: 'progress'
        }
      });
      const res = createMockResponse();
      const next = createMockNext();

      setupAddLogMocks(nodeId, planId);

      await nodeController.addLogEntry(req, res, next);

      expect(res.status).toHaveBeenCalledWith(201);
    });

    // Note: Invalid actor_type values are rejected by Zod validation middleware
    // before reaching the controller, so we don't test that here
  });

  describe('getNodeLogs', () => {
    const setupGetLogsMocks = (nodeId, planId, mockLogs, ownerId = mockUser.id) => {
      supabase.from.mockImplementation((table) => {
        // Plan access check
        if (table === 'plans') {
          return {
            select: jest.fn().mockReturnThis(),
            eq: jest.fn().mockReturnThis(),
            single: jest.fn().mockResolvedValue({
              data: { owner_id: ownerId },
              error: null
            })
          };
        }
        
        // Collaborators check
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
        
        // Get logs
        if (table === 'plan_node_logs') {
          return {
            select: jest.fn().mockReturnThis(),
            eq: jest.fn().mockReturnValue({
              eq: jest.fn().mockReturnThis(),
              order: jest.fn().mockResolvedValue({
                data: mockLogs,
                error: null
              })
            })
          };
        }
        
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          single: jest.fn().mockResolvedValue({ data: null, error: null })
        };
      });
    };

    it('should return logs with actor_type field', async () => {
      const nodeId = uuidv4();
      const planId = mockPlan.id;
      
      const mockLogs = [
        {
          id: uuidv4(),
          plan_node_id: nodeId,
          user_id: mockUser.id,
          content: 'Agent log',
          log_type: 'progress',
          tags: [],
          metadata: { actor_type: 'agent' },
          created_at: new Date().toISOString()
        },
        {
          id: uuidv4(),
          plan_node_id: nodeId,
          user_id: mockUser.id,
          content: 'Human log',
          log_type: 'decision',
          tags: [],
          metadata: { actor_type: 'human' },
          created_at: new Date().toISOString()
        }
      ];

      setupGetLogsMocks(nodeId, planId, mockLogs);

      const req = createMockRequest({
        user: mockUser,
        params: { id: planId, nodeId },
        query: {}
      });
      const res = createMockResponse();
      const next = createMockNext();

      await nodeController.getNodeLogs(req, res, next);

      expect(res.json).toHaveBeenCalled();
      const responseData = res.json.mock.calls[0][0];
      
      // Verify actor_type is extracted from metadata
      expect(responseData[0].actor_type).toBe('agent');
      expect(responseData[1].actor_type).toBe('human');
      
      // Verify metadata field is NOT exposed in response
      expect(responseData[0].metadata).toBeUndefined();
      expect(responseData[1].metadata).toBeUndefined();
    });

    it('should default actor_type to human for legacy logs without metadata', async () => {
      const nodeId = uuidv4();
      const planId = mockPlan.id;
      
      const mockLogs = [
        {
          id: uuidv4(),
          plan_node_id: nodeId,
          user_id: mockUser.id,
          content: 'Legacy log without actor_type',
          log_type: 'progress',
          tags: [],
          metadata: {}, // No actor_type
          created_at: new Date().toISOString()
        },
        {
          id: uuidv4(),
          plan_node_id: nodeId,
          user_id: mockUser.id,
          content: 'Legacy log with null metadata',
          log_type: 'progress',
          tags: [],
          metadata: null,
          created_at: new Date().toISOString()
        }
      ];

      setupGetLogsMocks(nodeId, planId, mockLogs);

      const req = createMockRequest({
        user: mockUser,
        params: { id: planId, nodeId },
        query: {}
      });
      const res = createMockResponse();
      const next = createMockNext();

      await nodeController.getNodeLogs(req, res, next);

      expect(res.json).toHaveBeenCalled();
      const responseData = res.json.mock.calls[0][0];
      
      // Both should default to 'human'
      expect(responseData[0].actor_type).toBe('human');
      expect(responseData[1].actor_type).toBe('human');
    });
  });
});
