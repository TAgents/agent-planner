/**
 * Unit tests for Goals v2 Routes
 */
const express = require('express');
const request = require('supertest');

// Mock logger
jest.mock('../../utils/logger', () => ({
  error: jest.fn(),
  warn: jest.fn(),
}));

// Mock auth middleware
jest.mock('../../middleware/auth.middleware', () => ({
  authenticate: (req, res, next) => {
    req.user = { id: 'test-user-id' };
    next();
  },
}));

const mockGoalsDal = {
  findAll: jest.fn(),
  findById: jest.fn(),
  create: jest.fn(),
  update: jest.fn(),
  softDelete: jest.fn(),
  getTree: jest.fn(),
  addLink: jest.fn(),
  removeLink: jest.fn(),
  addEvaluation: jest.fn(),
  getEvaluations: jest.fn(),
};

// Mock DAL via CJS bridge
jest.mock('../../db/dal.cjs', () => ({ goalsDal: mockGoalsDal }));

const goalsRoutes = require('./goals.routes');

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/goals', goalsRoutes);
  return app;
}

describe('Goals v2 Routes', () => {
  let app;

  beforeEach(() => {
    app = createApp();
    jest.clearAllMocks();
  });

  describe('GET /api/goals', () => {
    it('returns goals list', async () => {
      mockGoalsDal.findAll.mockResolvedValue([{ id: 'g1', title: 'Test Goal', ownerId: 'test-user-id' }]);
      const res = await request(app).get('/api/goals');
      expect(res.status).toBe(200);
      expect(res.body.goals).toHaveLength(1);
    });

    it('returns 500 on error', async () => {
      mockGoalsDal.findAll.mockRejectedValue(new Error('db error'));
      const res = await request(app).get('/api/goals');
      expect(res.status).toBe(500);
    });
  });

  describe('GET /api/goals/tree', () => {
    it('returns goal tree', async () => {
      mockGoalsDal.getTree.mockResolvedValue([{ id: 'g1', title: 'Root', children: [] }]);
      const res = await request(app).get('/api/goals/tree');
      expect(res.status).toBe(200);
      expect(res.body.tree).toHaveLength(1);
    });
  });

  describe('POST /api/goals', () => {
    it('creates a goal', async () => {
      mockGoalsDal.create.mockResolvedValue({ id: 'new-goal', title: 'Test', type: 'outcome' });
      const res = await request(app).post('/api/goals').send({ title: 'Test', type: 'outcome' });
      expect(res.status).toBe(201);
      expect(res.body.title).toBe('Test');
    });

    it('requires title and type', async () => {
      const res = await request(app).post('/api/goals').send({ title: 'Test' });
      expect(res.status).toBe(400);
    });

    it('validates type', async () => {
      const res = await request(app).post('/api/goals').send({ title: 'Test', type: 'invalid' });
      expect(res.status).toBe(400);
    });
  });

  describe('GET /api/goals/:id', () => {
    it('returns goal detail', async () => {
      mockGoalsDal.findById.mockResolvedValue({ id: 'g1', title: 'Test', ownerId: 'test-user-id', links: [], evaluations: [] });
      const res = await request(app).get('/api/goals/g1');
      expect(res.status).toBe(200);
      expect(res.body.id).toBe('g1');
    });

    it('returns 404 when not found', async () => {
      mockGoalsDal.findById.mockResolvedValue(null);
      const res = await request(app).get('/api/goals/nonexistent');
      expect(res.status).toBe(404);
    });

    it('returns 403 for other user', async () => {
      mockGoalsDal.findById.mockResolvedValue({ id: 'g1', ownerId: 'other-user' });
      const res = await request(app).get('/api/goals/g1');
      expect(res.status).toBe(403);
    });
  });

  describe('POST /api/goals/:id/evaluations', () => {
    it('creates an evaluation', async () => {
      mockGoalsDal.addEvaluation.mockResolvedValue({ id: 'e1', goalId: 'g1', score: 80 });
      const res = await request(app).post('/api/goals/g1/evaluations').send({ evaluatedBy: 'human', score: 80 });
      expect(res.status).toBe(201);
    });

    it('requires evaluatedBy', async () => {
      const res = await request(app).post('/api/goals/g1/evaluations').send({ score: 80 });
      expect(res.status).toBe(400);
    });

    it('validates score range', async () => {
      const res = await request(app).post('/api/goals/g1/evaluations').send({ evaluatedBy: 'human', score: 150 });
      expect(res.status).toBe(400);
    });
  });
});
