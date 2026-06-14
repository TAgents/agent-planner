/**
 * Ring-2: node→node dependency creation is limited to blocks + relates_to.
 * Exercises the full HTTP path through createDependency with mocked DAL —
 * 400 for invalid/goal-only types, 200 + alias mapping for legacy types,
 * and that relates_to edges skip cycle detection.
 */
const express = require('express');
const request = require('supertest');
const { v4: uuidv4 } = require('uuid');

const PLAN_ID = uuidv4();
const SRC = uuidv4();
const TGT = uuidv4();

jest.mock('../../src/middleware/auth.middleware', () => ({
  authenticate: (req, res, next) => { req.user = { id: 'u1', organizationId: 'o1' }; next(); },
}));
jest.mock('../../src/middleware/auth.middleware.v2', () => ({
  authenticate: (req, res, next) => { req.user = { id: 'u1', organizationId: 'o1' }; next(); },
}));
jest.mock('../../src/middleware/rateLimit.middleware', () => ({
  generalLimiter: (req, res, next) => next(),
}));
jest.mock('../../src/validation', () => ({
  validate: () => [(req, res, next) => next()],
  schemas: { common: {}, dependency: {} },
}));

const mockDal = {
  plansDal: { userHasAccess: jest.fn().mockResolvedValue({ hasAccess: true, role: 'owner' }) },
  nodesDal: { findById: jest.fn() },
  dependenciesDal: {
    wouldCreateCycle: jest.fn().mockResolvedValue({ hasCycle: false, cyclePath: null }),
    create: jest.fn().mockResolvedValue({ id: uuidv4(), sourceNodeId: SRC, targetNodeId: TGT, dependencyType: 'blocks' }),
  },
};
jest.mock('../../src/db/dal.cjs', () => mockDal);

const dependencyRoutes = require('../../src/routes/dependency.routes');

function app() {
  const a = express();
  a.use(express.json());
  a.use('/plans', dependencyRoutes);
  return a;
}

const post = (body) =>
  request(app()).post(`/plans/${PLAN_ID}/dependencies`).set('Authorization', 'Bearer t').send(body);

describe('POST /plans/:id/dependencies — type validation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockDal.plansDal.userHasAccess.mockResolvedValue({ hasAccess: true, role: 'owner' });
    mockDal.nodesDal.findById.mockImplementation((id) =>
      Promise.resolve({ id, planId: PLAN_ID }));
    mockDal.dependenciesDal.wouldCreateCycle.mockResolvedValue({ hasCycle: false, cyclePath: null });
    mockDal.dependenciesDal.create.mockResolvedValue({ id: uuidv4(), sourceNodeId: SRC, targetNodeId: TGT, dependencyType: 'blocks' });
  });

  it('rejects the goal-only "achieves" type with 400', async () => {
    const res = await post({ source_node_id: SRC, target_node_id: TGT, dependency_type: 'achieves' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/achievers routes/);
    expect(mockDal.dependenciesDal.create).not.toHaveBeenCalled();
  });

  it('rejects an unknown type with 400 listing allowed types', async () => {
    const res = await post({ source_node_id: SRC, target_node_id: TGT, dependency_type: 'bogus' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Allowed: blocks, relates_to/);
  });

  it('maps legacy "requires" to blocks and creates the edge', async () => {
    const res = await post({ source_node_id: SRC, target_node_id: TGT, dependency_type: 'requires' });
    expect(res.status).toBe(201);
    expect(mockDal.dependenciesDal.create).toHaveBeenCalledWith(
      expect.objectContaining({ dependencyType: 'blocks' }));
  });

  it('defaults an omitted type to blocks (and cycle-checks it)', async () => {
    const res = await post({ source_node_id: SRC, target_node_id: TGT });
    expect(res.status).toBe(201);
    expect(mockDal.dependenciesDal.create).toHaveBeenCalledWith(
      expect.objectContaining({ dependencyType: 'blocks' }));
    expect(mockDal.dependenciesDal.wouldCreateCycle).toHaveBeenCalledWith(SRC, TGT, ['blocks']);
  });

  it('creates a relates_to edge WITHOUT running cycle detection', async () => {
    const res = await post({ source_node_id: SRC, target_node_id: TGT, dependency_type: 'relates_to' });
    expect(res.status).toBe(201);
    expect(mockDal.dependenciesDal.create).toHaveBeenCalledWith(
      expect.objectContaining({ dependencyType: 'relates_to' }));
    expect(mockDal.dependenciesDal.wouldCreateCycle).not.toHaveBeenCalled();
  });

  it('treats a null dependency_type as the default', async () => {
    const res = await post({ source_node_id: SRC, target_node_id: TGT, dependency_type: null });
    expect(res.status).toBe(201);
    expect(mockDal.dependenciesDal.create).toHaveBeenCalledWith(
      expect.objectContaining({ dependencyType: 'blocks' }));
  });
});
