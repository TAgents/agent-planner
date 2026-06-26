const { classifyGoalHealth } = require('../../../src/utils/goalHealth');

const NOW = new Date('2026-06-26T12:00:00Z').getTime();
const fresh = NOW - 60 * 1000; // 1 min ago
const old = NOW - 5 * 24 * 60 * 60 * 1000; // 5 days ago

describe('classifyGoalHealth — single source of truth for briefing + dashboard', () => {
  it('no execution path (no plans/nodes) → stale, NOT on_track', () => {
    // The exact bug: the dashboard called these on_track while the briefing
    // called them stale. A goal nobody has planned needs attention.
    expect(classifyGoalHealth({ hasLinkedPlans: false, totalNodes: 0, lastActivityTs: null, now: NOW })).toBe('stale');
    // Linked plan exists but it has zero task/milestone nodes → still no path.
    expect(classifyGoalHealth({ hasLinkedPlans: true, totalNodes: 0, lastActivityTs: fresh, now: NOW })).toBe('stale');
  });

  it('has a path but no recent activity → stale', () => {
    expect(classifyGoalHealth({ hasLinkedPlans: true, totalNodes: 5, lastActivityTs: old, now: NOW })).toBe('stale');
  });

  it('fresh path with a bottleneck / heavy block / stale pending → at_risk', () => {
    expect(classifyGoalHealth({ hasLinkedPlans: true, totalNodes: 5, lastActivityTs: fresh, bottleneckCount: 1, now: NOW })).toBe('at_risk');
    expect(classifyGoalHealth({ hasLinkedPlans: true, totalNodes: 5, lastActivityTs: fresh, percentBlocked: 40, now: NOW })).toBe('at_risk');
    expect(classifyGoalHealth({ hasLinkedPlans: true, totalNodes: 5, lastActivityTs: fresh, stalePendingCount: 2, now: NOW })).toBe('at_risk');
  });

  it('fresh path, no trouble signals → on_track', () => {
    expect(classifyGoalHealth({ hasLinkedPlans: true, totalNodes: 5, lastActivityTs: fresh, now: NOW })).toBe('on_track');
  });

  it('percentBlocked exactly at the 30% threshold is not yet at_risk', () => {
    expect(classifyGoalHealth({ hasLinkedPlans: true, totalNodes: 10, lastActivityTs: fresh, percentBlocked: 30, now: NOW })).toBe('on_track');
  });
});
