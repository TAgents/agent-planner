/**
 * v1 Router Smoke Tests — verifies the /v1 public surface (Phase 2 of the
 * API consolidation, docs/API_V1_CONSOLIDATION_PLAN.md):
 *
 *   1. Every v1 route group is mounted and auth-protected (401 without token)
 *   2. Forwarding aliases reach the same internal handlers (incl. PATCH→PUT
 *      method mapping and node→plan / decision→plan resolution)
 *   3. The composed facades (goal state, plan analysis, knowledge search,
 *      task update) return their bundled shapes
 *   4. Internal-only routes are NOT exposed under /v1
 *
 * IMPORTANT: Runs WITHOUT a database. All DAL calls are mocked.
 * Run with: npx jest tests/integration/v1-routes.test.js
 */

const express = require('express');
const request = require('supertest');
const { v4: uuidv4 } = require('uuid');

// ─── Test user ──────────────────────────────────────────────────────
const TEST_USER_ID = uuidv4();
const ORG_ID = uuidv4();
const TEST_USER = {
  id: TEST_USER_ID,
  email: 'v1-smoke@test.com',
  name: 'V1 Smoke User',
  organizationId: ORG_ID,
  organizations: [{ id: ORG_ID, role: 'admin' }],
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

// ─── Mock auth middleware (both import paths) ───────────────────────
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

// ─── Mock WebSocket broadcast / message schema ──────────────────────
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

// ─── Mock messageBus / notifications / email ───────────────────────
jest.mock('../../src/services/messageBus', () => ({
  init: jest.fn(),
  subscribe: jest.fn(),
  // node.service chains .catch() on publish — must return a promise
  publish: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../src/services/notifications.v2', () => ({
  notifyStatusChange: jest.fn(),
  notifyAgentRequested: jest.fn(),
}));

jest.mock('../../src/services/email', () => ({
  sendInviteEmail: jest.fn(),
  sendPasswordResetEmail: jest.fn(),
  sendVerificationEmail: jest.fn(),
}));

// ─── Mock Graphiti bridge (unavailable → facades degrade) ──────────
jest.mock('../../src/services/graphitiBridge', () => ({
  init: jest.fn().mockResolvedValue(false),
  isAvailable: jest.fn().mockReturnValue(false),
  isReady: jest.fn().mockReturnValue(false),
  getGroupId: jest.fn().mockReturnValue('org_test'),
  getStatus: jest.fn().mockResolvedValue({ available: false }),
  addEpisode: jest.fn(),
  deleteEpisode: jest.fn(),
  getEpisodes: jest.fn().mockResolvedValue([]),
  searchMemory: jest.fn().mockResolvedValue([]),
  searchEntities: jest.fn().mockResolvedValue([]),
  detectContradictions: jest.fn().mockResolvedValue(null),
  queryForContext: jest.fn().mockResolvedValue([]),
}));

// ─── Mock context engine (used by /context/progressive forwarding) ──
jest.mock('../../src/services/contextEngine', () => ({
  assembleContext: jest.fn().mockResolvedValue({ task: {}, layers: [] }),
  suggestNextTasks: jest.fn().mockResolvedValue([]),
  initContextCacheInvalidation: jest.fn(),
}));

// ─── Mock reasoning service (used by the plan analysis facade) ──────
jest.mock('../../src/services/reasoning', () => ({
  detectBottlenecks: jest.fn().mockResolvedValue([]),
  detectRpiChains: jest.fn().mockResolvedValue([]),
  topologicalSort: jest.fn().mockResolvedValue([]),
  detectDecompositionCandidates: jest.fn().mockResolvedValue([]),
  propagateStatus: jest.fn().mockResolvedValue({ unblocked: [] }),
  initStatusPropagation: jest.fn(),
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
    node: { createNode: {}, updateNode: {} },
    common: {},
    decision: {},
  },
}));

jest.mock('../../src/validation/middleware', () => ({
  validateBody: () => (req, res, next) => next(),
  validateParams: () => (req, res, next) => next(),
  validateQuery: () => (req, res, next) => next(),
}));

// ─── Shared ids / fixtures ──────────────────────────────────────────
const PLAN_ID = uuidv4();
const NODE_ID = uuidv4();
const GOAL_ID = uuidv4();
const DECISION_ID = uuidv4();
const DEP_ID = uuidv4();

const now = new Date().toISOString();

const mockPlan = {
  id: PLAN_ID,
  title: 'Test Plan',
  description: 'A plan for testing',
  ownerId: TEST_USER_ID,
  organizationId: ORG_ID,
  workspaceId: uuidv4(),
  status: 'active',
  visibility: 'private',
  metadata: {},
  createdAt: now,
  updatedAt: now,
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
  taskMode: 'free',
  agentInstructions: '',
  metadata: {},
  coherenceStatus: null,
  createdAt: now,
  updatedAt: now,
};

const mockGoal = {
  id: GOAL_ID,
  title: 'Test Goal',
  description: 'A goal description long enough to score clarity',
  type: 'outcome',
  goalType: 'desire',
  status: 'active',
  priority: 'medium',
  ownerId: TEST_USER_ID,
  organizationId: null, // personal goal — owner-only access path
  successCriteria: [],
  links: [{ id: uuidv4(), linkedType: 'plan', linkedId: PLAN_ID }],
  createdAt: now,
  updatedAt: now,
};

jest.mock('../../src/db/dal.cjs', () => ({
  plansDal: {
    listForUser: jest.fn().mockResolvedValue({ owned: [], shared: [], organization: [] }),
    findById: jest.fn().mockResolvedValue(null),
    // Echo requested ids as active plans so goal_state's non-archived filter keeps them.
    findByIds: jest.fn().mockImplementation((ids) => Promise.resolve((ids || []).map((id) => ({ id, status: 'active' })))),
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
    findByIdAndPlan: jest.fn().mockResolvedValue(null),
    create: jest.fn().mockResolvedValue(null),
    update: jest.fn().mockResolvedValue(null),
    updateStatus: jest.fn().mockResolvedValue(null),
    delete: jest.fn().mockResolvedValue(null),
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
    addEvaluation: jest.fn().mockResolvedValue(null),
    getEvaluations: jest.fn().mockResolvedValue([]),
    getDashboardData: jest.fn().mockResolvedValue([]),
    listGoalTethersForPlanIds: jest.fn().mockResolvedValue([]),
    addLink: jest.fn().mockResolvedValue(null),
  },
  dependenciesDal: {
    findById: jest.fn().mockResolvedValue(null),
    create: jest.fn().mockResolvedValue(null),
    delete: jest.fn().mockResolvedValue(null),
    listByPlan: jest.fn().mockResolvedValue([]),
    listByNode: jest.fn().mockResolvedValue({ upstream: [], downstream: [] }),
    getUpstream: jest.fn().mockResolvedValue([]),
    getDownstream: jest.fn().mockResolvedValue([]),
    getCriticalPath: jest.fn().mockResolvedValue({ path: [], totalWeight: 0 }),
    wouldCreateCycle: jest.fn().mockResolvedValue({ hasCycle: false, cyclePath: [] }),
    getGoalPath: jest.fn().mockResolvedValue({ nodes: [], stats: { completion_percentage: 0 } }),
    listByGoal: jest.fn().mockResolvedValue([]),
  },
  decisionsDal: {
    findById: jest.fn().mockResolvedValue(null),
    create: jest.fn().mockResolvedValue(null),
    update: jest.fn().mockResolvedValue(null),
    listByPlan: jest.fn().mockResolvedValue([]),
    countPending: jest.fn().mockResolvedValue(0),
  },
  claimsDal: {
    claim: jest.fn().mockResolvedValue(null),
    release: jest.fn().mockResolvedValue(null),
    getActiveClaim: jest.fn().mockResolvedValue(null),
    findById: jest.fn().mockResolvedValue(null),
    listActiveClaimsByPlan: jest.fn().mockResolvedValue([]),
    releaseExpiredForNode: jest.fn().mockResolvedValue(null),
  },
  logsDal: {
    listByNode: jest.fn().mockResolvedValue([]),
    listByPlan: jest.fn().mockResolvedValue([]),
    create: jest.fn().mockResolvedValue({ id: 'log-1' }),
    latestLogTimestampsByPlanIds: jest.fn().mockResolvedValue([]),
  },
  commentsDal: {
    listByNode: jest.fn().mockResolvedValue([]),
    create: jest.fn().mockResolvedValue(null),
  },
  collaboratorsDal: {
    listByPlan: jest.fn().mockResolvedValue([]),
    findByPlanAndUser: jest.fn().mockResolvedValue(null),
    create: jest.fn().mockResolvedValue(null),
    delete: jest.fn().mockResolvedValue(null),
    add: jest.fn().mockResolvedValue({ id: 'collab-1' }),
    remove: jest.fn().mockResolvedValue(null),
    listPlanIdsForUser: jest.fn().mockResolvedValue([]),
  },
  usersDal: {
    findById: jest.fn().mockResolvedValue(null),
    findByEmail: jest.fn().mockResolvedValue(null),
    create: jest.fn().mockResolvedValue(null),
    update: jest.fn().mockResolvedValue(null),
  },
  tokensDal: {
    findByHash: jest.fn().mockResolvedValue(null),
    create: jest.fn().mockResolvedValue(null),
    listByUser: jest.fn().mockResolvedValue([]),
    delete: jest.fn().mockResolvedValue(null),
  },
  organizationsDal: {
    listForUser: jest.fn().mockResolvedValue([]),
    findById: jest.fn().mockResolvedValue(null),
    getMembership: jest.fn().mockResolvedValue({ role: 'admin' }),
    listMembers: jest.fn().mockResolvedValue([]),
    addMember: jest.fn().mockResolvedValue(null),
    removeMember: jest.fn().mockResolvedValue(null),
    updateMemberRole: jest.fn().mockResolvedValue(null),
    getMemberCount: jest.fn().mockResolvedValue(0),
    getPlanCount: jest.fn().mockResolvedValue(0),
    create: jest.fn().mockResolvedValue(null),
    update: jest.fn().mockResolvedValue(null),
    delete: jest.fn().mockResolvedValue(null),
  },
  workspacesDal: {
    listForOrganization: jest.fn().mockResolvedValue([]),
    findById: jest.fn().mockResolvedValue(null),
    findDefault: jest.fn().mockResolvedValue(null),
    create: jest.fn().mockResolvedValue(null),
    update: jest.fn().mockResolvedValue(null),
    archive: jest.fn().mockResolvedValue(null),
    unarchive: jest.fn().mockResolvedValue(null),
    delete: jest.fn().mockResolvedValue(null),
    getCounts: jest.fn().mockResolvedValue({ goals: 0, plans: 0 }),
  },
  blueprintsDal: {
    listForUser: jest.fn().mockResolvedValue([]),
    listPublic: jest.fn().mockResolvedValue([]),
    findById: jest.fn().mockResolvedValue(null),
    create: jest.fn().mockResolvedValue(null),
    update: jest.fn().mockResolvedValue(null),
    delete: jest.fn().mockResolvedValue(null),
    forkPlanScope: jest.fn().mockResolvedValue(null),
    savePlanAsBlueprint: jest.fn().mockResolvedValue(null),
    listForks: jest.fn().mockResolvedValue([]),
  },
  episodeLinksDal: {
    listByNode: jest.fn().mockResolvedValue([]),
    listByNodeIds: jest.fn().mockResolvedValue([]),
    listByEpisodeIdsWithTitles: jest.fn().mockResolvedValue([]),
    create: jest.fn().mockResolvedValue(null),
  },
  searchDal: {
    globalSearch: jest.fn().mockResolvedValue([]),
    searchPlan: jest.fn().mockResolvedValue([]),
    searchNodes: jest.fn().mockResolvedValue([]),
  },
  invitesDal: {
    findByToken: jest.fn().mockResolvedValue(null),
    listByPlan: jest.fn().mockResolvedValue([]),
    create: jest.fn().mockResolvedValue(null),
  },
}));

const dal = require('../../src/db/dal.cjs');
const graphitiBridge = require('../../src/services/graphitiBridge');
const contextEngine = require('../../src/services/contextEngine');

// ─── Build test app: just the v1 router, like index.js mounts it ────
function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/v1', require('../../src/routes/v1'));
  app.use((err, req, res, _next) => {
    res.status(err.statusCode || 500).json({ error: err.message || 'Internal Server Error' });
  });
  return app;
}

describe('v1 Routes', () => {
  let app;
  const AUTH = 'Bearer test-jwt-token';

  beforeAll(() => {
    app = createApp();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    dal.plansDal.userHasAccess.mockResolvedValue({ hasAccess: true, role: 'owner' });
    dal.organizationsDal.getMembership.mockResolvedValue({ role: 'admin' });
    dal.logsDal.create.mockResolvedValue({ id: 'log-1' });
    dal.dependenciesDal.getGoalPath.mockResolvedValue({ nodes: [], stats: { completion_percentage: 0 } });
    dal.dependenciesDal.getCriticalPath.mockResolvedValue({ path: [], totalWeight: 0 });
    // jest.clearAllMocks wipes implementations set inside tests but not the
    // factory defaults — re-pin the ones individual tests override.
    graphitiBridge.isAvailable.mockReturnValue(false);
    contextEngine.assembleContext.mockResolvedValue({ task: {}, layers: [] });
  });

  // ══════════════════════════════════════════════════════════════════
  // Mount + auth: every group rejects unauthenticated requests
  // ══════════════════════════════════════════════════════════════════
  describe('auth protection', () => {
    const protectedRoutes = [
      ['get', '/v1/me'],
      ['get', '/v1/me/tokens'],
      ['get', '/v1/orgs'],
      ['get', '/v1/workspaces'],
      ['get', '/v1/goals'],
      ['get', `/v1/goals/${GOAL_ID}/state`],
      ['get', '/v1/plans'],
      ['get', `/v1/plans/${PLAN_ID}/analysis`],
      ['post', `/v1/plans/${PLAN_ID}/share`],
      ['get', '/v1/briefing'],
      ['post', '/v1/tasks/claim-next'],
      ['post', `/v1/tasks/${NODE_ID}/update`],
      ['post', `/v1/tasks/${NODE_ID}/claim`],
      ['get', '/v1/decisions'],
      ['post', '/v1/dependencies'],
      ['get', '/v1/knowledge/episodes'],
      ['post', '/v1/knowledge/search'],
      ['get', '/v1/blueprints'],
      ['get', '/v1/search'],
    ];

    it.each(protectedRoutes)('%s %s — 401 without token', async (method, path) => {
      const res = await request(app)[method](path);
      expect(res.status).toBe(401);
    });

    // The auth blanket lives at the v1 router level, NOT on the internal
    // routes these forward to. Forwarded routes (no own authenticate) must
    // still 401 without a token.
    it('forwarded routes are protected by the v1-layer auth blanket', async () => {
      for (const path of ['/v1/blueprints', '/v1/orgs', '/v1/goals/dashboard']) {
        const res = await request(app).get(path);
        expect(res.status).toBe(401);
      }
    });

    // Public bootstrap routes must remain reachable WITHOUT a token.
    it('register/login/refresh bypass the auth blanket', async () => {
      dal.usersDal.findByEmail.mockResolvedValue(null);
      for (const path of ['/v1/auth/login', '/v1/auth/register', '/v1/auth/refresh']) {
        const res = await request(app).post(path).send({});
        expect(res.status).not.toBe(401);
      }
    });
  });

  // ══════════════════════════════════════════════════════════════════
  // Forwarding aliases
  // ══════════════════════════════════════════════════════════════════
  describe('aliases', () => {
    it('GET /v1/me — forwards to /auth/profile', async () => {
      dal.usersDal.findById.mockResolvedValue({
        id: TEST_USER_ID, email: TEST_USER.email, name: TEST_USER.name,
        avatarUrl: null, createdAt: now, updatedAt: now,
      });
      const res = await request(app).get('/v1/me').set('Authorization', AUTH);
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('id', TEST_USER_ID);
      expect(res.body).toHaveProperty('email', TEST_USER.email);
    });

    it('GET /v1/plans — forwards to plan list', async () => {
      dal.plansDal.listForUser.mockResolvedValue({ owned: [mockPlan], shared: [], organization: [] });
      const res = await request(app).get('/v1/plans').set('Authorization', AUTH);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body[0]).toHaveProperty('id', PLAN_ID);
    });

    it('PATCH /v1/plans/:id — maps to internal PUT handler', async () => {
      dal.plansDal.findById.mockResolvedValue(mockPlan);
      dal.plansDal.update.mockResolvedValue({ ...mockPlan, title: 'Renamed' });
      const res = await request(app)
        .patch(`/v1/plans/${PLAN_ID}`)
        .set('Authorization', AUTH)
        .send({ title: 'Renamed' });
      expect(res.status).toBe(200);
      expect(dal.plansDal.update).toHaveBeenCalled();
    });

    it('GET /v1/goals/:id — forwards with goal access check', async () => {
      dal.goalsDal.findById.mockResolvedValue(mockGoal);
      const res = await request(app).get(`/v1/goals/${GOAL_ID}`).set('Authorization', AUTH);
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('id', GOAL_ID);
    });

    it('PATCH /v1/goals/:id — maps to internal PUT handler', async () => {
      dal.goalsDal.findById.mockResolvedValue(mockGoal);
      dal.goalsDal.update.mockResolvedValue({ ...mockGoal, title: 'Renamed Goal' });
      const res = await request(app)
        .patch(`/v1/goals/${GOAL_ID}`)
        .set('Authorization', AUTH)
        .send({ title: 'Renamed Goal' });
      expect(res.status).toBe(200);
      expect(dal.goalsDal.update).toHaveBeenCalled();
    });

    it('GET /v1/orgs — forwards to organizations list', async () => {
      dal.organizationsDal.listForUser.mockResolvedValue([]);
      const res = await request(app).get('/v1/orgs').set('Authorization', AUTH);
      expect(res.status).toBe(200);
    });

    it('GET /v1/blueprints — forwards to blueprint list', async () => {
      const res = await request(app).get('/v1/blueprints').set('Authorization', AUTH);
      expect(res.status).toBe(200);
    });

    it('GET /v1/briefing — forwards to agent loop briefing', async () => {
      const res = await request(app).get('/v1/briefing').set('Authorization', AUTH);
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('goal_health');
      expect(res.body).toHaveProperty('pending_decisions');
    });

    it('GET /v1/decisions — forwards to dashboard pending bundle', async () => {
      const res = await request(app).get('/v1/decisions').set('Authorization', AUTH);
      expect(res.status).toBe(200);
    });

    it('GET /v1/knowledge/status — forwards to graphiti status', async () => {
      const res = await request(app).get('/v1/knowledge/status').set('Authorization', AUTH);
      expect(res.status).toBe(200);
    });

    it('query strings survive forwarding', async () => {
      dal.plansDal.listForUser.mockResolvedValue({ owned: [], shared: [], organization: [] });
      const res = await request(app)
        .get('/v1/plans?status=active&visibility=private')
        .set('Authorization', AUTH);
      expect(res.status).toBe(200);
      expect(dal.plansDal.listForUser).toHaveBeenCalled();
    });
  });

  // ══════════════════════════════════════════════════════════════════
  // Node→plan / decision→plan resolution
  // ══════════════════════════════════════════════════════════════════
  describe('id resolution', () => {
    it('POST /v1/tasks/:nodeId/claim — resolves plan from node, 404 if node missing', async () => {
      dal.nodesDal.findById.mockResolvedValue(null);
      const res = await request(app)
        .post(`/v1/tasks/${NODE_ID}/claim`)
        .set('Authorization', AUTH)
        .send({});
      expect(res.status).toBe(404);
      expect(res.body).toHaveProperty('code', 'not_found');
    });

    it('POST /v1/decisions/:id/resolve — 404 when decision missing', async () => {
      dal.decisionsDal.findById.mockResolvedValue(null);
      const res = await request(app)
        .post(`/v1/decisions/${DECISION_ID}/resolve`)
        .set('Authorization', AUTH)
        .send({ resolution: 'approved' });
      expect(res.status).toBe(404);
    });

    it('DELETE /v1/dependencies/:id — resolves plan from edge source node', async () => {
      dal.dependenciesDal.findById.mockResolvedValue({
        id: DEP_ID, sourceNodeId: NODE_ID, targetNodeId: uuidv4(), dependencyType: 'blocks',
      });
      dal.nodesDal.findById.mockResolvedValue(mockNode);
      dal.dependenciesDal.delete.mockResolvedValue({ id: DEP_ID });
      const res = await request(app)
        .delete(`/v1/dependencies/${DEP_ID}`)
        .set('Authorization', AUTH);
      expect([200, 204]).toContain(res.status);
      expect(dal.dependenciesDal.delete).toHaveBeenCalled();
    });

    it('DELETE /v1/dependencies/:id — 404 when edge missing', async () => {
      dal.dependenciesDal.findById.mockResolvedValue(null);
      const res = await request(app)
        .delete(`/v1/dependencies/${DEP_ID}`)
        .set('Authorization', AUTH);
      expect(res.status).toBe(404);
    });
  });

  // ══════════════════════════════════════════════════════════════════
  // Facades
  // ══════════════════════════════════════════════════════════════════
  describe('facades', () => {
    it('GET /v1/goals/:id/state — composed goal state', async () => {
      dal.goalsDal.findById.mockResolvedValue(mockGoal);
      const res = await request(app)
        .get(`/v1/goals/${GOAL_ID}/state`)
        .set('Authorization', AUTH);
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('as_of');
      expect(res.body.goal).toHaveProperty('id', GOAL_ID);
      expect(res.body).toHaveProperty('quality');
      expect(res.body.quality).toHaveProperty('score');
      expect(res.body).toHaveProperty('progress');
      expect(res.body).toHaveProperty('bottlenecks');
      expect(res.body).toHaveProperty('knowledge_gaps');
      expect(res.body.linked_plans).toEqual([{ id: PLAN_ID, link_id: mockGoal.links[0].id }]);
      expect(res.body.meta).toHaveProperty('partial', false);
    });

    it('GET /v1/goals/:id/state — 404 for missing goal', async () => {
      dal.goalsDal.findById.mockResolvedValue(null);
      const res = await request(app)
        .get(`/v1/goals/${GOAL_ID}/state`)
        .set('Authorization', AUTH);
      expect(res.status).toBe(404);
    });

    it('GET /v1/plans/:id/analysis — composed plan analysis', async () => {
      const res = await request(app)
        .get(`/v1/plans/${PLAN_ID}/analysis`)
        .set('Authorization', AUTH);
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('as_of');
      expect(res.body).toHaveProperty('plan_id', PLAN_ID);
      expect(res.body).toHaveProperty('critical_path');
      expect(res.body).toHaveProperty('bottlenecks');
      expect(res.body).toHaveProperty('rpi_chains');
      expect(res.body.coherence).toHaveProperty('issues');
      expect(res.body.meta).toHaveProperty('partial', false);
    });

    it('GET /v1/plans/:id/analysis — 403 without plan access', async () => {
      dal.plansDal.userHasAccess.mockResolvedValue({ hasAccess: false, role: null });
      const res = await request(app)
        .get(`/v1/plans/${PLAN_ID}/analysis`)
        .set('Authorization', AUTH);
      expect(res.status).toBe(403);
    });

    it('POST /v1/knowledge/search — degrades when Graphiti unavailable', async () => {
      const res = await request(app)
        .post('/v1/knowledge/search')
        .set('Authorization', AUTH)
        .send({ query: 'anything' });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ available: false, facts: [], entities: [], episodes: [] });
    });

    it('POST /v1/tasks/:nodeId/update — atomic status + log + release', async () => {
      dal.nodesDal.findById.mockResolvedValue(mockNode);
      dal.nodesDal.findByIdAndPlan.mockResolvedValue(mockNode);
      dal.nodesDal.updateStatus.mockResolvedValue({ ...mockNode, status: 'completed' });
      dal.claimsDal.getActiveClaim.mockResolvedValue({ id: uuidv4(), nodeId: NODE_ID, agentId: 'agent-1' });
      dal.claimsDal.release.mockResolvedValue({ id: uuidv4() });

      const res = await request(app)
        .post(`/v1/tasks/${NODE_ID}/update`)
        .set('Authorization', AUTH)
        .send({ status: 'completed', log_message: 'Done.' });

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('task_id', NODE_ID);
      expect(res.body).toHaveProperty('plan_id', PLAN_ID);
      expect(res.body.applied).toMatchObject({
        status_changed: true,
        log_added: true,
        claim_released: true,
      });
      expect(res.body.failures).toEqual([]);
    });

    it('POST /v1/tasks/:nodeId/update — does not release another user\'s claim', async () => {
      dal.nodesDal.findById.mockResolvedValue(mockNode);
      dal.nodesDal.findByIdAndPlan.mockResolvedValue(mockNode);
      dal.nodesDal.updateStatus.mockResolvedValue({ ...mockNode, status: 'completed' });
      dal.claimsDal.getActiveClaim.mockResolvedValue({
        id: uuidv4(), nodeId: NODE_ID, agentId: 'other-agent', createdBy: uuidv4(),
      });

      const res = await request(app)
        .post(`/v1/tasks/${NODE_ID}/update`)
        .set('Authorization', AUTH)
        .send({ status: 'completed' });

      expect(res.status).toBe(200);
      expect(res.body.applied.claim_released).toBe(false);
      expect(dal.claimsDal.release).not.toHaveBeenCalled();
      expect(res.body.failures).toEqual([
        expect.objectContaining({ step: 'release_claim' }),
      ]);
    });

    it('POST /v1/tasks/:nodeId/update — 404 for missing task', async () => {
      dal.nodesDal.findById.mockResolvedValue(null);
      const res = await request(app)
        .post(`/v1/tasks/${NODE_ID}/update`)
        .set('Authorization', AUTH)
        .send({ status: 'completed' });
      expect(res.status).toBe(404);
      expect(res.body).toHaveProperty('code', 'not_found');
    });

    it('POST /v1/plans/:id/share — 400 with nothing to apply', async () => {
      const res = await request(app)
        .post(`/v1/plans/${PLAN_ID}/share`)
        .set('Authorization', AUTH)
        .send({});
      expect(res.status).toBe(400);
    });

    it('POST /v1/plans/:id/share — applies visibility change', async () => {
      dal.plansDal.findById.mockResolvedValue(mockPlan);
      dal.plansDal.update.mockResolvedValue({ ...mockPlan, visibility: 'public' });
      const res = await request(app)
        .post(`/v1/plans/${PLAN_ID}/share`)
        .set('Authorization', AUTH)
        .send({ visibility: 'public' });
      expect(res.status).toBe(200);
      expect(res.body.applied_changes).toContain('visibility:public');
      expect(res.body.failures).toEqual([]);
    });

    it('POST /v1/plans/:id/share — adds and removes collaborators', async () => {
      const addId = uuidv4();
      const removeId = uuidv4();
      const res = await request(app)
        .post(`/v1/plans/${PLAN_ID}/share`)
        .set('Authorization', AUTH)
        .send({
          add_collaborators: [{ user_id: addId, role: 'editor' }],
          remove_collaborators: [removeId],
        });
      expect(res.status).toBe(200);
      expect(res.body.applied_changes).toEqual([`add:${addId}:editor`, `remove:${removeId}`]);
      expect(dal.collaboratorsDal.add).toHaveBeenCalledWith(PLAN_ID, addId, 'editor');
      expect(dal.collaboratorsDal.remove).toHaveBeenCalledWith(PLAN_ID, removeId);
    });

    it('POST /v1/plans/:id/share — 403 without any plan access', async () => {
      dal.plansDal.userHasAccess.mockResolvedValue({ hasAccess: false, role: null });
      const res = await request(app)
        .post(`/v1/plans/${PLAN_ID}/share`)
        .set('Authorization', AUTH)
        .send({ visibility: 'public' });
      expect(res.status).toBe(403);
      expect(dal.plansDal.update).not.toHaveBeenCalled();
    });

    it('POST /v1/tasks/:nodeId/update — records learning when Graphiti is available', async () => {
      graphitiBridge.isAvailable.mockReturnValue(true);
      graphitiBridge.addEpisode.mockResolvedValue({ ok: true });
      dal.nodesDal.findById.mockResolvedValue(mockNode);

      const res = await request(app)
        .post(`/v1/tasks/${NODE_ID}/update`)
        .set('Authorization', AUTH)
        .send({ add_learning: 'Postgres LISTEN/NOTIFY drops messages over 8kB' });

      expect(res.status).toBe(200);
      expect(res.body.applied.learning_recorded).toBe(true);
      expect(res.body.failures).toEqual([]);
      expect(graphitiBridge.addEpisode).toHaveBeenCalledWith(
        expect.objectContaining({
          content: 'Postgres LISTEN/NOTIFY drops messages over 8kB',
          name: `Task: ${mockNode.title}`,
        })
      );
    });
  });

  // ══════════════════════════════════════════════════════════════════
  // Additional alias coverage (review follow-ups)
  // ══════════════════════════════════════════════════════════════════
  describe('alias edge cases', () => {
    const WS_ID = uuidv4();

    it('PATCH /v1/workspaces/:id with archived=true dispatches to /archive', async () => {
      dal.workspacesDal.findById.mockResolvedValue({ id: WS_ID, organizationId: ORG_ID, isDefault: false });
      dal.workspacesDal.archive.mockResolvedValue({ id: WS_ID, archivedAt: now });
      const res = await request(app)
        .patch(`/v1/workspaces/${WS_ID}`)
        .set('Authorization', AUTH)
        .send({ archived: true });
      expect(res.status).toBe(200);
      expect(dal.workspacesDal.archive).toHaveBeenCalledWith(WS_ID);
      expect(dal.workspacesDal.update).not.toHaveBeenCalled();
    });

    it('PATCH /v1/workspaces/:id with archived=false dispatches to /restore', async () => {
      dal.workspacesDal.findById.mockResolvedValue({ id: WS_ID, organizationId: ORG_ID, isDefault: false });
      dal.workspacesDal.unarchive.mockResolvedValue({ id: WS_ID, archivedAt: null });
      const res = await request(app)
        .patch(`/v1/workspaces/${WS_ID}`)
        .set('Authorization', AUTH)
        .send({ archived: false });
      expect(res.status).toBe(200);
      expect(dal.workspacesDal.unarchive).toHaveBeenCalledWith(WS_ID);
    });

    it('PATCH /v1/workspaces/:id without archived forwards to the plain PATCH handler', async () => {
      dal.workspacesDal.findById.mockResolvedValue({ id: WS_ID, organizationId: ORG_ID, isDefault: false });
      dal.workspacesDal.update.mockResolvedValue({ id: WS_ID, title: 'Renamed' });
      const res = await request(app)
        .patch(`/v1/workspaces/${WS_ID}`)
        .set('Authorization', AUTH)
        .send({ title: 'Renamed' });
      expect(res.status).toBe(200);
      expect(dal.workspacesDal.update).toHaveBeenCalled();
    });

    it('DELETE /v1/tasks/:nodeId/claim — resolves plan and releases', async () => {
      dal.nodesDal.findById.mockResolvedValue(mockNode);
      dal.claimsDal.release.mockResolvedValue({ id: uuidv4(), nodeId: NODE_ID });
      const res = await request(app)
        .delete(`/v1/tasks/${NODE_ID}/claim`)
        .set('Authorization', AUTH)
        .send({ agent_id: 'agent-1' });
      expect(res.status).toBeLessThan(400);
      expect(dal.claimsDal.release).toHaveBeenCalled();
    });

    it('PATCH /v1/orgs/:id/members/:userId — maps to the internal role PUT', async () => {
      const memberId = uuidv4();
      dal.organizationsDal.getMembership.mockResolvedValue({ role: 'owner' });
      dal.organizationsDal.listMembers.mockResolvedValue([{ id: memberId, role: 'member' }]);
      dal.organizationsDal.updateMemberRole.mockResolvedValue({ id: memberId, role: 'admin' });
      const res = await request(app)
        .patch(`/v1/orgs/${ORG_ID}/members/${memberId}`)
        .set('Authorization', AUTH)
        .send({ role: 'admin' });
      expect(res.status).toBe(200);
      expect(dal.organizationsDal.updateMemberRole).toHaveBeenCalledWith(ORG_ID, memberId, 'admin');
    });

    it('GET /v1/tasks/:nodeId/context — merges node_id with caller query params', async () => {
      dal.nodesDal.findById.mockResolvedValue(mockNode);
      const res = await request(app)
        .get(`/v1/tasks/${NODE_ID}/context?depth=4&token_budget=2000`)
        .set('Authorization', AUTH);
      expect(res.status).toBe(200);
      expect(contextEngine.assembleContext).toHaveBeenCalledWith(
        NODE_ID,
        expect.objectContaining({ depth: 4, token_budget: 2000 })
      );
    });

    it('POST /v1/dependencies — forwards to the cross-plan handler', async () => {
      const targetId = uuidv4();
      dal.nodesDal.findById.mockResolvedValue(mockNode);
      dal.dependenciesDal.wouldCreateCycle.mockResolvedValue({ hasCycle: false, cyclePath: [] });
      dal.dependenciesDal.create.mockResolvedValue({ id: uuidv4(), sourceNodeId: NODE_ID, targetNodeId: targetId });
      const res = await request(app)
        .post('/v1/dependencies')
        .set('Authorization', AUTH)
        .send({ source_node_id: NODE_ID, target_node_id: targetId, dependency_type: 'blocks' });
      expect(res.status).toBeLessThan(400);
      expect(dal.dependenciesDal.create).toHaveBeenCalled();
    });
  });

  // ══════════════════════════════════════════════════════════════════
  // Deployment wiring: /v1 must be mounted in the real server entry point.
  // The suites above build their own Express app, so this guard is what
  // catches a missing mount in src/index.js (it has happened).
  // ══════════════════════════════════════════════════════════════════
  describe('server wiring', () => {
    it('src/index.js mounts the v1 router', () => {
      const fs = require('fs');
      const path = require('path');
      const indexSrc = fs.readFileSync(path.join(__dirname, '../../src/index.js'), 'utf8');
      expect(indexSrc).toMatch(/require\('\.\/routes\/v1'\)/);
      expect(indexSrc).toMatch(/app\.use\('\/v1',\s*generalLimiter,\s*v1Routes\)/);
    });
  });

  // ══════════════════════════════════════════════════════════════════
  // forwardTo query handling — built params merge with caller params, and
  // repeated keys survive as arrays (qs-style), not last-value-wins.
  // ══════════════════════════════════════════════════════════════════
  describe('forwardTo query handling', () => {
    const express = require('express');
    const { forwardTo } = require('../../src/routes/v1/forward');

    function echoApp() {
      const target = express.Router();
      target.get('/echo', (req, res) => res.json({ query: req.query }));
      const v1 = express.Router();
      v1.get('/proxy', forwardTo(target, () => '/echo?injected=1'));
      const a = express.Router();
      a.use(v1);
      const app = express();
      app.use('/x', a);
      return app;
    }

    it('merges injected and caller params', async () => {
      const res = await request(echoApp()).get('/x/proxy?caller=2');
      expect(res.body.query).toEqual({ injected: '1', caller: '2' });
    });

    it('preserves repeated keys as arrays', async () => {
      const res = await request(echoApp()).get('/x/proxy?ids=a&ids=b');
      expect(res.body.query.ids).toEqual(['a', 'b']);
    });
  });

  // ══════════════════════════════════════════════════════════════════
  // Surface boundaries: internal routes are not exposed under /v1
  // ══════════════════════════════════════════════════════════════════
  describe('surface boundaries', () => {
    const internalOnly = [
      ['get', `/v1/plans/${PLAN_ID}/bottlenecks`],
      ['get', `/v1/plans/${PLAN_ID}/rpi-chains`],
      ['get', `/v1/plans/${PLAN_ID}/critical-path`],
      ['get', '/v1/dashboard/summary'],
      ['get', '/v1/activity/feed'],
      ['post', '/v1/auth/forgot-password'],
      ['get', '/v1/goals/tree'],
      ['get', '/v1/blueprints/public'],
      ['get', `/v1/plans/${PLAN_ID}/coherence`],
    ];

    it.each(internalOnly)('%s %s — 404 (internal only)', async (method, path) => {
      const res = await request(app)[method](path).set('Authorization', AUTH);
      expect(res.status).toBe(404);
    });
  });
});
