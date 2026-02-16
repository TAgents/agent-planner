/**
 * Integration tests for OpenClaw / MCP tools
 */
const { getToolDefinitions, executeTool } = require('../../src/mcp/tools');
const { OpenClawAdapter } = require('../../src/adapters/openclaw.adapter');
const { scanMemoryFiles, computeHash } = require('../../src/utils/memorySync');
const fs = require('fs');
const path = require('path');
const os = require('os');

describe('MCP Tool Bridge', () => {
  test('getToolDefinitions returns all tools with required fields', () => {
    const tools = getToolDefinitions();
    expect(tools.length).toBeGreaterThanOrEqual(5);

    for (const tool of tools) {
      expect(tool.name).toBeDefined();
      expect(tool.name).toMatch(/^agentplanner_/);
      expect(tool.description).toBeDefined();
      expect(tool.inputSchema).toBeDefined();
      expect(tool.inputSchema.type).toBe('object');
    }
  });

  test('executeTool returns error for unknown tool', async () => {
    const result = await executeTool('nonexistent_tool', {});
    expect(result.success).toBe(false);
    expect(result.error).toContain('Unknown tool');
  });

  test('tool definitions include expected tools', () => {
    const tools = getToolDefinitions();
    const names = tools.map(t => t.name);
    expect(names).toContain('agentplanner_complete_task');
    expect(names).toContain('agentplanner_update_task');
    expect(names).toContain('agentplanner_evaluate_goal');
    expect(names).toContain('agentplanner_log_knowledge');
    expect(names).toContain('agentplanner_get_plan_status');
  });
});

describe('OpenClaw Adapter', () => {
  test('isConfigured returns false without token', async () => {
    const adapter = new OpenClawAdapter();
    // Ensure no token
    const origToken = process.env.OPENCLAW_API_TOKEN;
    delete process.env.OPENCLAW_API_TOKEN;
    const freshAdapter = new OpenClawAdapter();
    expect(await freshAdapter.isConfigured('any-user')).toBe(false);
    if (origToken) process.env.OPENCLAW_API_TOKEN = origToken;
  });

  test('deliver returns error without token', async () => {
    const adapter = new OpenClawAdapter();
    adapter.apiToken = '';
    const result = await adapter.deliver({ event: 'test', userId: 'u1' });
    expect(result.success).toBe(false);
    expect(result.reason).toContain('not configured');
  });

  test('_buildPrompt generates structured prompt', () => {
    const adapter = new OpenClawAdapter();
    const prompt = adapter._buildPrompt({
      event: 'agent.task.dispatch',
      plan: { id: 'p1', title: 'Test Plan' },
      task: { id: 't1', title: 'Test Task', status: 'in_progress', description: 'Do the thing' },
      goals: [{ title: 'Ship MVP', type: 'outcome', priority: 1 }],
      knowledge: [{ title: 'API docs', content: 'REST endpoints...' }],
    });
    expect(prompt).toContain('Test Plan');
    expect(prompt).toContain('Test Task');
    expect(prompt).toContain('Ship MVP');
    expect(prompt).toContain('API docs');
    expect(prompt).toContain('agentplanner_complete_task');
  });
});

describe('Memory Sync', () => {
  test('computeHash produces consistent SHA-256', () => {
    const h1 = computeHash('hello world');
    const h2 = computeHash('hello world');
    expect(h1).toBe(h2);
    expect(h1).toHaveLength(64);
  });

  test('scanMemoryFiles returns empty for nonexistent dir', () => {
    const files = scanMemoryFiles('/nonexistent/path');
    expect(files).toEqual([]);
  });

  test('scanMemoryFiles finds .md files', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'memsync-'));
    fs.writeFileSync(path.join(tmpDir, 'test.md'), '# Test');
    fs.writeFileSync(path.join(tmpDir, 'ignore.json'), '{}');

    const files = scanMemoryFiles(tmpDir);
    expect(files).toHaveLength(1);
    expect(files[0].name).toBe('test.md');
    expect(files[0].content).toBe('# Test');

    // Cleanup
    fs.rmSync(tmpDir, { recursive: true });
  });
});
