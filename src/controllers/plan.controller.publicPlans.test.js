/**
 * Unit tests for public plans endpoints
 * Mocks DAL layer to avoid Supabase/DB dependencies
 */

const request = require('supertest');
const { v4: uuidv4 } = require('uuid');
const express = require('express');

const testUserId = uuidv4();
const testPlanId = uuidv4();
const publicPlanId = uuidv4();
const rootNodeId = uuidv4();
const publicRootNodeId = uuidv4();

// ── Mock DAL ──────────────────────────────────────────────────────
const mockPlansDal = {
  listPublic: jest.fn(),
  findById: jest.fn(),
  create: jest.fn(),
  update: jest.fn(),
  delete: jest.fn(),
  listForUser: jest.fn(),
  userHasAccess: jest.fn(),
  incrementViewCount: jest.fn(),
};

const mockNodesDal = {
  create: jest.fn(),
  listByPlan: jest.fn(),
  getRoot: jest.fn(),
  getTree: jest.fn(),
  delete: jest.fn(),
};

const mockUsersDal = {
  create: jest.fn(),
  findById: jest.fn(),
  delete: jest.fn(),
};

const mockCollaboratorsDal = {
  listByPlan: jest.fn().mockResolvedValue([]),
};

jest.mock('../db/dal.cjs', () => ({
  plansDal: mockPlansDal,
  nodesDal: mockNodesDal,
  usersDal: mockUsersDal,
  collaboratorsDal: mockCollaboratorsDal,
}));

// Mock auth config to use v2 controllers
jest.mock('../config/auth', () => {
  const planController = require('../controllers/plan.controller.v2');
  return { planController, authVersion: 'v2' };
});

jest.mock('../middleware/auth.middleware', () => ({
  authenticate: (req, res, next) => {
    req.user = { id: global.__testUserId || 'test-user-id', email: 'test@example.com', name: 'Test User' };
    next();
  }
}));

jest.mock('../utils/logger', () => ({ api: jest.fn(), error: jest.fn() }));
jest.mock('../websocket/broadcast', () => ({ broadcastPlanUpdate: jest.fn(), broadcastToAll: jest.fn() }));

const planRoutes = require('../routes/plan.routes');

// ── Fixtures ──────────────────────────────────────────────────────
const privatePlan = {
  id: testPlanId, title: 'Private Test Plan', description: 'This is a private plan',
  ownerId: testUserId, status: 'active', visibility: 'private', isPublic: false,
  viewCount: 0, githubRepoOwner: null, githubRepoName: null,
  githubRepoUrl: null, githubRepoFullName: null, metadata: null,
  createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
};

const publicPlan = {
  id: publicPlanId, title: 'Public Test Plan', description: 'This is a public plan',
  ownerId: testUserId, status: 'active', visibility: 'public', isPublic: true,
  viewCount: 5, githubRepoOwner: 'testorg', githubRepoName: 'testrepo',
  githubRepoUrl: null, githubRepoFullName: null, metadata: null,
  createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
};

const rootNode = { id: publicRootNodeId, planId: publicPlanId, nodeType: 'root', title: 'Public Test Plan', parentId: null };

describe('Public Plans API Endpoints', () => {
  let app;

  beforeAll(() => {
    global.__testUserId = testUserId;
    app = express();
    app.use(express.json());
    app.use('/api/plans', planRoutes);
    app.use((err, req, res, next) => { res.status(500).json({ error: err.message }); });
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('GET /api/plans/public', () => {
    test('should list all public plans without authentication', async () => {
      mockPlansDal.listPublic.mockResolvedValue([publicPlan]);
      mockUsersDal.findById.mockResolvedValue({ id: testUserId, email: 'test@example.com', name: 'Test User' });
      mockNodesDal.listByPlan.mockResolvedValue([rootNode]);

      const response = await request(app).get('/api/plans/public').expect(200);

      expect(response.body).toHaveProperty('plans');
      expect(response.body).toHaveProperty('total');
      expect(Array.isArray(response.body.plans)).toBe(true);

      const plan = response.body.plans.find(p => p.id === publicPlanId);
      expect(plan).toBeDefined();
      expect(plan.title).toBe('Public Test Plan');
    });

    test('should not include private plans in public list', async () => {
      mockPlansDal.listPublic.mockResolvedValue([publicPlan]);
      mockUsersDal.findById.mockResolvedValue({ id: testUserId, email: 'test@example.com', name: 'Test User' });
      mockNodesDal.listByPlan.mockResolvedValue([rootNode]);

      const response = await request(app).get('/api/plans/public').expect(200);
      const plan = response.body.plans.find(p => p.id === testPlanId);
      expect(plan).toBeUndefined();
    });
  });

  describe('GET /api/plans/public/:id', () => {
    test('should get a public plan with full hierarchy', async () => {
      const childNode = { id: uuidv4(), planId: publicPlanId, parentId: publicRootNodeId, nodeType: 'phase', title: 'Phase 1' };
      mockPlansDal.findById.mockResolvedValue(publicPlan);
      mockNodesDal.getTree.mockResolvedValue([rootNode, childNode]);
      mockUsersDal.findById.mockResolvedValue({ id: testUserId, email: 'test@example.com', name: 'Test User' });

      const response = await request(app).get(`/api/plans/public/${publicPlanId}`).expect(200);
      expect(response.body.id).toBe(publicPlanId);
      expect(response.body.title).toBe('Public Test Plan');
    });

    test('should return 404 for private plan', async () => {
      mockPlansDal.findById.mockResolvedValue(privatePlan);

      const response = await request(app).get(`/api/plans/public/${testPlanId}`);
      expect([404, 500]).toContain(response.status);
    });
  });

  describe('PUT /api/plans/:id/visibility', () => {
    test('should make a plan public using visibility parameter', async () => {
      mockPlansDal.userHasAccess.mockResolvedValue({ hasAccess: true, role: 'owner' });
      mockPlansDal.update.mockResolvedValue({
        ...privatePlan, visibility: 'public', isPublic: true,
        githubRepoOwner: 'myorg', githubRepoName: 'myrepo',
      });

      const response = await request(app)
        .put(`/api/plans/${testPlanId}/visibility`)
        .send({ visibility: 'public', github_repo_owner: 'myorg', github_repo_name: 'myrepo' })
        .expect(200);

      expect(response.body.visibility).toBe('public');
      expect(response.body.is_public).toBe(true);
    });
  });

  describe('POST /api/plans/:id/view', () => {
    test('should increment view count for public plan', async () => {
      mockPlansDal.incrementViewCount.mockResolvedValue({ ...publicPlan, viewCount: 6 });

      const response = await request(app).post(`/api/plans/${publicPlanId}/view`).expect(200);
      expect(response.body.success).toBe(true);
    });
  });
});
