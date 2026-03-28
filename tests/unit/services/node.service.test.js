/**
 * Unit tests for node.service.js
 *
 * All repository calls are mocked — tests verify business logic only.
 */

// Mock repository
jest.mock('../../../src/domains/node/repositories/node.repository', () => ({
  findById: jest.fn(),
  listByPlan: jest.fn(),
  getRoot: jest.fn(),
  getChildren: jest.fn(),
  create: jest.fn(),
  update: jest.fn(),
  updateStatus: jest.fn(),
  deleteWithChildren: jest.fn(),
  move: jest.fn(),
  reorder: jest.fn(),
  setAgentRequest: jest.fn(),
  clearAgentRequest: jest.fn(),
  assignAgent: jest.fn(),
  createLog: jest.fn(),
  listLogsByNode: jest.fn(),
  findPlanById: jest.fn(),
  createDependency: jest.fn(),
  findUserById: jest.fn(),
  listUsers: jest.fn(),
}));

// Mock planAccess middleware
jest.mock('../../../src/middleware/planAccess.middleware', () => ({
  checkPlanAccess: jest.fn(),
}));

// Mock broadcast
jest.mock('../../../src/websocket/broadcast', () => ({
  broadcastPlanUpdate: jest.fn(),
}));

// Mock message-schema
jest.mock('../../../src/websocket/message-schema', () => ({
  createNodeCreatedMessage: jest.fn(() => ({ type: 'node_created' })),
  createNodeUpdatedMessage: jest.fn(() => ({ type: 'node_updated' })),
  createNodeDeletedMessage: jest.fn(() => ({ type: 'node_deleted' })),
  createNodeMovedMessage: jest.fn(() => ({ type: 'node_moved' })),
  createNodeStatusChangedMessage: jest.fn(() => ({ type: 'node_status_changed' })),
  createLogAddedMessage: jest.fn(() => ({ type: 'log_added' })),
}));

// Mock notifications
jest.mock('../../../src/services/notifications.v2', () => ({
  notifyStatusChange: jest.fn().mockResolvedValue(undefined),
  notifyAgentRequested: jest.fn().mockResolvedValue(undefined),
}));

// Mock messageBus
jest.mock('../../../src/services/messageBus', () => ({
  publish: jest.fn().mockResolvedValue(undefined),
}));

const repo = require('../../../src/domains/node/repositories/node.repository');
const { checkPlanAccess } = require('../../../src/middleware/planAccess.middleware');
const nodeService = require('../../../src/domains/node/services/node.service');

const PLAN_ID = 'plan-1';
const NODE_ID = 'node-1';
const USER_ID = 'user-1';
const USER_NAME = 'Test User';

const makeNode = (overrides = {}) => ({
  id: NODE_ID,
  planId: PLAN_ID,
  parentId: 'root-1',
  nodeType: 'task',
  title: 'Test Task',
  description: 'A test task',
  status: 'not_started',
  orderIndex: 0,
  dueDate: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  context: '',
  agentInstructions: null,
  metadata: {},
  agentRequested: false,
  agentRequestedAt: null,
  agentRequestedBy: null,
  agentRequestMessage: null,
  assignedAgentId: null,
  assignedAgentAt: null,
  assignedAgentBy: null,
  taskMode: 'free',
  coherenceStatus: 'unchecked',
  qualityScore: null,
  qualityAssessedAt: null,
  qualityRationale: null,
  ...overrides,
});

beforeEach(() => {
  jest.clearAllMocks();
  checkPlanAccess.mockResolvedValue(true);
});

describe('Node Service', () => {
  // ── getNode ────────────────────────────────────────────

  describe('getNode', () => {
    it('should return a snake_case node', async () => {
      repo.findById.mockResolvedValue(makeNode());

      const result = await nodeService.getNode(PLAN_ID, NODE_ID, USER_ID);

      expect(result.id).toBe(NODE_ID);
      expect(result.plan_id).toBe(PLAN_ID);
      expect(result.node_type).toBe('task');
      expect(result.task_mode).toBe('free');
    });

    it('should throw 404 if node not found', async () => {
      repo.findById.mockResolvedValue(null);

      await expect(nodeService.getNode(PLAN_ID, NODE_ID, USER_ID))
        .rejects.toThrow('Node not found in this plan');
    });

    it('should throw 404 if node belongs to different plan', async () => {
      repo.findById.mockResolvedValue(makeNode({ planId: 'other-plan' }));

      await expect(nodeService.getNode(PLAN_ID, NODE_ID, USER_ID))
        .rejects.toThrow('Node not found in this plan');
    });

    it('should throw 403 if user lacks access', async () => {
      checkPlanAccess.mockResolvedValue(false);

      await expect(nodeService.getNode(PLAN_ID, NODE_ID, USER_ID))
        .rejects.toThrow('You do not have access to this plan');
    });
  });

  // ── createNode ─────────────────────────────────────────

  describe('createNode', () => {
    it('should create a node and return it', async () => {
      const created = makeNode({ title: 'New Task' });
      repo.getRoot.mockResolvedValue({ id: 'root-1', planId: PLAN_ID });
      repo.getChildren.mockResolvedValue([]);
      repo.create.mockResolvedValue(created);
      repo.createLog.mockResolvedValue({});

      const { result, created: isNew } = await nodeService.createNode(PLAN_ID, USER_ID, USER_NAME, {
        nodeType: 'task',
        title: 'New Task',
      });

      expect(isNew).toBe(true);
      expect(result.title).toBe('New Task');
      expect(repo.create).toHaveBeenCalledWith(expect.objectContaining({
        planId: PLAN_ID,
        nodeType: 'task',
        title: 'New Task',
        taskMode: 'free',
      }));
    });

    it('should reject missing nodeType', async () => {
      await expect(nodeService.createNode(PLAN_ID, USER_ID, USER_NAME, { title: 'X' }))
        .rejects.toThrow('Node type is required');
    });

    it('should reject missing title', async () => {
      await expect(nodeService.createNode(PLAN_ID, USER_ID, USER_NAME, { nodeType: 'task' }))
        .rejects.toThrow('Node title is required');
    });

    it('should reject root node creation', async () => {
      await expect(nodeService.createNode(PLAN_ID, USER_ID, USER_NAME, { nodeType: 'root', title: 'X' }))
        .rejects.toThrow('Cannot create additional root nodes');
    });

    it('should reject invalid task_mode', async () => {
      await expect(nodeService.createNode(PLAN_ID, USER_ID, USER_NAME, {
        nodeType: 'task', title: 'X', taskMode: 'invalid',
      })).rejects.toThrow('Invalid task_mode');
    });

    it('should auto-assign to root if no parent specified', async () => {
      repo.getRoot.mockResolvedValue({ id: 'root-1', planId: PLAN_ID });
      repo.getChildren.mockResolvedValue([]);
      repo.create.mockResolvedValue(makeNode());
      repo.createLog.mockResolvedValue({});

      await nodeService.createNode(PLAN_ID, USER_ID, USER_NAME, {
        nodeType: 'task', title: 'X',
      });

      expect(repo.create).toHaveBeenCalledWith(expect.objectContaining({
        parentId: 'root-1',
      }));
    });

    it('should return existing node on unique constraint violation', async () => {
      const existing = makeNode({ title: 'Dup' });
      repo.getRoot.mockResolvedValue({ id: 'root-1', planId: PLAN_ID });
      repo.getChildren.mockResolvedValueOnce([]).mockResolvedValueOnce([existing]);
      const dbError = new Error('duplicate');
      dbError.code = '23505';
      dbError.constraint = 'plan_nodes_unique_title_per_parent';
      repo.create.mockRejectedValue(dbError);

      const { result, created: isNew } = await nodeService.createNode(PLAN_ID, USER_ID, USER_NAME, {
        nodeType: 'task', title: 'Dup',
      });

      expect(isNew).toBe(false);
      expect(result.title).toBe('Dup');
    });
  });

  // ── updateNode ─────────────────────────────────────────

  describe('updateNode', () => {
    it('should update fields and return result', async () => {
      const existing = makeNode();
      const updated = makeNode({ title: 'Updated' });
      repo.findById.mockResolvedValue(existing);
      repo.update.mockResolvedValue(updated);

      const result = await nodeService.updateNode(PLAN_ID, NODE_ID, USER_ID, USER_NAME, {
        title: 'Updated',
      });

      expect(result.title).toBe('Updated');
      expect(repo.update).toHaveBeenCalledWith(NODE_ID, { title: 'Updated' });
    });

    it('should reject changing root node type', async () => {
      repo.findById.mockResolvedValue(makeNode({ nodeType: 'root' }));

      await expect(nodeService.updateNode(PLAN_ID, NODE_ID, USER_ID, USER_NAME, { nodeType: 'task' }))
        .rejects.toThrow('Cannot change root node type');
    });

    it('should reject invalid quality_score', async () => {
      repo.findById.mockResolvedValue(makeNode());

      await expect(nodeService.updateNode(PLAN_ID, NODE_ID, USER_ID, USER_NAME, { qualityScore: 1.5 }))
        .rejects.toThrow('quality_score must be a number between 0.0 and 1.0');
    });

    it('should publish status change event', async () => {
      const messageBus = require('../../../src/services/messageBus');
      repo.findById.mockResolvedValue(makeNode({ status: 'not_started' }));
      repo.update.mockResolvedValue(makeNode({ status: 'in_progress' }));
      repo.createLog.mockResolvedValue({});
      repo.findPlanById.mockResolvedValue({ id: PLAN_ID, title: 'Plan', ownerId: USER_ID });

      await nodeService.updateNode(PLAN_ID, NODE_ID, USER_ID, USER_NAME, { status: 'in_progress' });

      expect(messageBus.publish).toHaveBeenCalledWith('node.status.changed', expect.objectContaining({
        nodeId: NODE_ID,
        oldStatus: 'not_started',
        newStatus: 'in_progress',
      }));
    });
  });

  // ── deleteNode ─────────────────────────────────────────

  describe('deleteNode', () => {
    it('should delete a node', async () => {
      repo.findById.mockResolvedValue(makeNode());
      repo.deleteWithChildren.mockResolvedValue();

      await nodeService.deleteNode(PLAN_ID, NODE_ID, USER_ID, USER_NAME);

      expect(repo.deleteWithChildren).toHaveBeenCalledWith(NODE_ID);
    });

    it('should reject deleting root node', async () => {
      repo.findById.mockResolvedValue(makeNode({ nodeType: 'root' }));

      await expect(nodeService.deleteNode(PLAN_ID, NODE_ID, USER_ID, USER_NAME))
        .rejects.toThrow('Cannot delete root node');
    });
  });

  // ── updateNodeStatus ───────────────────────────────────

  describe('updateNodeStatus', () => {
    it('should update status', async () => {
      repo.findById.mockResolvedValue(makeNode());
      repo.updateStatus.mockResolvedValue(makeNode({ status: 'completed' }));
      repo.createLog.mockResolvedValue({});

      const result = await nodeService.updateNodeStatus(PLAN_ID, NODE_ID, USER_ID, USER_NAME, 'completed');

      expect(result.status).toBe('completed');
    });

    it('should reject invalid status', async () => {
      await expect(nodeService.updateNodeStatus(PLAN_ID, NODE_ID, USER_ID, USER_NAME, 'invalid'))
        .rejects.toThrow('Invalid status');
    });

    it('should reject empty status', async () => {
      await expect(nodeService.updateNodeStatus(PLAN_ID, NODE_ID, USER_ID, USER_NAME, ''))
        .rejects.toThrow('Status is required');
    });
  });

  // ── moveNode ───────────────────────────────────────────

  describe('moveNode', () => {
    it('should move node to new parent', async () => {
      const node = makeNode({ parentId: 'old-parent' });
      repo.findById
        .mockResolvedValueOnce(node)                            // requireNode
        .mockResolvedValueOnce({ id: 'new-parent', planId: PLAN_ID }) // parent check
        .mockResolvedValueOnce(makeNode({ parentId: 'new-parent' })); // after move
      repo.move.mockResolvedValue();
      repo.createLog.mockResolvedValue({});

      const result = await nodeService.moveNode(PLAN_ID, NODE_ID, USER_ID, USER_NAME, {
        newParentId: 'new-parent',
      });

      expect(repo.move).toHaveBeenCalledWith(NODE_ID, 'new-parent');
      expect(result.parent_id).toBe('new-parent');
    });

    it('should reject moving root node', async () => {
      repo.findById.mockResolvedValue(makeNode({ nodeType: 'root' }));

      await expect(nodeService.moveNode(PLAN_ID, NODE_ID, USER_ID, USER_NAME, { newParentId: 'x' }))
        .rejects.toThrow('Cannot move root nodes');
    });
  });

  // ── createRpiChain ─────────────────────────────────────

  describe('createRpiChain', () => {
    it('should create 3 tasks with 2 dependency edges', async () => {
      repo.getRoot.mockResolvedValue({ id: 'root-1', planId: PLAN_ID });
      repo.getChildren.mockResolvedValue([]);
      repo.create
        .mockResolvedValueOnce(makeNode({ id: 'r1', title: 'Research: Test', taskMode: 'research' }))
        .mockResolvedValueOnce(makeNode({ id: 'p1', title: 'Plan: Test', taskMode: 'plan' }))
        .mockResolvedValueOnce(makeNode({ id: 'i1', title: 'Implement: Test', taskMode: 'implement' }));
      repo.createDependency
        .mockResolvedValueOnce({ id: 'dep1' })
        .mockResolvedValueOnce({ id: 'dep2' });
      repo.createLog.mockResolvedValue({});

      const result = await nodeService.createRpiChain(PLAN_ID, USER_ID, USER_NAME, {
        title: 'Test',
      });

      expect(result.chain.research.title).toBe('Research: Test');
      expect(result.chain.plan.title).toBe('Plan: Test');
      expect(result.chain.implement.title).toBe('Implement: Test');
      expect(result.dependencies).toHaveLength(2);
      expect(repo.create).toHaveBeenCalledTimes(3);
      expect(repo.createDependency).toHaveBeenCalledTimes(2);
    });

    it('should reject missing title', async () => {
      await expect(nodeService.createRpiChain(PLAN_ID, USER_ID, USER_NAME, {}))
        .rejects.toThrow('Title is required');
    });
  });

  // ── requestAgent ───────────────────────────────────────

  describe('requestAgent', () => {
    it('should set agent request on node', async () => {
      repo.findById.mockResolvedValue(makeNode());
      repo.setAgentRequest.mockResolvedValue(makeNode({ agentRequested: true }));
      repo.createLog.mockResolvedValue({});
      repo.findPlanById.mockResolvedValue({ id: PLAN_ID, title: 'Plan', ownerId: USER_ID });

      const result = await nodeService.requestAgent(PLAN_ID, NODE_ID, USER_ID, USER_NAME, {
        requestType: 'start',
        message: 'Please start',
      });

      expect(repo.setAgentRequest).toHaveBeenCalledWith(NODE_ID, {
        type: 'start', message: 'Please start', requestedBy: USER_ID,
      });
      expect(result.agent_requested).toBe(true);
    });

    it('should reject invalid request type', async () => {
      await expect(nodeService.requestAgent(PLAN_ID, NODE_ID, USER_ID, USER_NAME, {
        requestType: 'invalid',
      })).rejects.toThrow('Invalid request_type');
    });

    it.each(['start', 'review', 'help', 'continue'])('should accept request type: %s', async (type) => {
      repo.findById.mockResolvedValue(makeNode());
      repo.setAgentRequest.mockResolvedValue(makeNode());
      repo.createLog.mockResolvedValue({});
      repo.findPlanById.mockResolvedValue(null);

      await expect(nodeService.requestAgent(PLAN_ID, NODE_ID, USER_ID, USER_NAME, {
        requestType: type,
      })).resolves.toBeDefined();
    });
  });

  // ── addLogEntry ────────────────────────────────────────

  describe('addLogEntry', () => {
    it('should create a log entry', async () => {
      repo.findById.mockResolvedValue(makeNode());
      repo.createLog.mockResolvedValue({
        id: 'log-1', content: 'Test log', logType: 'progress',
        createdAt: new Date(), planNodeId: NODE_ID, userId: USER_ID,
        metadata: {}, tags: [],
      });

      const result = await nodeService.addLogEntry(PLAN_ID, NODE_ID, USER_ID, USER_NAME, {
        content: 'Test log',
      });

      expect(result.content).toBe('Test log');
      expect(result.log_type).toBe('progress');
    });

    it('should reject empty content', async () => {
      repo.findById.mockResolvedValue(makeNode());

      await expect(nodeService.addLogEntry(PLAN_ID, NODE_ID, USER_ID, USER_NAME, { content: '' }))
        .rejects.toThrow('Log content is required');
    });

    it('should reject invalid log type', async () => {
      repo.findById.mockResolvedValue(makeNode());

      await expect(nodeService.addLogEntry(PLAN_ID, NODE_ID, USER_ID, USER_NAME, {
        content: 'X', logType: 'invalid',
      })).rejects.toThrow('Invalid log type');
    });
  });

  // ── assignAgent ────────────────────────────────────────

  describe('assignAgent', () => {
    it('should assign agent and return node with agent info', async () => {
      repo.findById.mockResolvedValue(makeNode());
      repo.findUserById.mockResolvedValue({
        id: 'agent-1', name: 'Test Agent', email: 'agent@test.com', capabilityTags: ['qa'],
      });
      repo.assignAgent.mockResolvedValue(makeNode({ assignedAgentId: 'agent-1' }));

      const result = await nodeService.assignAgent(PLAN_ID, NODE_ID, USER_ID, 'agent-1');

      expect(result.assigned_agent_id).toBe('agent-1');
      expect(result.agent.name).toBe('Test Agent');
    });

    it('should reject missing agent_id', async () => {
      await expect(nodeService.assignAgent(PLAN_ID, NODE_ID, USER_ID, ''))
        .rejects.toThrow('agent_id is required');
    });

    it('should reject unknown agent', async () => {
      repo.findById.mockResolvedValue(makeNode());
      repo.findUserById.mockResolvedValue(null);

      await expect(nodeService.assignAgent(PLAN_ID, NODE_ID, USER_ID, 'unknown'))
        .rejects.toThrow('Agent not found');
    });
  });

  // ── getSuggestedAgents ─────────────────────────────────

  describe('getSuggestedAgents', () => {
    it('should return users with capability tags', async () => {
      repo.listUsers.mockResolvedValue([
        { id: '1', name: 'A', email: 'a@t.com', avatarUrl: null, capabilityTags: ['qa'] },
        { id: '2', name: 'B', email: 'b@t.com', avatarUrl: null, capabilityTags: [] },
        { id: '3', name: 'C', email: 'c@t.com', avatarUrl: null, capabilityTags: ['dev'] },
      ]);

      const agents = await nodeService.getSuggestedAgents();

      expect(agents).toHaveLength(2);
      expect(agents[0].capability_tags).toEqual(['qa']);
      expect(agents[1].capability_tags).toEqual(['dev']);
    });
  });
});
