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
    listByPlan: jest.fn(),
  },
  workspacesDal: {
    findDefault: jest.fn(),
  },
  dependenciesDal: {
    bulkCreate: jest.fn(),
    listByPlan: jest.fn(),
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
    listRecentForPlans: jest.fn(),
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

jest.mock('../../../src/services/planQualityEvaluator', () => ({
  evaluatePlanQuality: jest.fn(),
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
  dal.logsDal.listRecentForPlans.mockResolvedValue([]);
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
    dal.logsDal.listRecentForPlans.mockResolvedValue([{ id: 'log-1', planId: 'plan-1', planNodeId: 'node-1', content: 'Worked', createdAt: new Date().toISOString() }]);

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

describe('agentLoopService.createIntention — dependency structure', () => {
  const { evaluatePlanQuality } = require('../../../src/services/planQualityEvaluator');

  beforeEach(() => {
    let nc = 0;
    dal.goalsDal.findById.mockResolvedValue({ id: 'goal-1', organizationId: 'org-1', workspaceId: 'ws-1' });
    dal.plansDal.create.mockResolvedValue({ id: 'plan-1', title: 'P', status: 'active', visibility: 'private' });
    dal.nodesDal.create.mockImplementation((data) => {
      nc += 1;
      return Promise.resolve({ id: `node-${nc}`, ...data });
    });
    dal.goalsDal.addLink.mockResolvedValue({});
    dal.dependenciesDal.bulkCreate.mockImplementation((edges) => Promise.resolve(edges));
    evaluatePlanQuality.mockResolvedValue({ score: 0.5, ordering: 0.5 });
  });

  it('creates blocks edges from inline depends_on (X blocks N)', async () => {
    const result = await service.createIntention(user, {
      goal_id: 'goal-1',
      title: 'P',
      rationale: 'r',
      tree: [
        { title: 'Design', ref: 'design', node_type: 'task' },
        { title: 'Build', node_type: 'task', depends_on: ['design'] },
      ],
    });

    // root=node-1, Design=node-2, Build=node-3 → edge design(node-2) blocks Build(node-3)
    expect(dal.dependenciesDal.bulkCreate).toHaveBeenCalledWith([
      expect.objectContaining({ sourceNodeId: 'node-2', targetNodeId: 'node-3', dependencyType: 'blocks' }),
    ]);
    expect(result.structure.dependency_edges).toBe(1);
    expect(result.structure.created_without_dependencies).toBe(false);
    expect(result.warning).toBeUndefined();
  });

  it('flags created_without_dependencies for a multi-task plan with no edges', async () => {
    const result = await service.createIntention(user, {
      goal_id: 'goal-1',
      title: 'P',
      rationale: 'r',
      tree: [
        { title: 'Task A', node_type: 'task' },
        { title: 'Task B', node_type: 'task' },
      ],
    });

    expect(dal.dependenciesDal.bulkCreate).not.toHaveBeenCalled();
    expect(result.structure.task_count).toBe(2);
    expect(result.structure.dependency_edges).toBe(0);
    expect(result.structure.created_without_dependencies).toBe(true);
    expect(result.warning).toMatch(/no dependency edges/i);
    expect(result.next_required_action).toMatch(/link_intentions/);
  });

  it('stamps client_version into plan metadata.created_by and the structure', async () => {
    const result = await service.createIntention(user, {
      goal_id: 'goal-1',
      title: 'P',
      rationale: 'r',
      client_version: 'agent-planner-mcp@1.5.0',
      tree: [{ title: 'Task A', node_type: 'task' }],
    });

    expect(dal.plansDal.create).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: expect.objectContaining({ created_by: 'agent-planner-mcp@1.5.0' }) }),
    );
    expect(result.structure.created_by).toBe('agent-planner-mcp@1.5.0');
  });

  it('falls back to a generic created_by tag when no client_version is sent', async () => {
    await service.createIntention(user, {
      goal_id: 'goal-1', title: 'P', rationale: 'r', tree: [{ title: 'A', node_type: 'task' }],
    });
    expect(dal.plansDal.create).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: expect.objectContaining({ created_by: 'agent-planner-mcp' }) }),
    );
  });

  it('reports unresolved depends_on refs without creating an edge or failing', async () => {
    const result = await service.createIntention(user, {
      goal_id: 'goal-1',
      title: 'P',
      rationale: 'r',
      tree: [
        { title: 'Task A', node_type: 'task' },
        { title: 'Task B', node_type: 'task', depends_on: ['ghost'] },
      ],
    });

    expect(dal.dependenciesDal.bulkCreate).not.toHaveBeenCalled();
    expect(result.plan.id).toBe('plan-1'); // plan still created
    expect(result.structure.dependency_warnings[0]).toMatch(/ghost/);
  });
});
