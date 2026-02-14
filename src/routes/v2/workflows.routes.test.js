/**
 * Unit tests for Workflows v2 Routes
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

// Mock hatchet module
const workflowsRoutes = require('./workflows.routes');

const mockHatchet = {
  listWorkflowRuns: jest.fn(),
  getWorkflowRun: jest.fn(),
  listWorkflows: jest.fn(),
  listEvents: jest.fn(),
};
workflowsRoutes._setHatchetModule(mockHatchet);

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/workflows', workflowsRoutes);
  return app;
}

describe('Workflows v2 Routes', () => {
  let app;

  beforeEach(() => {
    app = createApp();
    jest.clearAllMocks();
  });

  describe('GET /api/workflows/runs', () => {
    it('returns workflow runs', async () => {
      const mockData = { rows: [{ id: 'run-1', status: 'RUNNING' }], pagination: { total: 1 } };
      mockHatchet.listWorkflowRuns.mockResolvedValue(mockData);

      const res = await request(app).get('/api/workflows/runs');
      expect(res.status).toBe(200);
      expect(res.body).toEqual(mockData);
      expect(mockHatchet.listWorkflowRuns).toHaveBeenCalledWith({
        status: undefined,
        limit: 20,
        offset: 0,
      });
    });

    it('passes query params', async () => {
      mockHatchet.listWorkflowRuns.mockResolvedValue({ rows: [], pagination: { total: 0 } });

      await request(app).get('/api/workflows/runs?status=RUNNING&limit=10&offset=5');
      expect(mockHatchet.listWorkflowRuns).toHaveBeenCalledWith({
        status: 'RUNNING',
        limit: 10,
        offset: 5,
      });
    });

    it('returns 500 on error', async () => {
      mockHatchet.listWorkflowRuns.mockRejectedValue(new Error('fail'));
      const res = await request(app).get('/api/workflows/runs');
      expect(res.status).toBe(500);
      expect(res.body.error).toBe('Failed to list workflow runs');
    });
  });

  describe('GET /api/workflows/runs/:runId', () => {
    it('returns a workflow run', async () => {
      const mockRun = { id: 'run-1', status: 'COMPLETED', steps: [] };
      mockHatchet.getWorkflowRun.mockResolvedValue(mockRun);

      const res = await request(app).get('/api/workflows/runs/run-1');
      expect(res.status).toBe(200);
      expect(res.body).toEqual(mockRun);
    });

    it('returns 404 when not found', async () => {
      mockHatchet.getWorkflowRun.mockResolvedValue(null);
      const res = await request(app).get('/api/workflows/runs/nonexistent');
      expect(res.status).toBe(404);
    });

    it('returns 500 on error', async () => {
      mockHatchet.getWorkflowRun.mockRejectedValue(new Error('fail'));
      const res = await request(app).get('/api/workflows/runs/run-1');
      expect(res.status).toBe(500);
    });
  });

  describe('GET /api/workflows/templates', () => {
    it('returns workflow templates', async () => {
      const mockWorkflows = [{ id: 'wf-1', name: 'messaging' }];
      mockHatchet.listWorkflows.mockResolvedValue(mockWorkflows);

      const res = await request(app).get('/api/workflows/templates');
      expect(res.status).toBe(200);
      expect(res.body.workflows).toEqual(mockWorkflows);
    });

    it('returns 500 on error', async () => {
      mockHatchet.listWorkflows.mockRejectedValue(new Error('fail'));
      const res = await request(app).get('/api/workflows/templates');
      expect(res.status).toBe(500);
    });
  });

  describe('GET /api/workflows/events', () => {
    it('returns events', async () => {
      const mockData = { rows: [{ id: 'evt-1' }], pagination: { total: 1 } };
      mockHatchet.listEvents.mockResolvedValue(mockData);

      const res = await request(app).get('/api/workflows/events');
      expect(res.status).toBe(200);
      expect(res.body).toEqual(mockData);
    });

    it('returns 500 on error', async () => {
      mockHatchet.listEvents.mockRejectedValue(new Error('fail'));
      const res = await request(app).get('/api/workflows/events');
      expect(res.status).toBe(500);
    });
  });
});
