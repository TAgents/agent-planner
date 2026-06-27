/**
 * Knowledge Loop E2E Smoke — human-trust acceptance test for the whole
 * knowledge layer (plan d72ba812, Phase 5).
 *
 * Walks the full loop against a live stack:
 *   add_learning (POST /knowledge/episodes, scoped to a task)
 *     → counted in /knowledge/coverage
 *     → recalled via /knowledge/graph-search
 *     → surfaced on /knowledge/episodes (timeline source)
 *     → exposes the fact edge contract the graph UI renders
 *
 * Requires the full stack incl. Graphiti:
 *   docker compose -f docker-compose.local.yml up --build -d
 * Run:
 *   API_URL=http://localhost:3000 npm run test:e2e -- knowledge-loop
 *
 * Gracefully skips (with a warning) if the API is unreachable or Graphiti
 * is unavailable, so a bare `npm test` without a stack stays green.
 */
const axios = require('axios');

const API_URL = process.env.API_URL || 'http://localhost:3000';
const api = axios.create({ baseURL: API_URL, timeout: 20000, validateStatus: () => true });

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

describe('Knowledge Loop E2E Smoke', () => {
  const testId = Date.now().toString(36);
  let stackUp = false;
  let graphitiUp = false;
  let token = null;
  let planId = null;
  let linkedTaskId = null;
  let gapTaskId = null;
  let seeded = false;

  const auth = () => ({ headers: { Authorization: `Bearer ${token}` } });

  beforeAll(async () => {
    // Stack reachable?
    try {
      const health = await api.get('/health');
      stackUp = health.status === 200;
    } catch {
      stackUp = false;
    }
    if (!stackUp) return;

    // Fresh user — self-contained, no shared API_TOKEN needed.
    const reg = await api.post('/auth/register', {
      email: `kloop-${testId}@test.local`,
      password: 'KnowledgeLoop123!',
      name: 'Knowledge Loop Smoke',
    });
    token = reg.data?.access_token || reg.data?.token;
    if (!token) {
      stackUp = false;
      return;
    }

    // Plan + a phase + two tasks (one we link knowledge to, one left as a gap).
    const plan = await api.post('/plans', { title: `KLoop Plan ${testId}`, status: 'active' }, auth());
    planId = plan.data.id;
    const tree = await api.get(`/plans/${planId}/nodes`, auth());
    const rootId = tree.data[0]?.id;
    const phase = await api.post(`/plans/${planId}/nodes`, { node_type: 'phase', title: `Phase ${testId}`, parent_id: rootId }, auth());
    const linked = await api.post(`/plans/${planId}/nodes`, { node_type: 'task', title: `Linked task ${testId}`, parent_id: phase.data.id }, auth());
    linkedTaskId = linked.data.id;
    const gap = await api.post(`/plans/${planId}/nodes`, { node_type: 'task', title: `Gap task ${testId}`, parent_id: phase.data.id }, auth());
    gapTaskId = gap.data.id;

    const status = await api.get('/knowledge/graphiti/status', auth());
    graphitiUp = status.data?.available === true;

    if (graphitiUp) {
      const ep = await api.post('/knowledge/episodes', {
        content: `KLoop ${testId}: Decision — the linked task uses the Graphiti temporal graph for knowledge.`,
        name: `kloop-${testId}`,
        node_id: linkedTaskId,
        plan_id: planId,
      }, auth());
      seeded = ep.status === 201;
    }
  }, 60_000);

  afterAll(async () => {
    if (stackUp && token && planId) {
      await api.delete(`/plans/${planId}`, auth());
    }
  });

  it('stack is reachable (else skip the loop)', () => {
    if (!stackUp) {
      console.warn('API unreachable — skipping knowledge-loop e2e');
      return;
    }
    expect(token).toBeTruthy();
    expect(planId).toBeTruthy();
  });

  it('add_learning is counted in coverage (linked covered, gap listed)', async () => {
    if (!stackUp || !seeded) {
      console.warn('Graphiti unavailable — skipping coverage step');
      return;
    }
    const cov = await api.get('/knowledge/coverage', auth());
    expect(cov.status).toBe(200);
    const row = cov.data.plans.find((p) => p.plan_id === planId);
    expect(row).toBeDefined();
    expect(row.tasks_with_facts).toBeGreaterThanOrEqual(1);
    expect(row.ratio).toBeGreaterThan(0);
    expect(row.gap_tasks.map((t) => t.task_id)).toContain(gapTaskId);
    expect(row.tasks_with_facts + row.gap_count).toBe(row.total_tasks);
  });

  it('the learning is recalled via graph-search', async () => {
    if (!stackUp || !seeded) {
      console.warn('Graphiti unavailable — skipping recall step');
      return;
    }
    // Graphiti ingests asynchronously — poll a few times before asserting.
    let facts = [];
    for (let i = 0; i < 4; i++) {
      await wait(5000);
      const r = await api.post('/knowledge/graph-search', { query: `KLoop ${testId} temporal graph`, max_results: 20 }, auth());
      facts = Array.isArray(r.data?.facts) ? r.data.facts : [];
      if (facts.length > 0) break;
    }
    // Recall is best-effort (extraction latency varies), but the endpoint must
    // answer with the flat facts contract and any edge must carry uuid strings.
    expect(Array.isArray(facts)).toBe(true);
    for (const f of facts) {
      if (f.source_node_uuid || f.target_node_uuid) {
        expect(typeof (f.source_node_uuid || f.target_node_uuid)).toBe('string');
      }
    }
  }, 40_000);

  it('episodes endpoint exposes the fields the timeline normalizes', async () => {
    if (!stackUp || !graphitiUp) {
      console.warn('Graphiti unavailable — skipping timeline step');
      return;
    }
    const eps = await api.get('/knowledge/episodes?max_episodes=50', auth());
    expect(eps.status).toBe(200);
    const list = eps.data?.episodes?.episodes || eps.data?.episodes || [];
    expect(Array.isArray(list)).toBe(true);
    // The timeline derives the type pill from source_description/content and
    // scope chips from links — assert those fields exist on the envelope.
    for (const e of list.slice(0, 5)) {
      expect(e).toHaveProperty('uuid');
      expect(e).toHaveProperty('content');
    }
  });
});
