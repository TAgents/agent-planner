/**
 * E2E: Dep-aware claim flow + fail-closed contract.
 *
 * Block 1 — Happy path: create an RPI chain, then walk Research → Plan → Implement,
 *   asserting at each level that /context/suggest and /agent/work-sessions
 *   (dry_run and live) return the correct dep-ready node.
 *
 * Block 2 — Fail-closed: with Research claimed and in_progress (no completion),
 *   Plan and Implement are dep-blocked. Suggest must be empty; starting a session
 *   must 404 with reason='blocked_on_dep'.
 *
 * Requires: API running on API_URL (default http://localhost:3000)
 * Run: API_URL=http://localhost:3000 npm run test:e2e
 */
const axios = require('axios');

const API_URL = process.env.API_URL || 'http://localhost:3000';
const api = axios.create({
  baseURL: API_URL,
  timeout: 10000,
  // Don't throw on 4xx — we need to assert on error response bodies.
  validateStatus: () => true,
});

const auth = (token) => ({ headers: { Authorization: `Bearer ${token}` } });

async function setupChainPlan(label) {
  const testEmail = `e2e-failclosed-${label}-${Date.now()}@test.local`;
  const reg = await api.post('/auth/register', {
    email: testEmail,
    password: 'TestPass123!',
    name: `E2E ${label}`,
  });
  if (reg.status !== 201) throw new Error(`register failed: ${reg.status} ${JSON.stringify(reg.data)}`);
  const token = reg.data.session?.access_token || reg.data.access_token || reg.data.token;
  if (!token) throw new Error(`no token in register response: ${JSON.stringify(reg.data)}`);

  const plan = await api.post(
    '/plans',
    { title: `E2E fail-closed ${label}`, description: 'dep-aware claim flow', status: 'active' },
    auth(token),
  );
  if (plan.status !== 201) throw new Error(`plan create failed: ${plan.status} ${JSON.stringify(plan.data)}`);
  const planId = plan.data.id;

  const nodes = await api.get(`/plans/${planId}/nodes?include_root=true`, auth(token));
  const flat = [];
  const flatten = (ns) => {
    for (const n of ns) {
      flat.push(n);
      if (n.children) flatten(n.children);
    }
  };
  flatten(nodes.data);
  const root = flat.find((n) => n.node_type === 'root');
  if (!root) throw new Error('root node not found');

  const chainRes = await api.post(
    `/plans/${planId}/nodes/rpi-chain`,
    { title: `RPI ${label}`, description: 'Research → Plan → Implement', parent_id: root.id },
    auth(token),
  );
  if (chainRes.status !== 201) {
    throw new Error(`rpi-chain create failed: ${chainRes.status} ${JSON.stringify(chainRes.data)}`);
  }
  return { token, planId, chain: chainRes.data.chain };
}

async function suggestOne(token, planId) {
  const res = await api.get(`/context/suggest?plan_id=${planId}&limit=1`, auth(token));
  if (res.status !== 200) throw new Error(`suggest failed: ${res.status} ${JSON.stringify(res.data)}`);
  return res.data.suggestions || [];
}

async function suggestMany(token, planId, limit = 10) {
  const res = await api.get(`/context/suggest?plan_id=${planId}&limit=${limit}`, auth(token));
  if (res.status !== 200) throw new Error(`suggest failed: ${res.status} ${JSON.stringify(res.data)}`);
  return res.data.suggestions || [];
}

describe('E2E: dep-aware suggest + claim cycle (happy path)', () => {
  let token, planId, chain;

  it('setup: register + plan + RPI chain', async () => {
    const out = await setupChainPlan('happy');
    token = out.token;
    planId = out.planId;
    chain = out.chain;
    expect(chain.research?.id).toBeTruthy();
    expect(chain.plan?.id).toBeTruthy();
    expect(chain.implement?.id).toBeTruthy();
  });

  it('suggest returns ONLY Research when chain is fresh', async () => {
    const many = await suggestMany(token, planId, 10);
    const ids = many.map((t) => t.id);
    expect(ids).toContain(chain.research.id);
    expect(ids).not.toContain(chain.plan.id);
    expect(ids).not.toContain(chain.implement.id);
  });

  it('dry_run work-session returns Research as candidate', async () => {
    const res = await api.post('/agent/work-sessions', { plan_id: planId, dry_run: true }, auth(token));
    expect(res.status).toBe(200);
    expect(res.data.dry_run).toBe(true);
    expect(res.data.task?.id).toBe(chain.research.id);
    expect(res.data.claim).toBeNull();
  });

  it('live work-session claims Research and walks the chain to drained', async () => {
    const steps = [
      { label: 'research', expectedId: chain.research.id },
      { label: 'plan', expectedId: chain.plan.id },
      { label: 'implement', expectedId: chain.implement.id },
    ];

    for (const step of steps) {
      const suggested = await suggestOne(token, planId);
      expect(suggested[0]?.id).toBe(step.expectedId);

      const start = await api.post('/agent/work-sessions', { plan_id: planId }, auth(token));
      expect(start.status).toBe(201);
      expect(start.data.task?.id).toBe(step.expectedId);
      expect(start.data.session_id).toBeTruthy();

      const done = await api.post(
        `/agent/work-sessions/${start.data.session_id}/complete`,
        {},
        auth(token),
      );
      expect(done.status).toBe(200);
    }

    // Chain drained.
    const drained = await suggestMany(token, planId, 10);
    expect(drained).toEqual([]);

    const empty = await api.post('/agent/work-sessions', { plan_id: planId }, auth(token));
    expect(empty.status).toBe(404);
    expect(empty.data.code).toBe('not_found');
    expect(empty.data.reason).toBe('no_work_in_scope');
  });
});

describe('E2E: fail-closed when remaining work is dep-blocked', () => {
  let token, planId, chain;

  it('setup: register + plan + RPI chain', async () => {
    const out = await setupChainPlan('blocked');
    token = out.token;
    planId = out.planId;
    chain = out.chain;
  });

  it('claims Research (leaving Plan + Implement dep-blocked)', async () => {
    const start = await api.post('/agent/work-sessions', { plan_id: planId }, auth(token));
    expect(start.status).toBe(201);
    expect(start.data.task?.id).toBe(chain.research.id);
    // Note: Research is now in_progress. We deliberately do NOT complete it.
  });

  it('suggest returns empty: Research is claimed, downstream is dep-blocked', async () => {
    const many = await suggestMany(token, planId, 10);
    const ids = many.map((t) => t.id);
    expect(ids).not.toContain(chain.research.id);
    expect(ids).not.toContain(chain.plan.id);
    expect(ids).not.toContain(chain.implement.id);
  });

  it('starting another work-session fails closed with reason=blocked_on_dep', async () => {
    // fresh:true skips the resume_in_progress rung so we exercise the dep-aware
    // selection path against the blocked downstream tasks, not the already-claimed Research.
    const res = await api.post('/agent/work-sessions', { plan_id: planId, fresh: true }, auth(token));
    expect(res.status).toBe(404);
    expect(res.data.code).toBe('not_found');
    expect(res.data.reason).toBe('blocked_on_dep');
  });
});
