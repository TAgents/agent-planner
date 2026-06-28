/**
 * Unit tests for reasoning.maintainPlanStatus — auto active⇄completed.
 */

jest.mock('../../../src/db/dal.cjs', () => ({
  plansDal: { findById: jest.fn(), update: jest.fn() },
  nodesDal: { listByPlan: jest.fn(), findById: jest.fn() },
  dependenciesDal: { getCriticalPath: jest.fn(), listByNode: jest.fn() },
}));

const dal = require('../../../src/db/dal.cjs');
const { maintainPlanStatus } = require('../../../src/services/reasoning');

const work = (status) => ({ node_type: 'task', status });
beforeEach(() => jest.clearAllMocks());

it('flips an active plan to completed when all work nodes are done', async () => {
  dal.plansDal.findById.mockResolvedValue({ id: 'p1', status: 'active' });
  dal.nodesDal.listByPlan.mockResolvedValue([
    { node_type: 'root', status: 'not_started' }, // structure — ignored
    work('completed'), work('completed'),
  ]);
  const r = await maintainPlanStatus('p1');
  expect(dal.plansDal.update).toHaveBeenCalledWith('p1', { status: 'completed' });
  expect(r).toEqual({ plan_id: 'p1', from: 'active', to: 'completed' });
});

it('reopens a completed plan when work is no longer 100%', async () => {
  dal.plansDal.findById.mockResolvedValue({ id: 'p1', status: 'completed' });
  dal.nodesDal.listByPlan.mockResolvedValue([work('completed'), work('in_progress')]);
  const r = await maintainPlanStatus('p1');
  expect(dal.plansDal.update).toHaveBeenCalledWith('p1', { status: 'active' });
  expect(r).toEqual({ plan_id: 'p1', from: 'completed', to: 'active' });
});

it('does NOT complete a plan with zero work nodes (structure only)', async () => {
  dal.plansDal.findById.mockResolvedValue({ id: 'p1', status: 'active' });
  dal.nodesDal.listByPlan.mockResolvedValue([{ node_type: 'phase', status: 'not_started' }]);
  const r = await maintainPlanStatus('p1');
  expect(dal.plansDal.update).not.toHaveBeenCalled();
  expect(r).toBeNull();
});

it('leaves draft and archived plans untouched', async () => {
  for (const status of ['draft', 'archived']) {
    jest.clearAllMocks();
    dal.plansDal.findById.mockResolvedValue({ id: 'p1', status });
    dal.nodesDal.listByPlan.mockResolvedValue([work('completed')]);
    const r = await maintainPlanStatus('p1');
    expect(dal.plansDal.update).not.toHaveBeenCalled();
    expect(r).toBeNull();
  }
});

it('is idempotent: a completed plan still at 100% is not re-written', async () => {
  dal.plansDal.findById.mockResolvedValue({ id: 'p1', status: 'completed' });
  dal.nodesDal.listByPlan.mockResolvedValue([work('completed')]);
  const r = await maintainPlanStatus('p1');
  expect(dal.plansDal.update).not.toHaveBeenCalled();
  expect(r).toBeNull();
});

it('returns null for a missing plan or missing id', async () => {
  expect(await maintainPlanStatus(null)).toBeNull();
  dal.plansDal.findById.mockResolvedValue(null);
  expect(await maintainPlanStatus('nope')).toBeNull();
});
