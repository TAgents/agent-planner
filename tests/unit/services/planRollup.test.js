/**
 * Unit tests for planRollup.service.js — the canonical plan rollup.
 * The pure core needs no DB; computePlanRollup is tested against a mocked DAL.
 */

jest.mock('../../../src/db/dal.cjs', () => ({
  nodesDal: { listByPlan: jest.fn() },
  dependenciesDal: { getCriticalPath: jest.fn() },
}));

const dal = require('../../../src/db/dal.cjs');
const {
  rollupFromNodes,
  effectiveContainerStatus,
  computePlanRollup,
  computePlanRollups,
} = require('../../../src/services/planRollup.service');

beforeEach(() => jest.clearAllMocks());

const tree = () => [
  { id: 'root', nodeType: 'root', parentId: null, status: 'not_started' },
  { id: 'p1', nodeType: 'phase', parentId: 'root', status: 'not_started' },
  { id: 't1', nodeType: 'task', parentId: 'p1', status: 'completed' },
  { id: 't2', nodeType: 'task', parentId: 'p1', status: 'completed' },
  { id: 'm1', nodeType: 'milestone', parentId: 'p1', status: 'completed' },
  { id: 'p2', nodeType: 'phase', parentId: 'root', status: 'not_started' },
  { id: 't3', nodeType: 'task', parentId: 'p2', status: 'in_progress' },
];

describe('rollupFromNodes — canonical denominator (task+milestone only)', () => {
  it('ignores root and phases in the denominator', () => {
    const r = rollupFromNodes(tree());
    expect(r.total_work).toBe(4); // t1 t2 m1 t3 — NOT root/p1/p2
    expect(r.completed_work).toBe(3);
    expect(r.progress_pct).toBe(75);
  });

  it('reaches 100% when all work is done even if phases stay not_started', () => {
    const nodes = tree().map((n) =>
      n.nodeType === 'task' || n.nodeType === 'milestone' ? { ...n, status: 'completed' } : n
    );
    expect(rollupFromNodes(nodes).progress_pct).toBe(100); // the 68-vs-100 fix
  });

  it('returns per-status work counts and blocked %', () => {
    const r = rollupFromNodes(tree());
    expect(r.status_counts).toEqual({
      not_started: 0, in_progress: 1, completed: 3, blocked: 0, plan_ready: 0,
    });
    expect(r.blocked_pct).toBe(0);
  });

  it('handles snake_case rows', () => {
    const r = rollupFromNodes([
      { id: 't', node_type: 'task', parent_id: null, status: 'completed' },
    ]);
    expect(r.progress_pct).toBe(100);
  });

  it('is 0% for an empty / structure-only plan', () => {
    expect(rollupFromNodes([]).progress_pct).toBe(0);
    expect(rollupFromNodes([{ id: 'r', nodeType: 'root', status: 'not_started' }]).total_work).toBe(0);
  });
});

describe('effectiveContainerStatus', () => {
  it('marks a phase completed only when all its work is done', () => {
    const typeOf = (n) => n.nodeType;
    const parentOf = (n) => n.parentId || null;
    const override = effectiveContainerStatus(tree(), typeOf, parentOf);
    expect(override.p1).toBe('completed'); // t1+t2+m1 all done
    expect(override.p2).toBeUndefined();   // t3 in_progress
    expect(override.root).toBeUndefined(); // p2 not done
  });
});

describe('computePlanRollup', () => {
  it('reads nodes via the DAL and omits critical path by default', async () => {
    dal.nodesDal.listByPlan.mockResolvedValue(tree());
    const r = await computePlanRollup('plan-1');
    expect(r.progress_pct).toBe(75);
    expect(r).not.toHaveProperty('critical_path');
    expect(dal.dependenciesDal.getCriticalPath).not.toHaveBeenCalled();
  });

  it('includes a critical-path summary on demand', async () => {
    dal.nodesDal.listByPlan.mockResolvedValue(tree());
    dal.dependenciesDal.getCriticalPath.mockResolvedValue({
      path: ['t3'], total_weight: 2,
      nodes: [{ id: 't3', title: 'T3', status: 'in_progress', node_type: 'task' }],
    });
    const r = await computePlanRollup('plan-1', { withCriticalPath: true });
    expect(r.critical_path).toEqual({
      length: 1, total_weight: 2, nodes: [{ id: 't3', title: 'T3', status: 'in_progress' }],
    });
  });

  it('degrades to null critical path on error', async () => {
    dal.nodesDal.listByPlan.mockResolvedValue(tree());
    dal.dependenciesDal.getCriticalPath.mockRejectedValue(new Error('boom'));
    const r = await computePlanRollup('plan-1', { withCriticalPath: true });
    expect(r.critical_path).toBeNull();
  });
});

describe('computePlanRollups (batch) matches single-plan progress', () => {
  it('derives identical progress from grouped status counts', async () => {
    // The batch path reads pre-aggregated counts; assert the math agrees with
    // the pure core for the same plan (the list==detail guarantee).
    dal.nodesDal.workNodeStatusCountsByPlanIds = jest.fn().mockResolvedValue([
      { plan_id: 'plan-1', total_work: 4, not_started: 0, in_progress: 1, completed: 3, blocked: 0, plan_ready: 0 },
    ]);
    const map = await computePlanRollups(['plan-1']);
    expect(map.get('plan-1').progress_pct).toBe(75);
    expect(map.get('plan-1').progress_pct).toBe(rollupFromNodes(tree()).progress_pct);
  });

  it('returns a 0% rollup for a plan with no work nodes', async () => {
    dal.nodesDal.workNodeStatusCountsByPlanIds = jest.fn().mockResolvedValue([]);
    const map = await computePlanRollups(['empty']);
    expect(map.get('empty')).toMatchObject({ progress_pct: 0, total_work: 0 });
  });
});
