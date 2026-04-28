jest.mock('../../../src/db/dal.cjs', () => ({
  plansDal: {
    listForUser: jest.fn(),
    userHasAccess: jest.fn(),
    create: jest.fn(),
  },
  goalsDal: {
    getDashboardData: jest.fn(),
    listGoalTethersForPlanIds: jest.fn(),
    findById: jest.fn(),
    addLink: jest.fn(),
  },
  nodesDal: {
    listByPlanIds: jest.fn(),
    findById: jest.fn(),
    updateStatus: jest.fn(),
    create: jest.fn(),
  },
  decisionsDal: {
    listByPlan: jest.fn(),
    create: jest.fn(),
  },
  claimsDal: {
    claim: jest.fn(),
    getActiveClaim: jest.fn(),
    listActiveClaimsByPlan: jest.fn(),
    findById: jest.fn(),
    release: jest.fn(),
  },
  logsDal: {
    listByPlan: jest.fn(),
    create: jest.fn(),
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
const { assembleContext, suggestNextTasks } = require('../../../src/services/contextEngine');
const service = require('../../../src/domains/agent/agentLoop.service');

const user = { id: 'user-1', organizationId: 'org-1' };
const plan = { id: 'plan-1', title: 'Plan' };
const node = {
  id: 'node-1',
  planId: 'plan-1',
  nodeType: 'task',
  title: 'Task',
  status: 'not_started',
  taskMode: 'free',
};
const claim = {
  id: 'claim-1',
  nodeId: 'node-1',
  planId: 'plan-1',
  agentId: 'mcp-agent',
  claimedAt: '2026-04-28T10:00:00Z',
  expiresAt: '2026-04-28T10:30:00Z',
  releasedAt: null,
  createdBy: 'user-1',
  beliefSnapshot: [],
};

beforeEach(() => {
  jest.clearAllMocks();
  dal.plansDal.listForUser.mockResolvedValue({ owned: [plan], shared: [], organization: [] });
  dal.plansDal.userHasAccess.mockResolvedValue({ hasAccess: true, role: 'owner' });
  dal.goalsDal.getDashboardData.mockResolvedValue([]);
  dal.goalsDal.listGoalTethersForPlanIds.mockResolvedValue([]);
  dal.nodesDal.listByPlanIds.mockResolvedValue([]);
  dal.decisionsDal.listByPlan.mockResolvedValue([]);
  dal.claimsDal.listActiveClaimsByPlan.mockResolvedValue([]);
  dal.logsDal.listByPlan.mockResolvedValue({ logs: [] });
});

describe('agentLoopService.getBriefing', () => {
  it('bundles goals, decisions, claims, activity, and metadata', async () => {
    dal.goalsDal.getDashboardData.mockResolvedValue([{
      id: 'goal-1',
      title: 'Goal',
      status: 'active',
      total_nodes: 2,
      completed_nodes: 1,
      blocked_nodes: 0,
      plan_ids: ['plan-1'],
      linked_plan_count: 1,
      last_log_at: new Date().toISOString(),
    }]);
    dal.decisionsDal.listByPlan.mockResolvedValue([{ id: 'dec-1', title: 'Pick one', planId: 'plan-1', status: 'pending' }]);
    dal.claimsDal.listActiveClaimsByPlan.mockResolvedValue([claim]);
    dal.logsDal.listByPlan.mockResolvedValue({ logs: [{ id: 'log-1', content: 'Worked', createdAt: new Date().toISOString() }] });

    const result = await service.getBriefing(user, {});

    expect(result.as_of).toBeDefined();
    expect(result.goal_health.summary.total).toBe(1);
    expect(result.pending_decisions).toHaveLength(1);
    expect(result.active_claims[0]).toHaveProperty('id', 'claim-1');
    expect(result.recent_activity[0]).toHaveProperty('summary', 'Worked');
  });
});

describe('agentLoopService.startWorkSession', () => {
  it('suggests, claims, marks in progress, and returns context', async () => {
    suggestNextTasks.mockResolvedValue([node]);
    dal.claimsDal.claim.mockResolvedValue(claim);
    dal.nodesDal.updateStatus.mockResolvedValue({ ...node, status: 'in_progress' });
    assembleContext.mockResolvedValue({ task: { id: 'node-1' } });

    const result = await service.startWorkSession(user, { plan_id: 'plan-1', agent_id: 'mcp-agent' });

    expect(suggestNextTasks).toHaveBeenCalledWith('plan-1', expect.objectContaining({ limit: 1 }));
    expect(dal.claimsDal.claim).toHaveBeenCalledWith('node-1', 'plan-1', 'mcp-agent', 'user-1', 30, []);
    expect(dal.nodesDal.updateStatus).toHaveBeenCalledWith('node-1', 'in_progress');
    expect(result.session_id).toBe('claim-1');
    expect(result.context.task.id).toBe('node-1');
  });

  it('returns a dry-run candidate without claiming', async () => {
    suggestNextTasks.mockResolvedValue([node]);

    const result = await service.startWorkSession(user, { plan_id: 'plan-1', dry_run: true });

    expect(dal.claimsDal.claim).not.toHaveBeenCalled();
    expect(result.dry_run).toBe(true);
    expect(result.task.id).toBe('node-1');
  });
});

describe('agentLoopService.finishWorkSession', () => {
  it('completes task, logs, and releases claim', async () => {
    dal.claimsDal.findById.mockResolvedValue(claim);
    dal.nodesDal.findById.mockResolvedValue(node);
    dal.nodesDal.updateStatus.mockResolvedValue({ ...node, status: 'completed' });
    dal.logsDal.create.mockResolvedValue({ id: 'log-1' });
    dal.claimsDal.release.mockResolvedValue({ ...claim, releasedAt: 'now' });

    const result = await service.finishWorkSession(user, 'claim-1', { summary: 'Done' });

    expect(dal.nodesDal.updateStatus).toHaveBeenCalledWith('node-1', 'completed');
    expect(dal.logsDal.create).toHaveBeenCalledWith(expect.objectContaining({ content: 'Done' }));
    expect(dal.claimsDal.release).toHaveBeenCalledWith('node-1', 'mcp-agent');
    expect(result.claim_released).toBe(true);
  });
});
