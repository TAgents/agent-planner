jest.mock('../../../src/db/dal.cjs', () => ({
  nodesDal: {
    listByPlan: jest.fn(),
  },
  dependenciesDal: {
    listByPlan: jest.fn(),
  },
  claimsDal: {
    getActiveClaim: jest.fn(),
  },
}));

jest.mock('../../../src/services/graphitiBridge', () => ({
  isAvailable: jest.fn(() => false),
  queryForContext: jest.fn(),
}));

const dal = require('../../../src/db/dal.cjs');
const { suggestNextTasks } = require('../../../src/services/contextEngine');

const PLAN_ID = 'plan-1';

function task(id, overrides = {}) {
  return {
    id,
    planId: PLAN_ID,
    nodeType: 'task',
    title: id,
    status: 'not_started',
    taskMode: 'free',
    parentId: null,
    orderIndex: 0,
    ...overrides,
  };
}

function blocks(sourceId, targetId) {
  return {
    dependency: {
      sourceNodeId: sourceId,
      targetNodeId: targetId,
      dependencyType: 'blocks',
    },
  };
}

function requires(sourceId, targetId) {
  return {
    dependency: {
      sourceNodeId: sourceId,
      targetNodeId: targetId,
      dependencyType: 'requires',
    },
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  dal.claimsDal.getActiveClaim.mockResolvedValue(null);
});

describe('suggestNextTasks — blocking dependency semantics', () => {
  it('returns only A when A blocks B and A is incomplete', async () => {
    dal.nodesDal.listByPlan.mockResolvedValue([task('A'), task('B')]);
    dal.dependenciesDal.listByPlan.mockResolvedValue([blocks('A', 'B')]);

    const out = await suggestNextTasks(PLAN_ID, { limit: 10 });

    const ids = out.map(t => t.id);
    expect(ids).toEqual(['A']);
  });

  it('returns A and B when A blocks B and A is completed', async () => {
    dal.nodesDal.listByPlan.mockResolvedValue([
      task('A', { status: 'completed' }),
      task('B'),
    ]);
    dal.dependenciesDal.listByPlan.mockResolvedValue([blocks('A', 'B')]);

    const out = await suggestNextTasks(PLAN_ID, { limit: 10 });

    const ids = out.map(t => t.id);
    expect(ids).toContain('B');
    // A is completed so it isn't a "next task" anymore
    expect(ids).not.toContain('A');
  });

  it('treats "requires" dep type same as "blocks" for readiness', async () => {
    dal.nodesDal.listByPlan.mockResolvedValue([task('A'), task('B')]);
    dal.dependenciesDal.listByPlan.mockResolvedValue([requires('A', 'B')]);

    const out = await suggestNextTasks(PLAN_ID, { limit: 10 });

    expect(out.map(t => t.id)).toEqual(['A']);
  });

  it('chains correctly: A→B→C, only A surfaces when nothing complete', async () => {
    dal.nodesDal.listByPlan.mockResolvedValue([task('A'), task('B'), task('C')]);
    dal.dependenciesDal.listByPlan.mockResolvedValue([
      blocks('A', 'B'),
      blocks('B', 'C'),
    ]);

    const out = await suggestNextTasks(PLAN_ID, { limit: 10 });

    expect(out.map(t => t.id)).toEqual(['A']);
  });

  it('chains correctly: A→B→C, B surfaces after A completes', async () => {
    dal.nodesDal.listByPlan.mockResolvedValue([
      task('A', { status: 'completed' }),
      task('B'),
      task('C'),
    ]);
    dal.dependenciesDal.listByPlan.mockResolvedValue([
      blocks('A', 'B'),
      blocks('B', 'C'),
    ]);

    const out = await suggestNextTasks(PLAN_ID, { limit: 10 });

    expect(out.map(t => t.id)).toEqual(['B']);
  });
});

describe('suggestNextTasks — active claim exclusion', () => {
  it('skips tasks with an active claim even if dependency-ready', async () => {
    dal.nodesDal.listByPlan.mockResolvedValue([task('A'), task('B')]);
    dal.dependenciesDal.listByPlan.mockResolvedValue([]);
    dal.claimsDal.getActiveClaim.mockImplementation(async (id) => (id === 'A' ? { id: 'claim-A' } : null));

    const out = await suggestNextTasks(PLAN_ID, { limit: 10 });

    expect(out.map(t => t.id)).toEqual(['B']);
  });
});

describe('suggestNextTasks — RPI chain ordering', () => {
  it('research surfaces before plan before implement when all three are ready', async () => {
    // No dependencies — all three are "ready" simultaneously.
    // Ordering must come from task_mode priority, not dependency state.
    dal.nodesDal.listByPlan.mockResolvedValue([
      task('Implement', { taskMode: 'implement', orderIndex: 0 }),
      task('Plan', { taskMode: 'plan', orderIndex: 1 }),
      task('Research', { taskMode: 'research', orderIndex: 2 }),
    ]);
    dal.dependenciesDal.listByPlan.mockResolvedValue([]);

    const out = await suggestNextTasks(PLAN_ID, { limit: 10 });

    expect(out[0].id).toBe('Research');
  });

  it('respects RPI dependency chain: only research surfaces when chain is fresh', async () => {
    dal.nodesDal.listByPlan.mockResolvedValue([
      task('Research', { taskMode: 'research' }),
      task('Plan', { taskMode: 'plan' }),
      task('Implement', { taskMode: 'implement' }),
    ]);
    dal.dependenciesDal.listByPlan.mockResolvedValue([
      blocks('Research', 'Plan'),
      blocks('Plan', 'Implement'),
    ]);

    const out = await suggestNextTasks(PLAN_ID, { limit: 10 });

    expect(out.map(t => t.id)).toEqual(['Research']);
  });

  it('after research completes, plan becomes the only candidate', async () => {
    dal.nodesDal.listByPlan.mockResolvedValue([
      task('Research', { taskMode: 'research', status: 'completed' }),
      task('Plan', { taskMode: 'plan' }),
      task('Implement', { taskMode: 'implement' }),
    ]);
    dal.dependenciesDal.listByPlan.mockResolvedValue([
      blocks('Research', 'Plan'),
      blocks('Plan', 'Implement'),
    ]);

    const out = await suggestNextTasks(PLAN_ID, { limit: 10 });

    expect(out.map(t => t.id)).toEqual(['Plan']);
  });
});
