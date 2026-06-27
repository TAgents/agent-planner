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
      // The route returns a FLAT { facts, group_id, method } envelope. (It
      // previously nested under `results`; this guards against a regression
      // back to the nested shape the UI no longer expects.)
      expect(data).toHaveProperty('facts');
      expect(Array.isArray(data.facts)).toBe(true);
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

  // ─── Coverage & Knowledge Links (Phases 2–3 regression guards) ───
  // Seeds episodes scoped to plan nodes, then asserts the structured
  // episode_node_links-based coverage endpoint reflects them. The link is
  // created SYNCHRONOUSLY in POST /episodes (with a `pending:` correlation
  // id), so /knowledge/coverage — which queries links by NODE id — is
  // accurate immediately, with no wait for Graphiti's async ingestion.
  //
  // Not covered here (documented limitations): GET /episodes attaches links
  // by matching Graphiti's real episode UUID, which a `pending:` id won't
  // match until a reconciliation backfill runs — so episode-level cross-plan
  // attribution and contradiction ('contradicts' links are written only by
  // the coherence engine, not this endpoint) need the full pipeline and are
  // exercised by the e2e smoke task instead.
  describe('Coverage & Links', () => {
    let covPlanId, taskLinked, taskGapA, taskGapB;
    let secondPlanId, secondTaskId;
    let graphitiUp = false;
    let seeded = false;

    beforeAll(async () => {
      const { data: st } = await api('/knowledge/graphiti/status');
      graphitiUp = !!st?.available;

      const mkTask = async (planId, parentId, title) =>
        (await api(`/plans/${planId}/nodes`, {
          method: 'POST',
          body: { node_type: 'task', title, parent_id: parentId },
        })).data.id;

      // Plan A: 3 incomplete tasks, one of which we link knowledge to.
      const { data: planA } = await api('/plans', {
        method: 'POST',
        body: { title: `Coverage Plan ${testId}`, description: 'coverage regression', status: 'active' },
      });
      covPlanId = planA.id;
      const { data: treeA } = await api(`/plans/${covPlanId}/nodes`);
      const rootA = treeA[0]?.id;
      const { data: phaseA } = await api(`/plans/${covPlanId}/nodes`, {
        method: 'POST',
        body: { node_type: 'phase', title: `Phase ${testId}`, parent_id: rootA },
      });
      taskLinked = await mkTask(covPlanId, phaseA.id, `Linked task ${testId}`);
      taskGapA = await mkTask(covPlanId, phaseA.id, `Gap task A ${testId}`);
      taskGapB = await mkTask(covPlanId, phaseA.id, `Gap task B ${testId}`);

      // Plan B: a single task to confirm coverage is computed per-plan.
      const { data: planB } = await api('/plans', {
        method: 'POST',
        body: { title: `Coverage Plan 2 ${testId}`, status: 'active' },
      });
      secondPlanId = planB.id;
      const { data: treeB } = await api(`/plans/${secondPlanId}/nodes`);
      secondTaskId = await mkTask(secondPlanId, treeB[0]?.id, `P2 task ${testId}`);

      // Seed one knowledge episode against the linked task (needs Graphiti up,
      // since POST /episodes 503s otherwise — the link is created synchronously).
      if (graphitiUp) {
        const r1 = await api('/knowledge/episodes', {
          method: 'POST',
          body: {
            content: `Coverage seed ${testId}: the linked task has supporting knowledge.`,
            name: `cov-${testId}`,
            node_id: taskLinked,
            plan_id: covPlanId,
          },
        });
        seeded = r1.status === 201;
      }
    }, 30_000);

    afterAll(async () => {
      if (covPlanId) await api(`/plans/${covPlanId}`, { method: 'DELETE' });
      if (secondPlanId) await api(`/plans/${secondPlanId}`, { method: 'DELETE' });
    });

    it('GET /knowledge/coverage returns a well-formed org_summary + plan rows', async () => {
      const { status, data } = await api('/knowledge/coverage');
      expect(status).toBe(200);
      expect(data.org_summary).toBeDefined();
      const { total_tasks, tasks_with_facts, ratio } = data.org_summary;
      expect(typeof total_tasks).toBe('number');
      expect(tasks_with_facts).toBeLessThanOrEqual(total_tasks);
      expect(ratio).toBeGreaterThanOrEqual(0);
      expect(ratio).toBeLessThanOrEqual(1);
      // Every plan row carries the actionable arrays and the gap math holds.
      for (const p of data.plans) {
        expect(Array.isArray(p.gap_tasks)).toBe(true);
        expect(Array.isArray(p.stale_tasks)).toBe(true);
        expect(Array.isArray(p.conflict_tasks)).toBe(true);
        expect(typeof p.gap_count).toBe('number');
        expect(p.tasks_with_facts + p.gap_count).toBe(p.total_tasks);
      }
    });

    it('counts a knowledge-linked task as covered and the rest as gaps', async () => {
      if (!seeded) {
        console.warn('Graphiti unavailable — skipping coverage-link assertion');
        return;
      }
      const { data } = await api('/knowledge/coverage');
      const row = data.plans.find((p) => p.plan_id === covPlanId);
      expect(row).toBeDefined();
      expect(row.total_tasks).toBe(3);
      expect(row.tasks_with_facts).toBeGreaterThanOrEqual(1);
      expect(row.ratio).toBeGreaterThan(0);
      // The linked task is NOT a gap; the two unlinked tasks ARE.
      const gapIds = row.gap_tasks.map((t) => t.task_id);
      expect(gapIds).not.toContain(taskLinked);
      expect(gapIds).toEqual(expect.arrayContaining([taskGapA, taskGapB]));
      expect(row.gap_count).toBe(row.total_tasks - row.tasks_with_facts);
    });

    it('exposes the fact edge contract (source/target uuids) on graph-search', async () => {
      if (!graphitiUp) {
        console.warn('Graphiti unavailable — skipping edge contract assertion');
        return;
      }
      // Give Graphiti a moment to process the seeded episode into facts.
      await new Promise((r) => setTimeout(r, 8_000));
      const { status, data } = await api('/knowledge/graph-search', {
        method: 'POST',
        body: { query: `Coverage seed ${testId}`, max_results: 20 },
      });
      expect(status).toBe(200);
      const facts = Array.isArray(data.facts) ? data.facts : data.results?.facts || [];
      // Edges are optional (entities may not be linked yet), but when a fact
      // connects two entities it MUST expose the uuid fields the graph UI
      // builds edges from — that contract is what the Graph render depends on.
      for (const f of facts) {
        expect(f).toHaveProperty('uuid');
        if (f.source_node_uuid || f.target_node_uuid) {
          expect(typeof (f.source_node_uuid || f.target_node_uuid)).toBe('string');
        }
      }
    }, 15_000);
  });

  // ─── Auth ────────────────────────────────────────────────
  describe('Authentication', () => {
    it('rejects requests without auth token', async () => {
      const res = await fetch(`${API_URL}/knowledge/graphiti/status`);
      expect(res.status).toBe(401);
    });
  });
});
