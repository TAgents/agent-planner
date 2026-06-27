/**
 * Parity guardrail: the Plans list, the Plan detail, and the plan-progress
 * endpoint MUST report the same progress for the same plan. This is the
 * regression test for the 68-vs-100 bug — it fails if any endpoint reintroduces
 * its own progress formula instead of reading the canonical planRollup.
 *
 * DB-free: the repository and DAL are mocked from ONE shared fixture so the
 * list path (batch aggregate) and the detail path (full node scan) describe the
 * exact same plan.
 */

jest.mock('../../../src/middleware/planAccess.middleware', () => ({
  checkPlanAccess: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../../src/websocket/broadcast', () => ({
  broadcastPlanUpdate: jest.fn(),
  broadcastToAll: jest.fn(),
}));
jest.mock('../../../src/domains/plan/repositories/plan.repository', () => ({
  listForUser: jest.fn(),
  listNodesByPlan: jest.fn(),
  findById: jest.fn(),
  findUserById: jest.fn(),
  listCollaborators: jest.fn(),
  listGoalTethersForPlanIds: jest.fn(),
  latestLogTimestampsByPlanIds: jest.fn(),
}));
jest.mock('../../../src/db/dal.cjs', () => ({
  nodesDal: { listByPlan: jest.fn(), workNodeStatusCountsByPlanIds: jest.fn() },
  dependenciesDal: { getCriticalPath: jest.fn() },
}));

const repo = require('../../../src/domains/plan/repositories/plan.repository');
const dal = require('../../../src/db/dal.cjs');
const planService = require('../../../src/domains/plan/services/plan.service');

const PLAN_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '22222222-2222-2222-2222-222222222222';

// One plan: root + phase + 4 work nodes (3 completed, 1 in_progress) → 75%.
// The phase deliberately stays not_started — the old "all nodes" formula would
// have reported 3/6 = 50% here and disagreed with the tree.
const PLAN_ROW = {
  id: PLAN_ID, title: 'P', ownerId: USER_ID, organizationId: null, status: 'active',
};
const NODES = [
  { id: 'root', nodeType: 'root', parentId: null, status: 'not_started' },
  { id: 'ph', nodeType: 'phase', parentId: 'root', status: 'not_started' },
  { id: 'a', nodeType: 'task', parentId: 'ph', status: 'completed' },
  { id: 'b', nodeType: 'task', parentId: 'ph', status: 'completed' },
  { id: 'c', nodeType: 'milestone', parentId: 'ph', status: 'completed' },
  { id: 'd', nodeType: 'task', parentId: 'ph', status: 'in_progress' },
];
// The batch aggregate the list path reads — derived from the SAME plan.
const AGG = [{
  plan_id: PLAN_ID, total_work: 4, not_started: 0, in_progress: 1,
  completed: 3, blocked: 0, plan_ready: 0,
}];

beforeEach(() => {
  jest.clearAllMocks();
  repo.listForUser.mockResolvedValue({ owned: [PLAN_ROW], shared: [], organization: [] });
  repo.listNodesByPlan.mockResolvedValue(NODES);
  repo.findById.mockResolvedValue(PLAN_ROW);
  repo.findUserById.mockResolvedValue({ id: USER_ID, name: 'U', email: 'u@x.io' });
  repo.listCollaborators.mockResolvedValue([]);
  repo.listGoalTethersForPlanIds.mockResolvedValue([]);
  repo.latestLogTimestampsByPlanIds.mockResolvedValue([]);
  dal.nodesDal.listByPlan.mockResolvedValue(NODES);
  dal.nodesDal.workNodeStatusCountsByPlanIds.mockResolvedValue(AGG);
  dal.dependenciesDal.getCriticalPath.mockResolvedValue({ path: [], total_weight: 0, nodes: [] });
});

it('list, detail, and progress all report 75% for the same plan', async () => {
  const list = await planService.listPlans(USER_ID, null, {});
  const row = list.find((p) => p.id === PLAN_ID);
  const detail = await planService.getPlan(PLAN_ID, USER_ID);
  const progress = await planService.getPlanProgress(PLAN_ID, USER_ID);

  expect(row.progress).toBe(75);
  expect(row.rollup.progress_pct).toBe(75);
  expect(row.stats.percentage).toBe(75);
  expect(detail.progress).toBe(75);
  expect(detail.rollup.progress_pct).toBe(75);
  expect(progress.progress_percentage).toBe(75);

  // The whole point: no surface disagrees.
  const all = [row.progress, row.rollup.progress_pct, row.stats.percentage,
    detail.progress, detail.rollup.progress_pct, progress.progress_percentage];
  expect(new Set(all).size).toBe(1);
});

it('list row stats segments sum to the work-node total', async () => {
  const list = await planService.listPlans(USER_ID, null, {});
  const { stats } = list.find((p) => p.id === PLAN_ID);
  expect(stats.done + stats.doing + stats.blocked + stats.todo).toBe(stats.total);
  expect(stats.total).toBe(4); // work nodes only — root + phase excluded
});
