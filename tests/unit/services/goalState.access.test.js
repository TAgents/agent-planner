// goal_state access boundary: org membership authorizes the GOAL, but linked
// plans carry their own visibility. getGoalState must filter linked plans AND
// achiever-path-derived tasks/bottlenecks/progress by the viewer's plan access,
// and report how many linked plans are hidden — no leaking a private plan's
// contents through the goal facade.
jest.mock('../../../src/db/dal.cjs', () => ({
  dependenciesDal: { getGoalPath: jest.fn() },
  plansDal: { findByIds: jest.fn() },
  nodesDal: { taskStatsForPlans: jest.fn() },
  goalsDal: { addEvaluation: jest.fn() },
}));
jest.mock('../../../src/services/graphitiBridge', () => ({
  isAvailable: jest.fn(() => false),
  getGroupId: jest.fn(() => 'org_test'),
  searchMemory: jest.fn().mockResolvedValue({ facts: [] }),
}));
jest.mock('../../../src/middleware/planAccess.middleware', () => ({
  checkPlanAccess: jest.fn(),
}));

const dal = require('../../../src/db/dal.cjs');
const { checkPlanAccess } = require('../../../src/middleware/planAccess.middleware');
const service = require('../../../src/domains/goal/services/goalState.service');

const USER = { id: 'u1', organizations: [{ id: 'org1' }] };

const goalWith = (planIds) => ({
  id: 'g1',
  title: 'G',
  description: 'a goal',
  type: 'outcome',
  status: 'active',
  ownerId: 'owner',
  successCriteria: null,
  links: planIds.map((pid, i) => ({ linkedType: 'plan', linkedId: pid, id: `link-${i}` })),
});

beforeEach(() => {
  jest.clearAllMocks();
  dal.plansDal.findByIds.mockResolvedValue([
    { id: 'P1', status: 'active' },
    { id: 'P2', status: 'active' },
  ]);
  dal.dependenciesDal.getGoalPath.mockResolvedValue({
    nodes: [
      { node_id: 'n1', plan_id: 'P1', title: 'visible task', status: 'not_started', depth: 1 },
      { node_id: 'n2', plan_id: 'P2', title: 'PRIVATE task', status: 'completed', depth: 1 },
    ],
    stats: { total: 2, completed: 1, completion_percentage: 50 },
  });
});

describe('getGoalState — plan-access boundary', () => {
  it('hides a linked plan the viewer cannot access and reports the hidden count', async () => {
    checkPlanAccess.mockImplementation(async (planId) => planId === 'P1'); // P2 private

    const res = await service.getGoalState(goalWith(['P1', 'P2']), USER);

    expect(res.linked_plans).toEqual([{ id: 'P1', link_id: 'link-0', title: null, status: 'active' }]);
    expect(res.hidden_linked_plan_count).toBe(1);
  });

  it('excludes inaccessible plans’ tasks from linked_tasks and bottlenecks', async () => {
    checkPlanAccess.mockImplementation(async (planId) => planId === 'P1');

    const res = await service.getGoalState(goalWith(['P1', 'P2']), USER);

    // Only the P1 node is exposed; the private P2 task ('n2') must not leak.
    expect(res.linked_tasks.map(t => t.id)).toEqual(['n1']);
    expect(res.linked_tasks.some(t => t.title === 'PRIVATE task')).toBe(false);
    expect(res.bottlenecks.map(b => b.node_id)).toEqual(['n1']);
  });

  it('computes progress over accessible path nodes only', async () => {
    checkPlanAccess.mockImplementation(async (planId) => planId === 'P1');

    const res = await service.getGoalState(goalWith(['P1', 'P2']), USER);

    // Only n1 (not_started) is visible → 0/1 complete, NOT the unfiltered 50%.
    expect(res.progress.stats.total).toBe(1);
    expect(res.progress.execution_pct).toBe(0);
  });

  it('hides nothing and exposes all tasks when the viewer can access every plan', async () => {
    checkPlanAccess.mockResolvedValue(true);

    const res = await service.getGoalState(goalWith(['P1', 'P2']), USER);

    expect(res.hidden_linked_plan_count).toBe(0);
    expect(res.linked_plans.map(p => p.id)).toEqual(['P1', 'P2']);
    expect(res.linked_tasks.map(t => t.id).sort()).toEqual(['n1', 'n2']);
  });
});
