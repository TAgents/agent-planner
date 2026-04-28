/**
 * Unit tests for the tool_calls retention service.
 */

jest.mock('../../../src/db/dal.cjs', () => {
  const toolCallsDal = { purgeOlderThan: jest.fn() };
  return { toolCallsDal };
});
jest.mock('../../../src/utils/logger', () => ({
  api: jest.fn().mockResolvedValue(),
  error: jest.fn().mockResolvedValue(),
}));

const dal = require('../../../src/db/dal.cjs');
const logger = require('../../../src/utils/logger');
const {
  runOnce,
  startRetentionJob,
  DEFAULT_RETENTION_DAYS,
  DEFAULT_INTERVAL_MS,
} = require('../../../src/services/toolCallsRetention');

beforeEach(() => {
  dal.toolCallsDal.purgeOlderThan.mockReset();
  logger.api.mockClear();
  logger.error.mockClear();
  delete process.env.TOOL_CALLS_RETENTION_DAYS;
  delete process.env.TOOL_CALLS_RETENTION_INTERVAL_MS;
  delete process.env.TOOL_CALLS_RETENTION_DISABLED;
});

describe('runOnce', () => {
  test('uses default 90 days when no override', async () => {
    dal.toolCallsDal.purgeOlderThan.mockResolvedValue(7);
    const deleted = await runOnce();
    expect(deleted).toBe(7);
    expect(dal.toolCallsDal.purgeOlderThan).toHaveBeenCalledWith(DEFAULT_RETENTION_DAYS);
  });

  test('respects TOOL_CALLS_RETENTION_DAYS env var', async () => {
    process.env.TOOL_CALLS_RETENTION_DAYS = '30';
    dal.toolCallsDal.purgeOlderThan.mockResolvedValue(0);
    await runOnce();
    expect(dal.toolCallsDal.purgeOlderThan).toHaveBeenCalledWith(30);
  });

  test('overrides argument wins over env', async () => {
    process.env.TOOL_CALLS_RETENTION_DAYS = '30';
    dal.toolCallsDal.purgeOlderThan.mockResolvedValue(0);
    await runOnce({ retentionDays: 5 });
    expect(dal.toolCallsDal.purgeOlderThan).toHaveBeenCalledWith(5);
  });

  test('returns 0 and never throws when DAL fails', async () => {
    dal.toolCallsDal.purgeOlderThan.mockRejectedValue(new Error('boom'));
    await expect(runOnce()).resolves.toBe(0);
    expect(logger.error).toHaveBeenCalled();
  });

  test('only logs when rows were deleted', async () => {
    dal.toolCallsDal.purgeOlderThan.mockResolvedValueOnce(0);
    await runOnce();
    expect(logger.api).not.toHaveBeenCalled();

    dal.toolCallsDal.purgeOlderThan.mockResolvedValueOnce(3);
    await runOnce();
    expect(logger.api).toHaveBeenCalledWith(expect.stringContaining('purged 3'));
  });
});

describe('startRetentionJob', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  test('returns a no-op stop fn when disabled', () => {
    process.env.TOOL_CALLS_RETENTION_DISABLED = 'true';
    const stop = startRetentionJob();
    expect(typeof stop).toBe('function');
    // No timers should have been set
    expect(jest.getTimerCount()).toBe(0);
  });

  test('schedules an initial 60s warm-up + interval', () => {
    dal.toolCallsDal.purgeOlderThan.mockResolvedValue(0);
    const stop = startRetentionJob({ retentionDays: 7, intervalMs: 1000 });
    expect(jest.getTimerCount()).toBeGreaterThanOrEqual(2);
    stop();
    expect(jest.getTimerCount()).toBe(0);
  });

  test('default interval is 24h', () => {
    expect(DEFAULT_INTERVAL_MS).toBe(24 * 60 * 60 * 1000);
  });
});
