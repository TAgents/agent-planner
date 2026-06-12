jest.mock('../../../src/db/dal.cjs', () => ({
  plansDal: {
    listForUser: jest.fn(),
    userHasAccess: jest.fn(),
  },
  goalsDal: {
    listGoalTethersForPlanIds: jest.fn(),
  },
  nodesDal: {
    listByPlanIds: jest.fn(),
    findById: jest.fn(),
    updateStatus: jest.fn(),
  },
  claimsDal: {
    claim: jest.fn(),
  },
}));

jest.mock('../../../src/services/contextEngine', () => ({
  assembleContext: jest.fn(),
  suggestNextTasks: jest.fn(),
}));

jest.mock('../../../src/services/reasoning', () => ({
  detectBottlenecks: jest.fn(),
}));

jest.mock('../../../src/services/graphitiBridge', () => ({
  isAvailable: jest.fn(() => false),
  getGroupId: jest.fn(() => 'org_test'),
  addEpisode: jest.fn(),
}));

const dal = require('../../../src/db/dal.cjs');
const { suggestNextTasks } = require('../../../src/services/contextEngine');
const service = require('../../../src/domains/agent/agentLoop.service');

const user = { id: 'user-1', organizationId: 'org-1' };
const plan = { id: 'plan-1', title: 'Plan' };

// A "blocked" task — exists in the plan, status=not_started, but dependency-blind selection
// would still return it because `nodesDal.listByPlanIds({status: 'not_started'})` doesn't
// know about deps. suggestNextTasks correctly excludes it.
const blockedTask = {
  id: 'blocked-task',
  planId: 'plan-1',
  nodeType: 'task',
  title: 'Blocked task',
  status: 'not_started',
  taskMode: 'free',
};

beforeEach(() => {
  jest.clearAllMocks();
  dal.plansDal.listForUser.mockResolvedValue({ owned: [plan], shared: [], organization: [] });
  dal.plansDal.userHasAccess.mockResolvedValue({ hasAccess: true, role: 'owner' });
  dal.goalsDal.listGoalTethersForPlanIds.mockResolvedValue([]);
});

describe('agentLoopService.startWorkSession — fail-closed contract', () => {
  describe('fail-closed when all remaining work is dep-blocked', () => {
    it('returns 404 / no-task when nothing is dependency-ready', async () => {
      suggestNextTasks.mockResolvedValue([]);
      dal.nodesDal.listByPlanIds.mockImplementation(async (_planIds, opts) => {
        if (opts?.status === 'in_progress') return [];
        if (opts?.status === 'not_started') return [blockedTask];
        return [];
      });

      await expect(
        service.startWorkSession(user, { plan_id: plan.id, dry_run: true })
      ).rejects.toMatchObject({ code: 'not_found' });
    });

    it('includes reason="blocked_on_dep" or similar in the error when blockers exist', async () => {
      suggestNextTasks.mockResolvedValue([]);
      dal.nodesDal.listByPlanIds.mockImplementation(async (_planIds, opts) => {
        if (opts?.status === 'in_progress') return [];
        if (opts?.status === 'not_started') return [blockedTask];
        return [];
      });

      try {
        await service.startWorkSession(user, { plan_id: plan.id, dry_run: true });
        throw new Error('expected fail-closed rejection');
      } catch (err) {
        expect(err.code).toBe('not_found');
        // Whatever shape the API standardizes — reason must distinguish "no tasks at all"
        // from "all remaining tasks are blocked on incomplete deps".
        expect(err.reason || err.message).toMatch(/blocked|dep/i);
      }
    });
  });
});
