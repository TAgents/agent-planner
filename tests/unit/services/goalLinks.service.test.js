// Shared plan→goal achiever cascade. The createIntention facade previously
// skipped this (called goalsDal.addLink directly), leaving form_intention plans
// with an empty achiever path. This helper is now the single source for both
// the REST link route and the facade.
jest.mock('../../../src/db/dal.cjs', () => ({
  nodesDal: { listByPlan: jest.fn() },
  dependenciesDal: { listByGoal: jest.fn(), create: jest.fn().mockResolvedValue({}) },
}));

const dal = require('../../../src/db/dal.cjs');
const { cascadePlanAchievers } = require('../../../src/domains/goal/services/goalLinks.service');

beforeEach(() => {
  jest.clearAllMocks();
  dal.dependenciesDal.create.mockResolvedValue({});
});

describe('cascadePlanAchievers', () => {
  it('creates achieves edges for task nodes only (not phases/milestones)', async () => {
    dal.nodesDal.listByPlan.mockResolvedValue([
      { id: 'n1', nodeType: 'task' },
      { id: 'p1', nodeType: 'phase' },
      { id: 'n2', nodeType: 'task' },
      { id: 'm1', nodeType: 'milestone' },
    ]);
    dal.dependenciesDal.listByGoal.mockResolvedValue([]);

    const created = await cascadePlanAchievers({ goalId: 'g1', planId: 'P1', linkId: 'L1', userId: 'u1' });

    expect(created).toBe(2);
    expect(dal.dependenciesDal.create).toHaveBeenCalledTimes(2);
    expect(dal.dependenciesDal.create).toHaveBeenCalledWith(expect.objectContaining({
      sourceNodeId: 'n1', targetGoalId: 'g1', dependencyType: 'achieves',
      metadata: { auto_created_from_link: 'L1' }, createdBy: 'u1',
    }));
  });

  it('is idempotent — skips task nodes that already achieve the goal', async () => {
    dal.nodesDal.listByPlan.mockResolvedValue([
      { id: 'n1', nodeType: 'task' },
      { id: 'n2', nodeType: 'task' },
    ]);
    dal.dependenciesDal.listByGoal.mockResolvedValue([{ node: { id: 'n1' } }]); // n1 already wired

    const created = await cascadePlanAchievers({ goalId: 'g1', planId: 'P1', userId: 'u1' });

    expect(created).toBe(1);
    expect(dal.dependenciesDal.create).toHaveBeenCalledTimes(1);
    expect(dal.dependenciesDal.create).toHaveBeenCalledWith(expect.objectContaining({ sourceNodeId: 'n2' }));
  });

  it('handles snake_case node_type and an empty plan', async () => {
    dal.nodesDal.listByPlan.mockResolvedValue([{ id: 'n1', node_type: 'task' }]);
    dal.dependenciesDal.listByGoal.mockResolvedValue([]);
    expect(await cascadePlanAchievers({ goalId: 'g1', planId: 'P1', userId: 'u1' })).toBe(1);

    dal.nodesDal.listByPlan.mockResolvedValue([]);
    expect(await cascadePlanAchievers({ goalId: 'g1', planId: 'P2', userId: 'u1' })).toBe(0);
  });
});
