/**
 * Integration tests for memory sync.
 *
 * The MCP Tool Bridge tests were removed with src/mcp/tools.js and the
 * /v2/agent routes (API v1 consolidation Phase 5) — agents talk to the API
 * through agent-planner-mcp, not the in-process tool shim.
 */
const { scanMemoryFiles, computeHash } = require('../../src/utils/memorySync');
const fs = require('fs');
const path = require('path');
const os = require('os');

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
