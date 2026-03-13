/**
 * Integration tests for Graphiti Knowledge Graph endpoints.
 *
 * Requires a running stack: postgres, falkordb, graphiti, api.
 * Run with: npx jest tests/integration/graphiti.test.js
 *
 * These tests hit the real API and Graphiti MCP server.
 * They are safe to re-run — each test uses unique names.
 */

const API_URL = process.env.API_URL || 'http://localhost:3000';
const API_TOKEN = process.env.API_TOKEN || '';

// Skip if no token configured
const describeIfToken = API_TOKEN ? describe : describe.skip;

function headers(extra = {}) {
  return {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${API_TOKEN}`,
    ...extra,
  };
}

async function api(path, opts = {}) {
  const { method = 'GET', body } = opts;
  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers: headers(),
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => null);
  return { status: res.status, data };
}

describeIfToken('Graphiti Knowledge Graph Integration', () => {
  const testId = Date.now().toString(36);

  // ─── Health & Status ─────────────────────────────────────
  describe('Status', () => {
    it('GET /knowledge/graphiti/status returns availability', async () => {
      const { status, data } = await api('/knowledge/graphiti/status');
      expect(status).toBe(200);
      expect(data).toHaveProperty('available');
      // If Graphiti is running, it should be available
      if (data.available) {
        expect(data.status).toHaveProperty('status', 'healthy');
      }
    });
  });

  // ─── Episode Lifecycle ───────────────────────────────────
  describe('Episodes', () => {
    let episodeGroupId;

    it('POST /knowledge/episodes creates an episode', async () => {
      const { status, data } = await api('/knowledge/episodes', {
        method: 'POST',
        body: {
          content: `Integration test fact ${testId}: Jest tests can verify Graphiti episode ingestion end-to-end.`,
          name: `test-episode-${testId}`,
        },
      });
      expect(status).toBe(201);
      expect(data).toHaveProperty('episode');
      expect(data).toHaveProperty('group_id');
      episodeGroupId = data.group_id;
    });

    it('POST /knowledge/episodes validates content is required', async () => {
      const { status, data } = await api('/knowledge/episodes', {
        method: 'POST',
        body: { name: 'no-content' },
      });
      expect(status).toBe(400);
      expect(data.error).toMatch(/content/i);
    });
  });

  // ─── Search (after episode ingestion) ────────────────────
  describe('Search', () => {
    // Give Graphiti time to process the episode
    beforeAll(async () => {
      await new Promise(r => setTimeout(r, 10_000));
    }, 15_000);

    it('POST /knowledge/graph-search returns facts', async () => {
      const { status, data } = await api('/knowledge/graph-search', {
        method: 'POST',
        body: { query: `integration test ${testId}`, max_results: 5 },
      });
      expect(status).toBe(200);
      expect(data).toHaveProperty('results');
      expect(data).toHaveProperty('method', 'graphiti');
    });

    it('POST /knowledge/graph-search validates query is required', async () => {
      const { status, data } = await api('/knowledge/graph-search', {
        method: 'POST',
        body: {},
      });
      expect(status).toBe(400);
      expect(data.error).toMatch(/query/i);
    });
  });

  // ─── Entity Search ───────────────────────────────────────
  describe('Entities', () => {
    it('POST /knowledge/entities returns entity nodes', async () => {
      const { status, data } = await api('/knowledge/entities', {
        method: 'POST',
        body: { query: 'Jest', max_results: 5 },
      });
      expect(status).toBe(200);
      expect(data).toHaveProperty('entities');
      expect(data).toHaveProperty('group_id');
    });

    it('POST /knowledge/entities validates query is required', async () => {
      const { status, data } = await api('/knowledge/entities', {
        method: 'POST',
        body: {},
      });
      expect(status).toBe(400);
      expect(data.error).toMatch(/query/i);
    });
  });

  // ─── Auth ────────────────────────────────────────────────
  describe('Authentication', () => {
    it('rejects requests without auth token', async () => {
      const res = await fetch(`${API_URL}/knowledge/graphiti/status`);
      expect(res.status).toBe(401);
    });
  });
});
