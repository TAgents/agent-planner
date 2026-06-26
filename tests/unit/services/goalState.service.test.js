// goal_state progress reconciliation: a goal that links a PLAN (not per-task
// achiever edges) has an empty achiever path. goal_state.progress must then
// fall back to the linked plans' task completion so it matches the
// dashboard/briefing (which showed 88% while goal_state reported 0%).
jest.mock('../../../src/db/dal.cjs', () => ({
  dependenciesDal: { getGoalPath: jest.fn() },
  plansDal: { findByIds: jest.fn() },
  nodesDal: { taskStatsForPlans: jest.fn() },
}));

jest.mock('../../../src/services/graphitiBridge', () => ({
  isAvailable: jest.fn(() => false),
  getGroupId: jest.fn(() => 'org_test'),
}));

const dal = require('../../../src/db/dal.cjs');
const service = require('../../../src/domains/goal/services/goalState.service');

const PLAN_ID = 'plan-1';

describe('getGoalProgress — linked-plan fallback', () => {
  beforeEach(() => jest.clearAllMocks());

  it('falls back to linked-plan task completion when the achiever path is empty', async () => {
    dal.dependenciesDal.getGoalPath.mockResolvedValue({
      nodes: [], stats: { total: 0, completed: 0, completion_percentage: 0 },
    });
    dal.nodesDal.taskStatsForPlans.mockResolvedValue({ total: 8, completed: 7 });

    const result = await service.getGoalProgress('goal-1', null, [PLAN_ID]);

    expect(dal.nodesDal.taskStatsForPlans).toHaveBeenCalledWith([PLAN_ID]);
    expect(result.progress).toBe(88); // 7/8 — matches briefing, not 0
    expect(result.stats.source).toBe('linked_plans');
    expect(result.stats.total).toBe(8);
  });

  it('uses the achiever path when it has nodes (no fallback)', async () => {
    dal.dependenciesDal.getGoalPath.mockResolvedValue({
      nodes: [{ depth: 1, status: 'completed' }, { depth: 1, status: 'not_started' }],
      stats: { total: 2, completed: 1, completion_percentage: 50 },
    });

    const result = await service.getGoalProgress('goal-1', null, [PLAN_ID]);

    expect(dal.nodesDal.taskStatsForPlans).not.toHaveBeenCalled();
    expect(result.progress).toBe(50);
    expect(result.direct_progress).toBe(50);
  });

  it('stays at 0 when the path is empty and there are no linked plans', async () => {
    dal.dependenciesDal.getGoalPath.mockResolvedValue({
      nodes: [], stats: { total: 0, completed: 0, completion_percentage: 0 },
    });

    const result = await service.getGoalProgress('goal-1', null, []);

    expect(dal.nodesDal.taskStatsForPlans).not.toHaveBeenCalled();
    expect(result.progress).toBe(0);
  });
});
