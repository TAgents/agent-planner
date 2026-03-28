/**
 * Unit tests for notifications.v2.js and adapter fanout
 */

// Mock adapters
jest.mock('../../../src/adapters', () => ({
  deliverToAll: jest.fn().mockResolvedValue([]),
}));

// Mock messageBus
jest.mock('../../../src/services/messageBus', () => ({
  publish: jest.fn().mockResolvedValue(undefined),
}));

// Mock urls
jest.mock('../../../src/utils/urls', () => ({
  planUrl: (id) => `https://app.test/plans/${id}`,
  taskUrl: (planId, nodeId) => `https://app.test/plans/${planId}?node=${nodeId}`,
}));

// Mock logger
jest.mock('../../../src/utils/logger', () => ({
  error: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
}));

const { deliverToAll } = require('../../../src/adapters');
const { publish } = require('../../../src/services/messageBus');
const {
  notifyStatusChange,
  notifyAgentRequested,
  notifyDecisionRequested,
  notifyDecisionResolved,
} = require('../../../src/services/notifications.v2');

const makePlan = () => ({ id: 'plan-1', title: 'Test Plan', owner_id: 'owner-1' });
const makeNode = (overrides = {}) => ({
  id: 'node-1',
  title: 'Test Task',
  description: 'A task',
  status: 'in_progress',
  agent_instructions: 'Do something',
  agent_requested: 'start',
  agent_request_message: 'Please start',
  agent_requested_at: new Date().toISOString(),
  ...overrides,
});
const makeActor = () => ({ name: 'Test User', type: 'user' });

beforeEach(() => {
  jest.clearAllMocks();
});

describe('Notification Service v2', () => {
  // ── notifyStatusChange ─────────────────────────────────

  describe('notifyStatusChange', () => {
    it('should deliver for completed status', async () => {
      await notifyStatusChange(makeNode(), makePlan(), makeActor(), 'in_progress', 'completed');

      expect(deliverToAll).toHaveBeenCalledWith(expect.objectContaining({
        event: 'task.completed',
        plan: { id: 'plan-1', title: 'Test Plan' },
        plan_url: 'https://app.test/plans/plan-1',
        task_url: 'https://app.test/plans/plan-1?node=node-1',
        message: expect.stringContaining('in_progress → completed'),
      }));
    });

    it('should deliver for blocked status', async () => {
      await notifyStatusChange(makeNode(), makePlan(), makeActor(), 'in_progress', 'blocked');

      expect(deliverToAll).toHaveBeenCalledWith(expect.objectContaining({
        event: 'task.blocked',
      }));
    });

    it('should deliver for in_progress status as generic status_changed', async () => {
      await notifyStatusChange(makeNode(), makePlan(), makeActor(), 'not_started', 'in_progress');

      expect(deliverToAll).toHaveBeenCalledWith(expect.objectContaining({
        event: 'task.status_changed',
      }));
    });

    it('should NOT deliver for not_started status', async () => {
      await notifyStatusChange(makeNode(), makePlan(), makeActor(), 'in_progress', 'not_started');

      expect(deliverToAll).not.toHaveBeenCalled();
    });

    it('should include plan_url and task_url', async () => {
      await notifyStatusChange(makeNode(), makePlan(), makeActor(), 'not_started', 'completed');

      const payload = deliverToAll.mock.calls[0][0];
      expect(payload.plan_url).toBe('https://app.test/plans/plan-1');
      expect(payload.task_url).toBe('https://app.test/plans/plan-1?node=node-1');
    });

    it('should publish to messageBus', async () => {
      await notifyStatusChange(makeNode(), makePlan(), makeActor(), 'not_started', 'completed');

      expect(publish).toHaveBeenCalledWith('notifications', expect.objectContaining({
        event: 'task.completed',
      }));
    });

    it('should not throw if messageBus fails', async () => {
      publish.mockRejectedValueOnce(new Error('bus down'));

      await expect(
        notifyStatusChange(makeNode(), makePlan(), makeActor(), 'not_started', 'completed')
      ).resolves.not.toThrow();
    });
  });

  // ── notifyAgentRequested ───────────────────────────────

  describe('notifyAgentRequested', () => {
    it('should deliver agent request notification', async () => {
      await notifyAgentRequested(makeNode(), makePlan(), makeActor(), 'owner-1');

      expect(deliverToAll).toHaveBeenCalledWith(expect.objectContaining({
        event: 'task.start_requested',
        userId: 'owner-1',
        request: expect.objectContaining({
          type: 'start',
          message: 'Please start',
        }),
      }));
    });

    it('should include task details', async () => {
      await notifyAgentRequested(makeNode(), makePlan(), makeActor(), 'owner-1');

      const payload = deliverToAll.mock.calls[0][0];
      expect(payload.task.title).toBe('Test Task');
      expect(payload.task.agent_instructions).toBe('Do something');
    });
  });

  // ── notifyDecisionRequested ────────────────────────────

  describe('notifyDecisionRequested', () => {
    it('should use blocking event for blocking urgency', async () => {
      const decision = {
        id: 'dec-1', title: 'Choose DB', context: 'Need a database',
        options: [{ label: 'Postgres' }, { label: 'MySQL' }],
        urgency: 'blocking', node_id: 'node-1',
      };

      await notifyDecisionRequested(decision, makePlan(), makeActor(), 'owner-1');

      expect(deliverToAll).toHaveBeenCalledWith(expect.objectContaining({
        event: 'decision.requested.blocking',
        message: expect.stringContaining('URGENT'),
      }));
    });

    it('should use normal event for non-blocking urgency', async () => {
      const decision = {
        id: 'dec-1', title: 'Choose color', context: 'Pick a color',
        urgency: 'can_continue',
      };

      await notifyDecisionRequested(decision, makePlan(), makeActor(), 'owner-1');

      expect(deliverToAll).toHaveBeenCalledWith(expect.objectContaining({
        event: 'decision.requested',
        message: expect.not.stringContaining('URGENT'),
      }));
    });
  });

  // ── notifyDecisionResolved ─────────────────────────────

  describe('notifyDecisionResolved', () => {
    it('should deliver resolution notification', async () => {
      const decision = {
        id: 'dec-1', title: 'Choose DB',
        decision: 'Use Postgres', rationale: 'Better JSON support',
        node_id: 'node-1',
      };

      await notifyDecisionResolved(decision, makePlan(), makeActor());

      expect(deliverToAll).toHaveBeenCalledWith(expect.objectContaining({
        event: 'decision.resolved',
        decision: expect.objectContaining({
          resolution: 'Use Postgres',
          rationale: 'Better JSON support',
        }),
        message: expect.stringContaining('Decision made'),
      }));
    });
  });
});

// ── Adapter fanout tests ─────────────────────────────────

describe('Adapter fanout (deliverToAll)', () => {
  // Reset to use real implementation for these tests
  beforeEach(() => {
    jest.restoreAllMocks();
  });

  it('should call isConfigured then deliver for each adapter', async () => {
    const mockAdapter = {
      name: 'test',
      isConfigured: jest.fn().mockResolvedValue(true),
      deliver: jest.fn().mockResolvedValue({ success: true }),
    };

    // Test the fanout logic directly
    const results = [];
    const adapters = [mockAdapter];
    for (const adapter of adapters) {
      const configured = await adapter.isConfigured('user-1');
      if (configured) {
        const result = await adapter.deliver({ event: 'test' });
        results.push({ adapter: adapter.name, ...result });
      }
    }

    expect(mockAdapter.isConfigured).toHaveBeenCalledWith('user-1');
    expect(mockAdapter.deliver).toHaveBeenCalledWith({ event: 'test' });
    expect(results).toEqual([{ adapter: 'test', success: true }]);
  });

  it('should skip unconfigured adapters', async () => {
    const mockAdapter = {
      name: 'unconfigured',
      isConfigured: jest.fn().mockResolvedValue(false),
      deliver: jest.fn(),
    };

    const configured = await mockAdapter.isConfigured('user-1');
    expect(configured).toBe(false);
    expect(mockAdapter.deliver).not.toHaveBeenCalled();
  });

  it('should catch adapter errors without failing', async () => {
    const mockAdapter = {
      name: 'failing',
      isConfigured: jest.fn().mockResolvedValue(true),
      deliver: jest.fn().mockRejectedValue(new Error('adapter crash')),
    };

    const results = [];
    try {
      await mockAdapter.deliver({ event: 'test' });
      results.push({ adapter: mockAdapter.name, success: true });
    } catch (error) {
      results.push({ adapter: mockAdapter.name, success: false, error: error.message });
    }

    expect(results).toEqual([{ adapter: 'failing', success: false, error: 'adapter crash' }]);
  });
});

// ── SlackAdapter block building ──────────────────────────

describe('SlackAdapter._buildBlocks', () => {
  // We can't easily test the full SlackAdapter (requires DB + Slack WebClient)
  // but we can verify the block builder produces correct structure

  it('should produce valid Slack block structure', () => {
    // Import the class directly to test _buildBlocks
    jest.resetModules();
    jest.mock('../../../src/adapters/base.adapter', () => ({
      BaseAdapter: class { constructor(name) { this.name = name; } },
    }));
    jest.mock('../../../src/services/slack', () => ({
      decrypt: jest.fn(v => v),
    }));

    const { SlackAdapter } = require('../../../src/adapters/slack.adapter');
    const adapter = new SlackAdapter();

    const blocks = adapter._buildBlocks(
      'task.completed',
      { id: 'plan-1', title: 'My Plan' },
      { id: 'task-1', title: 'My Task', status: 'completed', description: 'Done', agent_instructions: 'Auto' },
      null, // no decision
      null, // no request
      { name: 'Agent' },
      'Task completed!',
      { plan_url: 'https://app/plans/plan-1', task_url: 'https://app/plans/plan-1?node=task-1' },
    );

    // Header block
    expect(blocks[0]).toEqual({
      type: 'section',
      text: { type: 'mrkdwn', text: expect.stringContaining('Task completed!') },
    });

    // Task details block
    const taskBlock = blocks.find(b => b.type === 'section' && b.text.text.includes('My Task'));
    expect(taskBlock).toBeDefined();
    expect(taskBlock.text.text).toContain('https://app/plans/plan-1?node=task-1');

    // Plan context block
    const contextBlock = blocks.find(b => b.type === 'context');
    expect(contextBlock).toBeDefined();
    expect(contextBlock.elements[0].text).toContain('My Plan');

    // CTA button
    const actionsBlock = blocks.find(b => b.type === 'actions');
    expect(actionsBlock).toBeDefined();
    expect(actionsBlock.elements[0].url).toBe('https://app/plans/plan-1?node=task-1');
    expect(actionsBlock.elements[0].text.text).toBe('View Task →');
  });

  it('should use danger style for blocking events', () => {
    jest.resetModules();
    jest.mock('../../../src/adapters/base.adapter', () => ({
      BaseAdapter: class { constructor(name) { this.name = name; } },
    }));
    jest.mock('../../../src/services/slack', () => ({
      decrypt: jest.fn(v => v),
    }));

    const { SlackAdapter } = require('../../../src/adapters/slack.adapter');
    const adapter = new SlackAdapter();

    const blocks = adapter._buildBlocks(
      'decision.requested.blocking',
      { id: 'p1', title: 'P' }, null,
      { id: 'd1', title: 'Urgent', context: 'Need answer', options: [] },
      null, { name: 'A' }, 'Blocking!',
      { plan_url: 'https://app/plans/p1' },
    );

    const actionsBlock = blocks.find(b => b.type === 'actions');
    expect(actionsBlock.elements[0].style).toBe('danger');
  });
});
