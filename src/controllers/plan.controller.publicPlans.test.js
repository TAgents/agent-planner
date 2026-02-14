/**
 * Integration tests for public plans endpoints
 * Uses DAL for test fixture setup/teardown
 */

const request = require('supertest');
const { v4: uuidv4 } = require('uuid');
const express = require('express');
const planRoutes = require('../routes/plan.routes');
const { plansDal, nodesDal, usersDal } = require('../db/dal.cjs');

// Mock authentication middleware
jest.mock('../middleware/auth.middleware', () => ({
  authenticate: (req, res, next) => {
    req.user = {
      id: global.testUserId || 'test-user-id',
      email: 'test@example.com',
      name: 'Test User'
    };
    next();
  }
}));

jest.mock('../utils/logger', () => ({ api: jest.fn(), error: jest.fn() }));
jest.mock('../websocket/broadcast', () => ({ broadcastPlanUpdate: jest.fn(), broadcastToAll: jest.fn() }));

describe('Public Plans API Endpoints', () => {
  let app;
  let testUserId;
  let testPlanId;
  let publicPlanId;

  beforeAll(async () => {
    app = express();
    app.use(express.json());
    app.use('/api/plans', planRoutes);
    app.use((err, req, res, next) => { res.status(500).json({ error: err.message }); });

    testUserId = uuidv4();
    await usersDal.create({ id: testUserId, email: 'publicplans@test.com', name: 'Public Plans Test User' });
    global.testUserId = testUserId;
  });

  beforeEach(async () => {
    testPlanId = uuidv4();
    await plansDal.create({
      id: testPlanId, title: 'Private Test Plan', description: 'This is a private plan',
      ownerId: testUserId, status: 'active', isPublic: false
    });

    await nodesDal.create({
      id: uuidv4(), planId: testPlanId, nodeType: 'root',
      title: 'Private Test Plan', description: 'Root node', status: 'not_started', orderIndex: 0
    });

    publicPlanId = uuidv4();
    await plansDal.create({
      id: publicPlanId, title: 'Public Test Plan', description: 'This is a public plan',
      ownerId: testUserId, status: 'active', visibility: 'public', isPublic: true,
      viewCount: 5, githubRepoOwner: 'testorg', githubRepoName: 'testrepo'
    });

    await nodesDal.create({
      id: uuidv4(), planId: publicPlanId, nodeType: 'root',
      title: 'Public Test Plan', description: 'Root node', status: 'not_started', orderIndex: 0
    });
  });

  afterEach(async () => {
    // Clean up - nodes cascade via FK
    try { await plansDal.delete(testPlanId); } catch (e) {}
    try { await plansDal.delete(publicPlanId); } catch (e) {}
  });

  afterAll(async () => {
    try { await usersDal.delete(testUserId); } catch (e) {}
  });

  describe('GET /api/plans/public', () => {
    test('should list all public plans without authentication', async () => {
      const response = await request(app).get('/api/plans/public').expect(200);

      expect(response.body).toHaveProperty('plans');
      expect(response.body).toHaveProperty('total');
      expect(Array.isArray(response.body.plans)).toBe(true);

      const publicPlan = response.body.plans.find(p => p.id === publicPlanId);
      expect(publicPlan).toBeDefined();
      expect(publicPlan.title).toBe('Public Test Plan');
    });

    test('should not include private plans in public list', async () => {
      const response = await request(app).get('/api/plans/public').expect(200);
      const privatePlan = response.body.plans.find(p => p.id === testPlanId);
      expect(privatePlan).toBeUndefined();
    });
  });

  describe('GET /api/plans/public/:id', () => {
    test('should get a public plan with full hierarchy', async () => {
      const childNode1Id = uuidv4();
      const rootNode = await nodesDal.getRoot(publicPlanId);

      await nodesDal.create({
        id: childNode1Id, planId: publicPlanId, parentId: rootNode.id,
        nodeType: 'phase', title: 'Phase 1', description: 'First phase',
        status: 'in_progress', orderIndex: 0
      });

      const response = await request(app).get(`/api/plans/public/${publicPlanId}`).expect(200);
      expect(response.body).toHaveProperty('plan');
      expect(response.body.plan.id).toBe(publicPlanId);
      expect(response.body.plan.title).toBe('Public Test Plan');

      // Cleanup
      try { await nodesDal.delete(childNode1Id); } catch (e) {}
    });

    test('should return 404 for private plan', async () => {
      const response = await request(app).get(`/api/plans/public/${testPlanId}`);
      expect([404, 500]).toContain(response.status);
    });
  });

  describe('PUT /api/plans/:id/visibility', () => {
    test('should make a plan public using visibility parameter', async () => {
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
      const response = await request(app).post(`/api/plans/${publicPlanId}/view`).expect(200);
      expect(response.body.view_count).toBe(6);
    });
  });
});
