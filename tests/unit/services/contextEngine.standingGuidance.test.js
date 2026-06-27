// Layer-4 standing-guidance injection: active org-level principle/constraint
// goals are surfaced into every task's extended context (this is what makes
// goal.type behavioral). Mocks the DAL + Graphiti (no DB).
jest.mock('../../../src/db/dal.cjs', () => ({
  nodesDal: { findById: jest.fn(), getChildren: jest.fn().mockResolvedValue([]) },
  logsDal: { listByNode: jest.fn().mockResolvedValue([]) },
  dependenciesDal: {
    listByNode: jest.fn().mockResolvedValue({ upstream: [], downstream: [] }),
    getUpstream: jest.fn().mockResolvedValue([]),
    getDownstream: jest.fn().mockResolvedValue([]),
  },
  plansDal: { findById: jest.fn().mockResolvedValue({ id: 'plan-1', title: 'Plan' }) },
  goalsDal: {
    getLinkedGoals: jest.fn().mockResolvedValue([]),
    getStandingGuidance: jest.fn(),
  },
}));
jest.mock('../../../src/services/graphitiBridge', () => ({
  isAvailable: jest.fn(() => false),
  queryForContext: jest.fn(),
}));
jest.mock('../../../src/services/messageBus', () => ({ subscribe: jest.fn(), publish: jest.fn() }));

const dal = require('../../../src/db/dal.cjs');
const { assembleContext } = require('../../../src/services/contextEngine');

const NODE = {
  id: 'n1', planId: 'plan-1', nodeType: 'task', title: 'Do work',
  status: 'not_started', taskMode: 'free', parentId: null, orderIndex: 0,
};

beforeEach(() => {
  jest.clearAllMocks();
  dal.nodesDal.findById.mockResolvedValue(NODE);
  dal.nodesDal.getChildren.mockResolvedValue([]);
  dal.goalsDal.getLinkedGoals.mockResolvedValue([]);
});

describe('contextEngine — standing guidance (goal.type behavioral)', () => {
  it('injects active principle/constraint goals at depth 4 when orgId is present', async () => {
    dal.goalsDal.getStandingGuidance.mockResolvedValue([
      { id: 'g-p', type: 'principle', title: 'Ship small, reversible changes', description: 'Prefer incremental.' },
      { id: 'g-c', type: 'constraint', title: 'Never expose internal IDs publicly', description: null },
    ]);

    const ctx = await assembleContext('n1', { depth: 4, orgId: 'org-1', token_budget: 0 });

    expect(dal.goalsDal.getStandingGuidance).toHaveBeenCalledWith('org-1');
    expect(ctx.standing_guidance).toHaveLength(2);
    expect(ctx.standing_guidance[0]).toEqual({
      id: 'g-p', type: 'principle', title: 'Ship small, reversible changes', description: 'Prefer incremental.',
    });
    expect(ctx.standing_guidance.map(g => g.type)).toEqual(['principle', 'constraint']);
  });

  it('does not query or inject guidance when orgId is absent', async () => {
    const ctx = await assembleContext('n1', { depth: 4, token_budget: 0 });
    expect(dal.goalsDal.getStandingGuidance).not.toHaveBeenCalled();
    expect(ctx.standing_guidance).toEqual([]);
  });

  it('is a depth-4 (extended) concern — not present at depth 2', async () => {
    dal.goalsDal.getStandingGuidance.mockResolvedValue([{ id: 'g-p', type: 'principle', title: 'x', description: null }]);
    const ctx = await assembleContext('n1', { depth: 2, orgId: 'org-1', token_budget: 0 });
    expect(ctx.standing_guidance).toBeUndefined();
    expect(dal.goalsDal.getStandingGuidance).not.toHaveBeenCalled();
  });
});
