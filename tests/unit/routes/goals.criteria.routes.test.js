// Route-level test for POST /goals/:id/criteria/progress — exercises the real
// Express handler + auto-achieve wiring over a mocked DAL (no DB).
jest.mock('../../../src/db/dal.cjs', () => ({
  goalsDal: { findById: jest.fn(), update: jest.fn() },
  dependenciesDal: {},
  nodesDal: {},
  plansDal: {},
  logsDal: {},
  workspacesDal: {},
  organizationsDal: {},
}));
jest.mock('../../../src/middleware/auth.middleware', () => ({
  authenticate: (req, _res, next) => { req.user = { id: 'owner-1', organizations: [] }; next(); },
}));

const express = require('express');
const request = require('supertest');
const dal = require('../../../src/db/dal.cjs');
const goalsRoutes = require('../../../src/routes/v2/goals.routes');

const app = () => {
  const a = express();
  a.use(express.json());
  a.use('/goals', goalsRoutes);
  return a;
};

// A personal goal (no organizationId) owned by the injected user, with one
// boolean criterion not yet met.
const baseGoal = () => ({
  id: 'g1',
  ownerId: 'owner-1',
  organizationId: null,
  status: 'active',
  successCriteria: [{ id: 'c0', statement: 'oauth shipped', metric: 'oauth', direction: 'boolean', current: false }],
});

beforeEach(() => {
  jest.clearAllMocks();
  dal.goalsDal.update.mockImplementation(async (_id, patch) => patch);
});

describe('POST /goals/:id/criteria/progress', () => {
  it('auto-achieves the goal when the update makes every measurable criterion met', async () => {
    dal.goalsDal.findById.mockResolvedValue(baseGoal());

    const res = await request(app())
      .post('/goals/g1/criteria/progress')
      .send({ criterion_id: 'c0', current: true })
      .expect(200);

    expect(res.body.auto_achieved).toBe(true);
    expect(res.body.status).toBe('achieved');
    expect(res.body.criterion.current).toBe(true);
    // Persisted with status flipped to achieved.
    expect(dal.goalsDal.update).toHaveBeenCalledWith('g1', expect.objectContaining({ status: 'achieved' }));
  });

  it('does not achieve while a measurable criterion is still unmet', async () => {
    const goal = baseGoal();
    goal.successCriteria = [
      { id: 'c0', metric: 'oauth', direction: 'boolean', current: false },
      { id: 'c1', metric: 'latency', target: 100, direction: 'decrease', current: 200 },
    ];
    dal.goalsDal.findById.mockResolvedValue(goal);

    const res = await request(app())
      .post('/goals/g1/criteria/progress')
      .send({ index: 0, current: true })
      .expect(200);

    expect(res.body.auto_achieved).toBe(false);
    expect(res.body.status).toBe('active');
    expect(dal.goalsDal.update).toHaveBeenCalledWith('g1', expect.not.objectContaining({ status: expect.anything() }));
  });

  it('400s without current, 404s for an unknown criterion id', async () => {
    dal.goalsDal.findById.mockResolvedValue(baseGoal());
    await request(app()).post('/goals/g1/criteria/progress').send({ criterion_id: 'c0' }).expect(400);

    dal.goalsDal.findById.mockResolvedValue(baseGoal());
    await request(app()).post('/goals/g1/criteria/progress').send({ criterion_id: 'zzz', current: true }).expect(404);
  });
});
