/**
 * Unit tests for reasoning.js — parent auto-completion
 */

jest.mock('../../../src/db/dal.cjs', () => ({
  nodesDal: {
    findById: jest.fn(),
    getChildren: jest.fn(),
    update: jest.fn(),
  },
  dependenciesDal: {
    listByNode: jest.fn().mockResolvedValue([]),
  },
}));

const dal = require('../../../src/db/dal.cjs');
const { propagateStatus } = require('../../../src/services/reasoning');

beforeEach(() => jest.clearAllMocks());

describe('propagateStatus — parent auto-completion', () => {
  it('should complete parent when all children are completed', async () => {
    // Node being completed
    dal.nodesDal.findById.mockImplementation(async (id) => {
      if (id === 'task-3') return { id: 'task-3', parentId: 'phase-1', status: 'completed', nodeType: 'task' };
      if (id === 'phase-1') return { id: 'phase-1', parentId: 'root-1', status: 'not_started', nodeType: 'phase' };
      if (id === 'root-1') return { id: 'root-1', parentId: null, status: 'not_started', nodeType: 'root' };
      return null;
    });

    // All siblings completed
    dal.nodesDal.getChildren.mockImplementation(async (parentId) => {
      if (parentId === 'phase-1') return [
        { id: 'task-1', status: 'completed' },
        { id: 'task-2', status: 'completed' },
        { id: 'task-3', status: 'completed' },
      ];
      return [];
    });

    dal.nodesDal.update.mockResolvedValue({});

    const effects = await propagateStatus('task-3', 'completed');

    expect(dal.nodesDal.update).toHaveBeenCalledWith('phase-1', { status: 'completed' });
    expect(effects.unblocked).toContainEqual(expect.objectContaining({
      node_id: 'phase-1',
      new_status: 'completed',
      reason: 'all_children_completed',
    }));
  });

  it('should NOT complete parent when some children are not done', async () => {
    dal.nodesDal.findById.mockImplementation(async (id) => {
      if (id === 'task-1') return { id: 'task-1', parentId: 'phase-1', status: 'completed', nodeType: 'task' };
      return null;
    });

    dal.nodesDal.getChildren.mockResolvedValue([
      { id: 'task-1', status: 'completed' },
      { id: 'task-2', status: 'not_started' },
    ]);

    const effects = await propagateStatus('task-1', 'completed');

    expect(dal.nodesDal.update).not.toHaveBeenCalled();
    expect(effects.unblocked).toHaveLength(0);
  });

  it('should NOT complete root nodes', async () => {
    dal.nodesDal.findById.mockImplementation(async (id) => {
      if (id === 'phase-1') return { id: 'phase-1', parentId: 'root-1', status: 'completed', nodeType: 'phase' };
      if (id === 'root-1') return { id: 'root-1', parentId: null, status: 'not_started', nodeType: 'root' };
      return null;
    });

    dal.nodesDal.getChildren.mockResolvedValue([
      { id: 'phase-1', status: 'completed' },
    ]);

    const effects = await propagateStatus('phase-1', 'completed');

    // Should not update root node
    expect(dal.nodesDal.update).not.toHaveBeenCalledWith('root-1', expect.anything());
  });
});
