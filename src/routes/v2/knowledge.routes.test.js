/**
 * Unit tests for Knowledge v2 Routes
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

const mockKnowledgeDal = {
  findAll: jest.fn(),
  findById: jest.fn(),
  create: jest.fn(),
  update: jest.fn(),
  remove: jest.fn(),
  search: jest.fn(),
  getSimilarityGraph: jest.fn(),
};

jest.mock('../../db/dal/index.mjs', () => ({ knowledgeDal: mockKnowledgeDal }), { virtual: true });
jest.mock('../../services/embedding.mjs', () => ({
  generateEmbedding: jest.fn().mockResolvedValue(new Array(1536).fill(0)),
}), { virtual: true });

const knowledgeRoutes = require('./knowledge.routes');

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/knowledge', knowledgeRoutes);
  return app;
}

describe('Knowledge v2 Routes', () => {
  let app;

  beforeEach(() => {
    app = createApp();
    jest.clearAllMocks();
  });

  describe('GET /api/knowledge', () => {
    it('returns knowledge entries', async () => {
      mockKnowledgeDal.findAll.mockResolvedValue({ entries: [{ id: 'k1', title: 'Test' }], count: 1 });
      const res = await request(app).get('/api/knowledge');
      expect(res.status).toBe(200);
    });

    it('returns 500 on error', async () => {
      mockKnowledgeDal.findAll.mockRejectedValue(new Error('db error'));
      const res = await request(app).get('/api/knowledge');
      expect(res.status).toBe(500);
    });
  });

  describe('POST /api/knowledge', () => {
    it('creates a knowledge entry', async () => {
      mockKnowledgeDal.create.mockResolvedValue({ id: 'k-new', title: 'Test' });
      const res = await request(app).post('/api/knowledge').send({
        title: 'Test', content: 'Content', entryType: 'note',
      });
      expect([200, 201]).toContain(res.status);
    });
  });

  describe('POST /api/knowledge/search', () => {
    it('searches knowledge', async () => {
      mockKnowledgeDal.search.mockResolvedValue({ results: [], method: 'text' });
      const res = await request(app).post('/api/knowledge/search').send({ query: 'test' });
      expect(res.status).toBe(200);
    });
  });
});
