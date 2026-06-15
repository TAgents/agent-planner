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
  it('research surfaces first when an RPI chain is authored in order', async () => {
    // No dependencies — all three are "ready" simultaneously. Selection now
    // follows plan (document) order, and a real RPI chain is authored
    // research → plan → implement, so research (orderIndex 0) wins.
    dal.nodesDal.listByPlan.mockResolvedValue([
      task('Research', { taskMode: 'research', orderIndex: 0 }),
      task('Plan', { taskMode: 'plan', orderIndex: 1 }),
      task('Implement', { taskMode: 'implement', orderIndex: 2 }),
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

describe('suggestNextTasks — plan (document) order vs recency/leverage', () => {
  // Regression for: "continuing a partial plan skips earlier unfinished tasks."
  // An earlier-phase task must be selected before a later-phase task even when
  // the later one unblocks more work — and even though both share order_index 0
  // within their respective phases (order_index is per-parent, not global).
  const root = { id: 'ROOT', planId: PLAN_ID, nodeType: 'root', status: 'in_progress', parentId: null, orderIndex: 0 };
  const phase1 = { id: 'P1', planId: PLAN_ID, nodeType: 'phase', status: 'not_started', parentId: 'ROOT', orderIndex: 0 };
  const phase2 = { id: 'P2', planId: PLAN_ID, nodeType: 'phase', status: 'not_started', parentId: 'ROOT', orderIndex: 1 };

  it('earlier-phase task wins over a later-phase task with more unblocks', async () => {
    dal.nodesDal.listByPlan.mockResolvedValue([
      root, phase1, phase2,
      task('A_phase1', { parentId: 'P1', orderIndex: 0 }),       // earlier phase, unblocks 0
      task('B_phase2', { parentId: 'P2', orderIndex: 0 }),       // later phase, unblocks 1
      task('C_phase2', { parentId: 'P2', orderIndex: 1 }),       // blocked by B
    ]);
    dal.dependenciesDal.listByPlan.mockResolvedValue([blocks('B_phase2', 'C_phase2')]);

    const out = await suggestNextTasks(PLAN_ID, { limit: 10 });

    // A and B are both ready; C is blocked. A must come first despite B's higher leverage.
    expect(out.map(t => t.id)).toEqual(['A_phase1', 'B_phase2']);
  });
});
