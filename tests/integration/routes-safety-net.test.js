/**
 * Routes Safety Net — Integration tests for route mounting, auth, and controller wiring.
 *
 * These tests verify that every major route group:
 *   1. Is mounted at the correct path (not 404)
 *   2. Is protected by auth middleware where expected (401 without token)
 *   3. Reaches the right controller and returns expected data shapes
 *
 * IMPORTANT: Runs WITHOUT a database. All DAL calls are mocked.
 * Run with: npx jest tests/integration/routes-safety-net.test.js
 */

const express = require('express');
const request = require('supertest');
const { v4: uuidv4 } = require('uuid');

// ─── Test user ──────────────────────────────────────────────────────
const TEST_USER_ID = uuidv4();
const TEST_USER = {
  id: TEST_USER_ID,
  email: 'safety-net@test.com',
  name: 'Safety Net User',
  organizationId: uuidv4(),
  organizations: [],
};

// ─── Mock logger (suppress output) ─────────────────────────────────
jest.mock('../../src/utils/logger', () => ({
  api: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  info: jest.fn(),
  debug: jest.fn(),
  auth: jest.fn(),
}));

// ─── Mock auth middleware ───────────────────────────────────────────
// Routes import from auth.middleware (which re-exports auth.middleware.v2)
// AND from middleware/auth.middleware.v2 directly (via config/auth).
// We mock both paths.
const mockAuthenticate = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  req.user = { ...TEST_USER };
  next();
};

const mockOptionalAuthenticate = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    req.user = { ...TEST_USER };
  }
  next();
};

const mockRequireAdmin = (req, res, next) => {
  if (!req.user) return res.status(401).json({ error: 'Authentication required' });
  next();
};

jest.mock('../../src/middleware/auth.middleware', () => ({
  authenticate: mockAuthenticate,
  optionalAuthenticate: mockOptionalAuthenticate,
  requireAdmin: mockRequireAdmin,
}));

jest.mock('../../src/middleware/auth.middleware.v2', () => ({
  authenticate: mockAuthenticate,
  optionalAuthenticate: mockOptionalAuthenticate,
  requireAdmin: mockRequireAdmin,
}));

// ─── Mock WebSocket broadcast (no-op) ──────────────────────────────
jest.mock('../../src/websocket/broadcast', () => ({
  broadcastPlanUpdate: jest.fn(),
  broadcastToAll: jest.fn(),
  setCollaborationServer: jest.fn(),
}));

jest.mock('../../src/websocket/message-schema', () => ({
  createPlanCreatedMessage: jest.fn(() => ({})),
  createPlanUpdatedMessage: jest.fn(() => ({})),
  createPlanDeletedMessage: jest.fn(() => ({})),
  createNodeCreatedMessage: jest.fn(() => ({})),
  createNodeUpdatedMessage: jest.fn(() => ({})),
  createNodeDeletedMessage: jest.fn(() => ({})),
  createNodeMovedMessage: jest.fn(() => ({})),
  createNodeStatusChangedMessage: jest.fn(() => ({})),
  createLogAddedMessage: jest.fn(() => ({})),
}));

// ─── Mock messageBus ────────────────────────────────────────────────
jest.mock('../../src/services/messageBus', () => ({
  init: jest.fn(),
  subscribe: jest.fn(),
  publish: jest.fn(),
}));

// ─── Mock notifications ─────────────────────────────────────────────
jest.mock('../../src/services/notifications.v2', () => ({
  notifyStatusChange: jest.fn(),
  notifyAgentRequested: jest.fn(),
}));
// v1 notifications.js deleted — v2 is the only path now (already mocked above)

// ─── Mock Graphiti bridge ───────────────────────────────────────────
jest.mock('../../src/services/graphitiBridge', () => ({
  init: jest.fn().mockResolvedValue(false),
  addEpisode: jest.fn(),
  search: jest.fn().mockResolvedValue([]),
  getEntities: jest.fn().mockResolvedValue([]),
  getRecentEpisodes: jest.fn().mockResolvedValue([]),
  checkContradictions: jest.fn().mockResolvedValue([]),
  deleteEpisode: jest.fn(),
  isReady: jest.fn().mockReturnValue(false),
  isAvailable: jest.fn().mockReturnValue(false),
  getGroupId: jest.fn().mockReturnValue('org_test'),
}));

// ─── Mock reasoning service ─────────────────────────────────────────
jest.mock('../../src/services/reasoning', () => ({
  detectBottlenecks: jest.fn().mockResolvedValue([]),
  getRpiChains: jest.fn().mockResolvedValue([]),
  getSchedule: jest.fn().mockResolvedValue([]),
  getDecompositionAlerts: jest.fn().mockResolvedValue([]),
  propagateStatus: jest.fn(),
  initStatusPropagation: jest.fn(),
}));

// ─── Mock email service ─────────────────────────────────────────────
jest.mock('../../src/services/email', () => ({
  sendInviteEmail: jest.fn(),
  sendPasswordResetEmail: jest.fn(),
  sendVerificationEmail: jest.fn(),
}));

// ─── Mock rate limiting (pass-through) ──────────────────────────────
jest.mock('../../src/middleware/rateLimit.middleware', () => ({
  generalLimiter: (req, res, next) => next(),
  authLimiter: (req, res, next) => next(),
  searchLimiter: (req, res, next) => next(),
  tokenLimiter: (req, res, next) => next(),
}));

// ─── Mock validation middleware (pass-through) ──────────────────────
jest.mock('../../src/validation', () => ({
  validate: () => [(req, res, next) => next()],
  validateBody: () => (req, res, next) => next(),
  validateParams: () => (req, res, next) => next(),
  validateQuery: () => (req, res, next) => next(),
  formatZodError: jest.fn(),
  schemas: {
    plan: {
      createPlan: {},
      updatePlan: {},
      planIdParam: {},
      addCollaborator: {},
      updateVisibility: {},
    },
    node: {
      createNode: {},
      updateNode: {},
    },
    common: {},
    decision: {},
  },
}));

// ─── Mock DAL ───────────────────────────────────────────────────────
const PLAN_ID = uuidv4();
const NODE_ID = uuidv4();
const GOAL_ID = uuidv4();
const ORG_ID = TEST_USER.organizationId;

const mockPlan = {
  id: PLAN_ID,
  title: 'Test Plan',
  description: 'A plan for testing',
  ownerId: TEST_USER_ID,
  organizationId: ORG_ID,
  status: 'active',
  visibility: 'private',
  isPublic: false,
  viewCount: 0,
  githubRepoOwner: null,
  githubRepoName: null,
  githubRepoUrl: null,
  githubRepoFullName: null,
  metadata: {},
  qualityScore: null,
  qualityAssessedAt: null,
  qualityRationale: null,
  coherenceCheckedAt: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  lastViewedAt: null,
};

const mockNode = {
  id: NODE_ID,
  planId: PLAN_ID,
  parentId: null,
  nodeType: 'task',
  title: 'Test Node',
  description: 'A test node',
  status: 'not_started',
  orderIndex: 0,
  dueDate: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  context: '',
  agentInstructions: '',
  metadata: {},
  agentRequested: null,
  agentRequestedAt: null,
  agentRequestedBy: null,
  agentRequestMessage: null,
  assignedAgentId: null,
  assignedAgentAt: null,
  assignedAgentBy: null,
  taskMode: 'free',
  coherenceStatus: null,
  qualityScore: null,
  qualityAssessedAt: null,
  qualityRationale: null,
};

const mockRootNode = { ...mockNode, nodeType: 'root', title: 'Test Plan' };

const mockGoal = {
  id: GOAL_ID,
  title: 'Test Goal',
  description: 'A test goal',
  type: 'outcome',
  status: 'active',
  ownerId: TEST_USER_ID,
  organizationId: ORG_ID,
  targetDate: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const mockOrg = {
  id: ORG_ID,
  name: 'Test Org',
  slug: 'test-org',
  description: '',
  isPersonal: false,
  createdAt: new Date().toISOString(),
};

jest.mock('../../src/db/dal.cjs', () => {
  const dalProxy = {
    plansDal: {
      listForUser: jest.fn().mockResolvedValue({ owned: [], shared: [], organization: [] }),
      findById: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue(null),
      update: jest.fn().mockResolvedValue(null),
      delete: jest.fn().mockResolvedValue(null),
      userHasAccess: jest.fn().mockResolvedValue({ hasAccess: true, role: 'owner' }),
      countByIds: jest.fn().mockResolvedValue(0),
      listByOwner: jest.fn().mockResolvedValue([]),
    },
    nodesDal: {
      listByPlan: jest.fn().mockResolvedValue([]),
      listByPlanIds: jest.fn().mockResolvedValue([]),
      findById: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue(null),
      update: jest.fn().mockResolvedValue(null),
      delete: jest.fn().mockResolvedValue(null),
      search: jest.fn().mockResolvedValue([]),
      countByPlan: jest.fn().mockResolvedValue(0),
      getRoot: jest.fn().mockResolvedValue(null),
      getChildren: jest.fn().mockResolvedValue([]),
    },
    goalsDal: {
      findAll: jest.fn().mockResolvedValue([]),
      findById: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue(null),
      update: jest.fn().mockResolvedValue(null),
      softDelete: jest.fn().mockResolvedValue(null),
      getTree: jest.fn().mockResolvedValue([]),
      addLink: jest.fn().mockResolvedValue(null),
      removeLink: jest.fn().mockResolvedValue(null),
      addEvaluation: jest.fn().mockResolvedValue(null),
      getEvaluations: jest.fn().mockResolvedValue([]),
      getDashboardData: jest.fn().mockResolvedValue([]),
      getActiveGoalsForOwner: jest.fn().mockResolvedValue([]),
      listGoalTethersForPlanIds: jest.fn().mockResolvedValue([]),
    },
    dependenciesDal: {
      listByPlan: jest.fn().mockResolvedValue([]),
      listByNode: jest.fn().mockResolvedValue({ upstream: [], downstream: [] }),
      create: jest.fn().mockResolvedValue(null),
      delete: jest.fn().mockResolvedValue(null),
      findById: jest.fn().mockResolvedValue(null),
      getUpstream: jest.fn().mockResolvedValue([]),
      getDownstream: jest.fn().mockResolvedValue([]),
      getImpact: jest.fn().mockResolvedValue({ direct: [], transitive: [] }),
      getCriticalPath: jest.fn().mockResolvedValue({ path: [], totalWeight: 0 }),
      wouldCreateCycle: jest.fn().mockResolvedValue({ hasCycle: false, cyclePath: [] }),
      listByGoal: jest.fn().mockResolvedValue([]),
      getGoalPath: jest.fn().mockResolvedValue({ nodes: [], stats: { completion_percentage: 0 } }),
    },
    collaboratorsDal: {
      listByPlan: jest.fn().mockResolvedValue([]),
      findByPlanAndUser: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue(null),
      delete: jest.fn().mockResolvedValue(null),
      listPlanIdsForUser: jest.fn().mockResolvedValue([]),
    },
    tokensDal: {
      findByHash: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue(null),
      listByUser: jest.fn().mockResolvedValue([]),
      delete: jest.fn().mockResolvedValue(null),
      updateLastUsed: jest.fn().mockResolvedValue(null),
    },
    usersDal: {
      findById: jest.fn().mockResolvedValue(null),
      findByEmail: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue(null),
      update: jest.fn().mockResolvedValue(null),
    },
    organizationsDal: {
      listForUser: jest.fn().mockResolvedValue([]),
      findById: jest.fn().mockResolvedValue(null),
      findBySlug: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue(null),
      update: jest.fn().mockResolvedValue(null),
      delete: jest.fn().mockResolvedValue(null),
      addMember: jest.fn().mockResolvedValue(null),
      getMembership: jest.fn().mockResolvedValue(null),
      listMembers: jest.fn().mockResolvedValue([]),
      getMemberCount: jest.fn().mockResolvedValue(0),
      getPlanCount: jest.fn().mockResolvedValue(0),
      listPlans: jest.fn().mockResolvedValue([]),
    },
    logsDal: {
      listByNode: jest.fn().mockResolvedValue([]),
      listByPlan: jest.fn().mockResolvedValue({ logs: [], total: 0 }),
      create: jest.fn().mockResolvedValue(null),
      latestLogTimestampsByPlanIds: jest.fn().mockResolvedValue([]),
    },
    commentsDal: {
      listByNode: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockResolvedValue(null),
    },
    decisionsDal: {
      listByPlan: jest.fn().mockResolvedValue([]),
      countPending: jest.fn().mockResolvedValue(0),
      findById: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue(null),
    },
    searchDal: {
      searchPlan: jest.fn().mockResolvedValue([]),
    },
    claimsDal: {
      findActive: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue(null),
      release: jest.fn().mockResolvedValue(null),
    },
  };
  return dalProxy;
});

// ─── Get references to mocked DAL after jest.mock ───────────────────
const dal = require('../../src/db/dal.cjs');

// ─── Build test app ─────────────────────────────────────────────────
function createApp() {
  const app = express();
  app.use(express.json());
  app.use(express.text({ type: ['text/markdown', 'text/plain'] }));
  app.use(express.urlencoded({ extended: true }));

  // Mount routes the same way index.js does
  const authRoutes = require('../../src/routes/auth.routes');
  const planRoutes = require('../../src/routes/plan.routes');
  const nodeRoutes = require('../../src/routes/node.routes');
  const activityRoutes = require('../../src/routes/activity.routes');
  const searchRoutes = require('../../src/routes/search.routes');
  const organizationRoutes = require('../../src/routes/organization.routes');
  const goalsV2Routes = require('../../src/routes/v2/goals.routes');
  const dependencyRoutes = require('../../src/routes/dependency.routes');
  const dashboardRoutes = require('../../src/routes/dashboard.routes');

  app.use('/auth', authRoutes);
  app.use('/search', searchRoutes);
  app.use('/plans', planRoutes);
  app.use('/plans', nodeRoutes);
  app.use('/activity', activityRoutes);
  app.use('/organizations', organizationRoutes);
  app.use('/goals', goalsV2Routes);
  app.use('/plans', dependencyRoutes);
  app.use('/dashboard', dashboardRoutes);

  // Error handler
  app.use((err, req, res, next) => {
    const status = err.statusCode || 500;
    res.status(status).json({ error: err.message || 'Internal Server Error' });
  });

  return app;
}

// ─── Tests ──────────────────────────────────────────────────────────
describe('Routes Safety Net', () => {
  let app;
  const AUTH = 'Bearer test-jwt-token';

  beforeAll(() => {
    app = createApp();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    // Reset common DAL responses
    dal.plansDal.userHasAccess.mockResolvedValue({ hasAccess: true, role: 'owner' });
  });

  // ════════════════════════════════════════════════════════════════════
  // PLANS
  // ════════════════════════════════════════════════════════════════════
  describe('Plans — /plans', () => {
    it('GET /plans — returns 401 without auth', async () => {
      const res = await request(app).get('/plans');
      expect(res.status).toBe(401);
    });

    it('GET /plans — returns plan list', async () => {
      dal.plansDal.listForUser.mockResolvedValue({
        owned: [mockPlan],
        shared: [],
        organization: [],
      });
      const res = await request(app).get('/plans').set('Authorization', AUTH);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body[0]).toHaveProperty('id', PLAN_ID);
      expect(res.body[0]).toHaveProperty('title');
      expect(res.body[0]).toHaveProperty('owner_id');
    });

    it('POST /plans — returns 401 without auth', async () => {
      const res = await request(app).post('/plans').send({ title: 'New Plan' });
      expect(res.status).toBe(401);
    });

    it('POST /plans — creates a plan', async () => {
      dal.plansDal.create.mockResolvedValue(mockPlan);
      dal.nodesDal.create.mockResolvedValue(mockRootNode);
      const res = await request(app)
        .post('/plans')
        .set('Authorization', AUTH)
        .send({ title: 'New Plan', description: 'desc' });
      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty('id');
      expect(res.body).toHaveProperty('title');
    });

    it('POST /plans — returns 400 without title', async () => {
      const res = await request(app)
        .post('/plans')
        .set('Authorization', AUTH)
        .send({ description: 'no title' });
      expect(res.status).toBe(400);
    });

    it('GET /plans/:id — returns 401 without auth', async () => {
      const res = await request(app).get(`/plans/${PLAN_ID}`);
      expect(res.status).toBe(401);
    });

    it('GET /plans/:id — returns plan detail', async () => {
      dal.plansDal.findById.mockResolvedValue(mockPlan);
      dal.nodesDal.listByPlan.mockResolvedValue([mockRootNode]);
      const res = await request(app)
        .get(`/plans/${PLAN_ID}`)
        .set('Authorization', AUTH);
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('id', PLAN_ID);
    });

    it('GET /plans/:id — returns 403 when access denied', async () => {
      dal.plansDal.userHasAccess.mockResolvedValue({ hasAccess: false, role: null });
      const res = await request(app)
        .get(`/plans/${PLAN_ID}`)
        .set('Authorization', AUTH);
      expect(res.status).toBe(403);
    });

    it('PUT /plans/:id — returns 401 without auth', async () => {
      const res = await request(app)
        .put(`/plans/${PLAN_ID}`)
        .send({ title: 'Updated' });
      expect(res.status).toBe(401);
    });

    it('PUT /plans/:id — updates a plan', async () => {
      const updated = { ...mockPlan, title: 'Updated Title' };
      dal.plansDal.userHasAccess.mockResolvedValue({ hasAccess: true, role: 'owner' });
      dal.plansDal.findById.mockResolvedValue(mockPlan);
      dal.plansDal.update.mockResolvedValue(updated);
      const res = await request(app)
        .put(`/plans/${PLAN_ID}`)
        .set('Authorization', AUTH)
        .send({ title: 'Updated Title' });
      expect(res.status).toBe(200);
    });

    it('DELETE /plans/:id — returns 401 without auth', async () => {
      const res = await request(app).delete(`/plans/${PLAN_ID}`);
      expect(res.status).toBe(401);
    });

    it('DELETE /plans/:id — deletes a plan', async () => {
      dal.plansDal.userHasAccess.mockResolvedValue({ hasAccess: true, role: 'owner' });
      dal.plansDal.findById.mockResolvedValue(mockPlan);
      dal.plansDal.delete.mockResolvedValue(true);
      const res = await request(app)
        .delete(`/plans/${PLAN_ID}`)
        .set('Authorization', AUTH);
      // Expect 204 (hard delete) or 200 (archive) — not 404
      expect([200, 204]).toContain(res.status);
    });
  });

  // ════════════════════════════════════════════════════════════════════
  // NODES
  // ════════════════════════════════════════════════════════════════════
  describe('Nodes — /plans/:id/nodes', () => {
    it('GET /plans/:id/nodes — returns 401 without auth', async () => {
      const res = await request(app).get(`/plans/${PLAN_ID}/nodes`);
      expect(res.status).toBe(401);
    });

    it('GET /plans/:id/nodes — returns node tree', async () => {
      dal.nodesDal.listByPlan.mockResolvedValue([mockRootNode, mockNode]);
      const res = await request(app)
        .get(`/plans/${PLAN_ID}/nodes`)
        .set('Authorization', AUTH);
      expect(res.status).toBe(200);
      // Response is either array or object with structure
      expect(res.body).toBeDefined();
    });

    it('POST /plans/:id/nodes — returns 401 without auth', async () => {
      const res = await request(app)
        .post(`/plans/${PLAN_ID}/nodes`)
        .send({ title: 'New Task', node_type: 'task', parent_id: NODE_ID });
      expect(res.status).toBe(401);
    });

    it('POST /plans/:id/nodes — creates a node', async () => {
      dal.nodesDal.findById.mockResolvedValue({ ...mockRootNode, planId: PLAN_ID });
      dal.nodesDal.create.mockResolvedValue(mockNode);
      dal.nodesDal.listByPlan.mockResolvedValue([mockRootNode]);
      const res = await request(app)
        .post(`/plans/${PLAN_ID}/nodes`)
        .set('Authorization', AUTH)
        .send({ title: 'New Task', node_type: 'task', parent_id: mockRootNode.id });
      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty('id');
    });

    it('PUT /plans/:id/nodes/:nodeId — returns 401 without auth', async () => {
      const res = await request(app)
        .put(`/plans/${PLAN_ID}/nodes/${NODE_ID}`)
        .send({ title: 'Updated' });
      expect(res.status).toBe(401);
    });

    it('PUT /plans/:id/nodes/:nodeId — updates a node', async () => {
      const updated = { ...mockNode, title: 'Updated Node' };
      dal.nodesDal.findById.mockResolvedValue(mockNode);
      dal.nodesDal.update.mockResolvedValue(updated);
      const res = await request(app)
        .put(`/plans/${PLAN_ID}/nodes/${NODE_ID}`)
        .set('Authorization', AUTH)
        .send({ title: 'Updated Node' });
      expect(res.status).toBe(200);
    });
  });

  // ════════════════════════════════════════════════════════════════════
  // DEPENDENCIES
  // ════════════════════════════════════════════════════════════════════
  describe('Dependencies — /plans/:id/dependencies', () => {
    it('GET /plans/:id/dependencies — returns 401 without auth', async () => {
      const res = await request(app).get(`/plans/${PLAN_ID}/dependencies`);
      expect(res.status).toBe(401);
    });

    it('GET /plans/:id/dependencies — returns dependency list', async () => {
      dal.dependenciesDal.listByPlan.mockResolvedValue([]);
      const res = await request(app)
        .get(`/plans/${PLAN_ID}/dependencies`)
        .set('Authorization', AUTH);
      expect(res.status).toBe(200);
    });

    it('POST /plans/:id/dependencies — returns 401 without auth', async () => {
      const res = await request(app)
        .post(`/plans/${PLAN_ID}/dependencies`)
        .send({ source_node_id: uuidv4(), target_node_id: uuidv4() });
      expect(res.status).toBe(401);
    });

    it('POST /plans/:id/dependencies — returns 400 without required fields', async () => {
      dal.plansDal.userHasAccess.mockResolvedValue({ hasAccess: true, role: 'owner' });
      const res = await request(app)
        .post(`/plans/${PLAN_ID}/dependencies`)
        .set('Authorization', AUTH)
        .send({});
      expect(res.status).toBe(400);
    });

    it('POST /plans/:id/dependencies — creates a dependency', async () => {
      const sourceId = uuidv4();
      const targetId = uuidv4();
      const mockDep = {
        id: uuidv4(),
        sourceNodeId: sourceId,
        targetNodeId: targetId,
        targetGoalId: null,
        dependencyType: 'blocks',
        weight: 1,
        metadata: {},
        createdBy: TEST_USER_ID,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      dal.plansDal.userHasAccess.mockResolvedValue({ hasAccess: true, role: 'owner' });
      dal.nodesDal.findById
        .mockResolvedValueOnce({ ...mockNode, id: sourceId, planId: PLAN_ID })
        .mockResolvedValueOnce({ ...mockNode, id: targetId, planId: PLAN_ID });
      dal.dependenciesDal.create.mockResolvedValue(mockDep);
      const res = await request(app)
        .post(`/plans/${PLAN_ID}/dependencies`)
        .set('Authorization', AUTH)
        .send({ source_node_id: sourceId, target_node_id: targetId });
      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty('source_node_id');
    });
  });

  // ════════════════════════════════════════════════════════════════════
  // GOALS
  // ════════════════════════════════════════════════════════════════════
  describe('Goals — /goals', () => {
    it('GET /goals — returns 401 without auth', async () => {
      const res = await request(app).get('/goals');
      expect(res.status).toBe(401);
    });

    it('GET /goals — returns goals list', async () => {
      dal.goalsDal.findAll.mockResolvedValue([mockGoal]);
      const res = await request(app)
        .get('/goals')
        .set('Authorization', AUTH);
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('goals');
    });

    it('POST /goals — returns 401 without auth', async () => {
      const res = await request(app)
        .post('/goals')
        .send({ title: 'New Goal' });
      expect(res.status).toBe(401);
    });

    it('POST /goals — creates a goal', async () => {
      dal.goalsDal.create.mockResolvedValue(mockGoal);
      const res = await request(app)
        .post('/goals')
        .set('Authorization', AUTH)
        .send({ title: 'New Goal', type: 'outcome' });
      expect(res.status).toBe(201);
    });

    it('POST /goals — returns 400 without title', async () => {
      const res = await request(app)
        .post('/goals')
        .set('Authorization', AUTH)
        .send({ type: 'outcome' });
      expect(res.status).toBe(400);
    });

    it('GET /goals/:id — returns 401 without auth', async () => {
      const res = await request(app).get(`/goals/${GOAL_ID}`);
      expect(res.status).toBe(401);
    });

    it('GET /goals/:id — returns goal detail', async () => {
      dal.goalsDal.findById.mockResolvedValue({
        ...mockGoal,
        ownerId: TEST_USER_ID,
        organizationId: null,
        links: [],
        evaluations: [],
      });
      const res = await request(app)
        .get(`/goals/${GOAL_ID}`)
        .set('Authorization', AUTH);
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('id', GOAL_ID);
    });

    it('GET /goals/:id — returns 404 when not found', async () => {
      dal.goalsDal.findById.mockResolvedValue(null);
      const res = await request(app)
        .get(`/goals/${uuidv4()}`)
        .set('Authorization', AUTH);
      expect(res.status).toBe(404);
    });
  });

  // ════════════════════════════════════════════════════════════════════
  // SEARCH
  // ════════════════════════════════════════════════════════════════════
  describe('Search — /search', () => {
    it('GET /search — returns 401 without auth', async () => {
      const res = await request(app).get('/search?query=test');
      expect(res.status).toBe(401);
    });

    it('GET /search — returns 400 for short query', async () => {
      const res = await request(app)
        .get('/search?query=ab')
        .set('Authorization', AUTH);
      expect(res.status).toBe(400);
    });

    it('GET /search — returns search results', async () => {
      dal.plansDal.listByOwner.mockResolvedValue([mockPlan]);
      dal.collaboratorsDal.listPlanIdsForUser.mockResolvedValue([]);
      dal.searchDal.searchPlan.mockResolvedValue([]);
      const res = await request(app)
        .get('/search?query=testing')
        .set('Authorization', AUTH);
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('query');
      expect(res.body).toHaveProperty('results');
    });
  });

  // ════════════════════════════════════════════════════════════════════
  // ACTIVITY
  // ════════════════════════════════════════════════════════════════════
  describe('Activity — /activity', () => {
    it('GET /activity/feed — returns 401 without auth', async () => {
      const res = await request(app).get('/activity/feed');
      expect(res.status).toBe(401);
    });

    it('GET /activity/feed — returns activity feed', async () => {
      dal.plansDal.listForUser.mockResolvedValue({ owned: [], shared: [], organization: [] });
      dal.collaboratorsDal.listPlanIdsForUser.mockResolvedValue([]);
      const res = await request(app)
        .get('/activity/feed')
        .set('Authorization', AUTH);
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('activities');
      expect(res.body).toHaveProperty('pagination');
    });
  });

  // ════════════════════════════════════════════════════════════════════
  // DASHBOARD
  // ════════════════════════════════════════════════════════════════════
  describe('Dashboard — /dashboard', () => {
    it('GET /dashboard/summary — returns 401 without auth', async () => {
      const res = await request(app).get('/dashboard/summary');
      expect(res.status).toBe(401);
    });

    it('GET /dashboard/summary — returns summary stats', async () => {
      dal.plansDal.listForUser.mockResolvedValue({ owned: [], shared: [], organization: [] });
      const res = await request(app)
        .get('/dashboard/summary')
        .set('Authorization', AUTH);
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('active_plans_count');
      expect(res.body).toHaveProperty('pending_decisions_count');
      expect(res.body).toHaveProperty('tasks_completed_this_week');
    });
  });

  // ════════════════════════════════════════════════════════════════════
  // AUTH
  // ════════════════════════════════════════════════════════════════════
  describe('Auth — /auth', () => {
    it('POST /auth/login — route is mounted (not 404)', async () => {
      // Login will try to find user in DB — mock it to return null (invalid credentials)
      dal.usersDal.findByEmail.mockResolvedValue(null);
      const res = await request(app)
        .post('/auth/login')
        .send({ email: 'test@test.com', password: 'password123' });
      // Should be 401 (invalid credentials) not 404 (route not found)
      expect(res.status).not.toBe(404);
      expect([400, 401]).toContain(res.status);
    });

    it('POST /auth/register — route is mounted (not 404)', async () => {
      const res = await request(app)
        .post('/auth/register')
        .send({});
      // Should be 400 (missing fields) not 404
      expect(res.status).not.toBe(404);
    });

    it('GET /auth/profile — returns 401 without auth', async () => {
      const res = await request(app).get('/auth/profile');
      expect(res.status).toBe(401);
    });

    it('GET /auth/profile — returns user profile with auth', async () => {
      dal.usersDal.findById.mockResolvedValue({
        id: TEST_USER_ID,
        email: 'safety-net@test.com',
        name: 'Safety Net User',
        organization: 'Test',
        avatarUrl: null,
        emailVerified: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      const res = await request(app)
        .get('/auth/profile')
        .set('Authorization', AUTH);
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('id');
      expect(res.body).toHaveProperty('email');
    });
  });

  // ════════════════════════════════════════════════════════════════════
  // ORGANIZATIONS
  // ════════════════════════════════════════════════════════════════════
  describe('Organizations — /organizations', () => {
    it('GET /organizations — returns 401 without auth', async () => {
      const res = await request(app).get('/organizations');
      expect(res.status).toBe(401);
    });

    it('GET /organizations — returns org list', async () => {
      dal.organizationsDal.listForUser.mockResolvedValue([mockOrg]);
      const res = await request(app)
        .get('/organizations')
        .set('Authorization', AUTH);
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('organizations');
      expect(res.body.organizations).toHaveLength(1);
    });

    it('POST /organizations — returns 401 without auth', async () => {
      const res = await request(app)
        .post('/organizations')
        .send({ name: 'New Org' });
      expect(res.status).toBe(401);
    });

    it('POST /organizations — creates an organization', async () => {
      dal.organizationsDal.findBySlug.mockResolvedValue(null);
      dal.organizationsDal.create.mockResolvedValue(mockOrg);
      dal.organizationsDal.addMember.mockResolvedValue({ id: uuidv4(), role: 'owner' });
      const res = await request(app)
        .post('/organizations')
        .set('Authorization', AUTH)
        .send({ name: 'New Org' });
      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty('name');
    });

    it('POST /organizations — returns 400 without name', async () => {
      const res = await request(app)
        .post('/organizations')
        .set('Authorization', AUTH)
        .send({});
      expect(res.status).toBe(400);
    });

    it('GET /organizations/:id — returns 401 without auth', async () => {
      const res = await request(app).get(`/organizations/${ORG_ID}`);
      expect(res.status).toBe(401);
    });

    it('GET /organizations/:id — returns 403 for non-member', async () => {
      dal.organizationsDal.getMembership.mockResolvedValue(null);
      const res = await request(app)
        .get(`/organizations/${ORG_ID}`)
        .set('Authorization', AUTH);
      expect(res.status).toBe(403);
    });

    it('GET /organizations/:id — returns org detail for member', async () => {
      dal.organizationsDal.getMembership.mockResolvedValue({ role: 'owner' });
      dal.organizationsDal.findById.mockResolvedValue(mockOrg);
      dal.organizationsDal.getMemberCount.mockResolvedValue(3);
      dal.organizationsDal.getPlanCount.mockResolvedValue(5);
      const res = await request(app)
        .get(`/organizations/${ORG_ID}`)
        .set('Authorization', AUTH);
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('name', 'Test Org');
      expect(res.body).toHaveProperty('memberCount', 3);
      expect(res.body).toHaveProperty('planCount', 5);
    });
  });

  // ════════════════════════════════════════════════════════════════════
  // ROUTE EXISTENCE — verify routes are mounted (not 404)
  // ════════════════════════════════════════════════════════════════════
  describe('Route existence checks', () => {
    // These routes should never return 404 meaning "route not found".
    // Some may return 404 for "resource not found" — we distinguish by
    // checking the response body. Express returns "Cannot GET/POST ..." for unmounted routes.
    const routes = [
      { method: 'get', path: '/plans' },
      { method: 'post', path: '/plans' },
      { method: 'get', path: `/plans/${PLAN_ID}` },
      { method: 'put', path: `/plans/${PLAN_ID}` },
      { method: 'delete', path: `/plans/${PLAN_ID}` },
      { method: 'get', path: `/plans/${PLAN_ID}/nodes` },
      { method: 'post', path: `/plans/${PLAN_ID}/nodes` },
      { method: 'get', path: `/plans/${PLAN_ID}/dependencies` },
      { method: 'post', path: `/plans/${PLAN_ID}/dependencies` },
      { method: 'get', path: '/goals' },
      { method: 'post', path: '/goals' },
      { method: 'get', path: `/goals/${GOAL_ID}` },
      { method: 'get', path: '/search' },
      { method: 'get', path: '/activity/feed' },
      { method: 'get', path: '/dashboard/summary' },
      { method: 'post', path: '/auth/login' },
      { method: 'get', path: '/auth/profile' },
      { method: 'get', path: '/organizations' },
      { method: 'post', path: '/organizations' },
    ];

    routes.forEach(({ method, path }) => {
      it(`${method.toUpperCase()} ${path} is mounted (not unmatched)`, async () => {
        const res = await request(app)[method](path)
          .set('Authorization', AUTH)
          .send(method === 'post' || method === 'put' ? {} : undefined);
        // Express returns HTML with "Cannot GET/POST ..." for unmatched routes.
        // A 404 with JSON body like { error: "... not found" } is fine — the route is mounted.
        if (res.status === 404) {
          const isExpressDefault = typeof res.text === 'string' && res.text.includes('Cannot');
          expect(isExpressDefault).toBe(false);
        }
      });
    });
  });
});
