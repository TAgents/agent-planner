/**
 * Unit tests for tool-call telemetry middleware.
 */

const EventEmitter = require('events');

jest.mock('../../../src/db/dal.cjs', () => {
  const toolCallsDal = { record: jest.fn().mockResolvedValue({ id: 'rec-1' }) };
  return { toolCallsDal };
});

const dal = require('../../../src/db/dal.cjs');
const {
  recordToolCall,
  inferClientLabel,
  buildToolName,
} = require('../../../src/middleware/toolCallTelemetry.middleware');

function makeRes() {
  const ee = new EventEmitter();
  ee.statusCode = 200;
  return ee;
}

beforeEach(() => {
  dal.toolCallsDal.record.mockClear();
});

describe('inferClientLabel', () => {
  test.each([
    ['claude-code/0.1.0', 'Claude Code'],
    ['Claude Desktop 0.6.4 (macOS)', 'Claude Desktop'],
    ['Claude/1.0', 'Claude'],
    ['Cursor/0.42.0', 'Cursor'],
    ['ChatGPT-User/2.0', 'ChatGPT'],
    ['OpenAI-User-Agent', 'ChatGPT'],
    ['OpenClaw-MCP/1.2', 'OpenClaw'],
    ['mcp-client/x', 'MCP Client'],
    ['curl/8.0.0', null],
    [null, null],
    ['', null],
  ])('%s → %s', (ua, expected) => {
    expect(inferClientLabel(ua)).toBe(expected);
  });
});

describe('buildToolName', () => {
  test('uses matched route pattern when available', () => {
    const req = { method: 'GET', route: { path: '/:id' }, baseUrl: '/plans' };
    expect(buildToolName(req)).toBe('GET /plans/:id');
  });

  test('falls back to originalUrl when route is unset', () => {
    const req = { method: 'POST', originalUrl: '/api/widgets/123?foo=bar' };
    expect(buildToolName(req)).toBe('POST /api/widgets/123');
  });

  test('omits trailing slash on root patterns', () => {
    const req = { method: 'GET', route: { path: '/' }, baseUrl: '/plans' };
    expect(buildToolName(req)).toBe('GET /plans');
  });
});

describe('recordToolCall middleware', () => {
  test('records a row on res.finish for authenticated requests', () => {
    const req = {
      method: 'GET',
      originalUrl: '/plans/abc',
      route: { path: '/:id' },
      baseUrl: '/plans',
      headers: {
        'user-agent': 'claude-code/0.1.0',
        'x-forwarded-for': '203.0.113.7, 10.0.0.1',
      },
      user: { tokenId: 't-1', organizationId: 'org-1' },
    };
    const res = makeRes();
    res.statusCode = 201;
    const next = jest.fn();

    recordToolCall(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(dal.toolCallsDal.record).not.toHaveBeenCalled();

    res.emit('finish');

    expect(dal.toolCallsDal.record).toHaveBeenCalledTimes(1);
    const arg = dal.toolCallsDal.record.mock.calls[0][0];
    expect(arg).toMatchObject({
      tokenId: 't-1',
      organizationId: 'org-1',
      toolName: 'GET /plans/:id',
      clientLabel: 'Claude Code',
      userAgent: 'claude-code/0.1.0',
      ip: '203.0.113.7',
      responseStatus: 201,
    });
    expect(typeof arg.durationMs).toBe('number');
  });

  test('skips telemetry when req.user is not set', () => {
    const req = {
      method: 'GET',
      originalUrl: '/health',
      headers: {},
    };
    const res = makeRes();
    const next = jest.fn();

    recordToolCall(req, res, next);
    res.emit('finish');

    expect(next).toHaveBeenCalled();
    expect(dal.toolCallsDal.record).not.toHaveBeenCalled();
  });

  test('prefers explicit x-client-label header over UA inference', () => {
    const req = {
      method: 'GET',
      originalUrl: '/plans',
      headers: {
        'user-agent': 'curl/8.0.0',
        'x-client-label': 'My Custom Bot',
      },
      user: { tokenId: 't-2', organizationId: 'org-2' },
    };
    const res = makeRes();
    recordToolCall(req, res, jest.fn());
    res.emit('finish');

    expect(dal.toolCallsDal.record.mock.calls[0][0].clientLabel).toBe('My Custom Bot');
  });
});
