/**
 * API Smoke Test Suite
 *
 * Comprehensive integration tests that exercise every major endpoint group
 * against a running local API (docker compose).
 *
 * Prerequisites:
 *   docker compose -f docker-compose.local.yml up -d
 *   export API_TOKEN=<valid JWT or API key>
 *
 * Run:
 *   npx jest tests/integration/api-smoke.test.js --runInBand
 *   npm run test:integration
 */

const API_URL = process.env.API_URL || 'http://localhost:3000';
const API_TOKEN = process.env.API_TOKEN || '';

function headers(extra = {}) {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${API_TOKEN}`,
    ...extra,
  };
}

async function api(path, opts = {}) {
  const { method = 'GET', body, noAuth } = opts;
  const h = noAuth ? { 'Content-Type': 'application/json' } : headers();
  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers: h,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => null);
  return { status: res.status, data };
}

const describeIfToken = API_TOKEN ? describe : describe.skip;
const testId = Date.now().toString(36);

// ─── Shared test data ────────────────────────────────────────────
let planId, rootNodeId, phaseId, taskAId, taskBId;

describeIfToken('API Smoke Tests', () => {
  // Create shared plan + nodes that most test groups depend on
  beforeAll(async () => {
    // Create plan
    const { data: plan } = await api('/plans', {
      method: 'POST',
      body: { title: `Smoke Test Plan ${testId}`, description: 'Integration test plan', status: 'active' },
    });
    planId = plan.id;

    // Get root node
    const { data: tree } = await api(`/plans/${planId}/nodes`);
    rootNodeId = tree[0]?.id;

    // Create phase
    const { data: phase } = await api(`/plans/${planId}/nodes`, {
      method: 'POST',
      body: { node_type: 'phase', title: `Phase ${testId}`, parent_id: rootNodeId },
    });
    phaseId = phase.id;

    // Create two tasks under the phase
    const { data: taskA } = await api(`/plans/${planId}/nodes`, {
      method: 'POST',
      body: { node_type: 'task', title: `Task A ${testId}`, parent_id: phaseId },
    });
    taskAId = taskA.id;

    const { data: taskB } = await api(`/plans/${planId}/nodes`, {
      method: 'POST',
      body: { node_type: 'task', title: `Task B ${testId}`, parent_id: phaseId },
    });
    taskBId = taskB.id;
  });

  // Clean up shared plan (cascades nodes, deps, claims, episode-links)
  afterAll(async () => {
    if (planId) await api(`/plans/${planId}`, { method: 'DELETE' });
  });

  // ─── Auth ────────────────────────────────────────────────────
  describe('Auth', () => {
    it('rejects requests with no auth header → 401', async () => {
      const { status } = await api('/plans', { noAuth: true });
      expect(status).toBe(401);
    });

    it('rejects requests with invalid token → 401', async () => {
      const res = await fetch(`${API_URL}/plans`, {
        headers: { Authorization: 'Bearer invalidtoken123' },
      });
      expect(res.status).toBe(401);
    });
  });

  // ─── Plans CRUD ──────────────────────────────────────────────
  describe('Plans CRUD', () => {
    let crudPlanId;

    it('POST /plans creates a plan → 201', async () => {
      const { status, data } = await api('/plans', {
        method: 'POST',
        body: { title: `CRUD Plan ${testId}` },
      });
      expect(status).toBe(201);
      expect(data.id).toBeDefined();
      expect(data.title).toBe(`CRUD Plan ${testId}`);
      expect(data.status).toBe('draft');
      crudPlanId = data.id;
    });

    it('POST /plans with missing title → 400', async () => {
      const { status } = await api('/plans', {
        method: 'POST',
        body: { description: 'no title' },
      });
      expect(status).toBe(400);
    });

    it('GET /plans lists plans → 200', async () => {
      const { status, data } = await api('/plans');
      expect(status).toBe(200);
      expect(Array.isArray(data)).toBe(true);
      expect(data.length).toBeGreaterThanOrEqual(1);
    });

    it('GET /plans/:id returns plan with quality fields → 200', async () => {
      const { status, data } = await api(`/plans/${crudPlanId}`);
      expect(status).toBe(200);
      expect(data).toHaveProperty('quality_score');
      expect(data).toHaveProperty('quality_assessed_at');
      expect(data).toHaveProperty('quality_rationale');
      expect(data).toHaveProperty('created_at');
    });

    it('PUT /plans/:id updates title → 200', async () => {
      const { status, data } = await api(`/plans/${crudPlanId}`, {
        method: 'PUT',
        body: { title: `Updated CRUD Plan ${testId}` },
      });
      expect(status).toBe(200);
      expect(data.title).toBe(`Updated CRUD Plan ${testId}`);
    });

    it('PUT /plans/:id sets quality_score → 200', async () => {
      const { status, data } = await api(`/plans/${crudPlanId}`, {
        method: 'PUT',
        body: { quality_score: 0.85, quality_rationale: 'Solid plan' },
      });
      expect(status).toBe(200);
      expect(data.quality_score).toBe(0.85);
      expect(data.quality_rationale).toBe('Solid plan');
    });

    it('PUT /plans/:id rejects quality_score > 1 → 400', async () => {
      const { status } = await api(`/plans/${crudPlanId}`, {
        method: 'PUT',
        body: { quality_score: 1.5 },
      });
      expect(status).toBe(400);
    });

    it('DELETE /plans/:id → 200 or 204', async () => {
      const { status } = await api(`/plans/${crudPlanId}`, { method: 'DELETE' });
      expect([200, 204]).toContain(status);
    });
  });

  // ─── Nodes CRUD ──────────────────────────────────────────────
  describe('Nodes CRUD', () => {
    it('GET /plans/:id/nodes returns tree → 200', async () => {
      const { status, data } = await api(`/plans/${planId}/nodes`);
      expect(status).toBe(200);
      expect(Array.isArray(data)).toBe(true);
      expect(data.length).toBeGreaterThanOrEqual(1);
      // Root node should have children
      expect(data[0]).toHaveProperty('children');
    });

    it('GET /plans/:id/nodes?include_details=true has extra fields', async () => {
      const { status, data } = await api(`/plans/${planId}/nodes?include_details=true`);
      expect(status).toBe(200);
      const root = data[0];
      expect(root).toHaveProperty('description');
      expect(root).toHaveProperty('context');
      expect(root).toHaveProperty('agent_instructions');
      expect(root).toHaveProperty('coherence_status');
      expect(root).toHaveProperty('quality_score');
    });

    it('POST /plans/:id/nodes creates milestone → 201', async () => {
      const { status, data } = await api(`/plans/${planId}/nodes`, {
        method: 'POST',
        body: { node_type: 'milestone', title: `Milestone ${testId}`, parent_id: phaseId },
      });
      expect(status).toBe(201);
      expect(data.node_type).toBe('milestone');
      // Clean up
      await api(`/plans/${planId}/nodes/${data.id}`, { method: 'DELETE' });
    });

    it('POST /plans/:id/nodes with missing title → 400', async () => {
      const { status } = await api(`/plans/${planId}/nodes`, {
        method: 'POST',
        body: { node_type: 'task', parent_id: phaseId },
      });
      expect(status).toBe(400);
    });

    it('GET /plans/:id/nodes/:nodeId returns node → 200', async () => {
      const { status, data } = await api(`/plans/${planId}/nodes/${taskAId}`);
      expect(status).toBe(200);
      expect(data.id).toBe(taskAId);
      expect(data).toHaveProperty('plan_id');
      expect(data).toHaveProperty('node_type');
      expect(data).toHaveProperty('coherence_status');
      expect(data).toHaveProperty('quality_score');
    });

    it('PUT /plans/:id/nodes/:nodeId updates title → 200', async () => {
      const { status, data } = await api(`/plans/${planId}/nodes/${taskAId}`, {
        method: 'PUT',
        body: { title: `Updated Task A ${testId}` },
      });
      expect(status).toBe(200);
      expect(data.title).toBe(`Updated Task A ${testId}`);
    });

    it('PUT /plans/:id/nodes/:nodeId sets coherence_status → 200', async () => {
      const { status, data } = await api(`/plans/${planId}/nodes/${taskAId}`, {
        method: 'PUT',
        body: { coherence_status: 'coherent' },
      });
      expect(status).toBe(200);
      expect(data.coherence_status).toBe('coherent');
    });

    it('PUT /plans/:id/nodes/:nodeId sets quality_score → 200', async () => {
      const { status, data } = await api(`/plans/${planId}/nodes/${taskAId}`, {
        method: 'PUT',
        body: { quality_score: 0.72, quality_rationale: 'Clear acceptance criteria' },
      });
      expect(status).toBe(200);
      expect(data.quality_score).toBe(0.72);
    });

    it('PUT /plans/:id/nodes/:nodeId rejects invalid coherence_status → 400', async () => {
      const { status } = await api(`/plans/${planId}/nodes/${taskAId}`, {
        method: 'PUT',
        body: { coherence_status: 'banana' },
      });
      expect(status).toBe(400);
    });

    it('PUT /plans/:id/nodes/:nodeId/status sets in_progress → 200', async () => {
      const { status, data } = await api(`/plans/${planId}/nodes/${taskAId}/status`, {
        method: 'PUT',
        body: { status: 'in_progress' },
      });
      expect(status).toBe(200);
      expect(data.status).toBe('in_progress');
    });

    it('PUT /plans/:id/nodes/:nodeId/status rejects invalid → 400', async () => {
      const { status } = await api(`/plans/${planId}/nodes/${taskAId}/status`, {
        method: 'PUT',
        body: { status: 'banana' },
      });
      expect(status).toBe(400);
    });

    it('GET /plans/:id/nodes?coherence_status=coherent filters nodes', async () => {
      const { status, data } = await api(`/plans/${planId}/nodes?coherence_status=coherent&include_details=true`);
      expect(status).toBe(200);
      // The filter applies at the DB level before tree assembly.
      // Since the root and phase are "unchecked", they're excluded from the tree,
      // so filtered nodes appear as orphan roots. Verify the filter works by
      // checking that a flat request with the same filter returns only "coherent" nodes.
      const allNodes = flattenTree(data);
      allNodes.forEach(n => expect(n.coherence_status).toBe('coherent'));
    });

    it('DELETE /plans/:id/nodes/:nodeId removes node', async () => {
      // Create throwaway node
      const { data: tmp } = await api(`/plans/${planId}/nodes`, {
        method: 'POST',
        body: { node_type: 'task', title: `Throwaway ${testId}`, parent_id: phaseId },
      });
      const { status } = await api(`/plans/${planId}/nodes/${tmp.id}`, { method: 'DELETE' });
      expect([200, 204]).toContain(status);
    });
  });

  // ─── Dependencies ────────────────────────────────────────────
  describe('Dependencies', () => {
    let depId;

    it('POST /plans/:id/dependencies creates edge → 201', async () => {
      const { status, data } = await api(`/plans/${planId}/dependencies`, {
        method: 'POST',
        body: { source_node_id: taskAId, target_node_id: taskBId, dependency_type: 'blocks' },
      });
      expect(status).toBe(201);
      expect(data).toHaveProperty('id');
      depId = data.id;
    });

    it('POST /plans/:id/dependencies duplicate → 409', async () => {
      const { status } = await api(`/plans/${planId}/dependencies`, {
        method: 'POST',
        body: { source_node_id: taskAId, target_node_id: taskBId, dependency_type: 'blocks' },
      });
      expect(status).toBe(409);
    });

    it('POST /plans/:id/dependencies missing fields → 400', async () => {
      const { status } = await api(`/plans/${planId}/dependencies`, {
        method: 'POST',
        body: { source_node_id: taskAId },
      });
      expect(status).toBe(400);
    });

    it('GET /plans/:id/dependencies lists edges → 200', async () => {
      const { status, data } = await api(`/plans/${planId}/dependencies`);
      expect(status).toBe(200);
      // Response: { edges: [...], count: N }
      expect(data).toHaveProperty('edges');
      expect(Array.isArray(data.edges)).toBe(true);
      expect(data.edges.length).toBeGreaterThanOrEqual(1);
    });

    it('GET /plans/:id/nodes/:nodeId/upstream → 200', async () => {
      const { status, data } = await api(`/plans/${planId}/nodes/${taskBId}/upstream`);
      expect(status).toBe(200);
      // Response shape: { count, nodes } — "nodes" lists upstream blockers
      expect(data).toHaveProperty('nodes');
      expect(data.count).toBeGreaterThanOrEqual(1);
    });

    it('GET /plans/:id/nodes/:nodeId/downstream → 200', async () => {
      const { status, data } = await api(`/plans/${planId}/nodes/${taskAId}/downstream`);
      expect(status).toBe(200);
      expect(data).toHaveProperty('nodes');
      expect(data.count).toBeGreaterThanOrEqual(1);
    });

    it('DELETE /plans/:id/dependencies/:depId → 200', async () => {
      const { status } = await api(`/plans/${planId}/dependencies/${depId}`, {
        method: 'DELETE',
      });
      expect([200, 204]).toContain(status);
    });
  });

  // ─── Goals ───────────────────────────────────────────────────
  describe('Goals', () => {
    let goalId, linkId;

    it('POST /goals creates goal → 201', async () => {
      const { status, data } = await api('/goals', {
        method: 'POST',
        body: { title: `Smoke Goal ${testId}`, type: 'outcome', description: 'Test goal' },
      });
      expect(status).toBe(201);
      expect(data).toHaveProperty('id');
      expect(data.title).toBe(`Smoke Goal ${testId}`);
      goalId = data.id;
    });

    it('POST /goals with missing title → 400', async () => {
      const { status } = await api('/goals', {
        method: 'POST',
        body: { type: 'outcome' },
      });
      expect(status).toBe(400);
    });

    it('GET /goals lists goals → 200', async () => {
      const { status, data } = await api('/goals');
      expect(status).toBe(200);
      expect(data).toHaveProperty('goals');
      expect(Array.isArray(data.goals)).toBe(true);
    });

    it('GET /goals/:id returns goal → 200', async () => {
      const { status, data } = await api(`/goals/${goalId}`);
      expect(status).toBe(200);
      expect(data.title).toBe(`Smoke Goal ${testId}`);
      expect(data).toHaveProperty('type');
    });

    it('PUT /goals/:id updates title → 200', async () => {
      const { status, data } = await api(`/goals/${goalId}`, {
        method: 'PUT',
        body: { title: `Updated Smoke Goal ${testId}` },
      });
      expect(status).toBe(200);
      expect(data.title).toBe(`Updated Smoke Goal ${testId}`);
    });

    it('POST /goals/:id/links links plan → 201', async () => {
      const { status, data } = await api(`/goals/${goalId}/links`, {
        method: 'POST',
        body: { linkedType: 'plan', linkedId: planId },
      });
      expect(status).toBe(201);
      expect(data).toHaveProperty('id');
      linkId = data.id;
    });

    it('POST /goals/:id/links invalid linkedType → 400', async () => {
      const { status } = await api(`/goals/${goalId}/links`, {
        method: 'POST',
        body: { linkedType: 'banana', linkedId: planId },
      });
      expect(status).toBe(400);
    });

    it('GET /goals/:id/knowledge-gaps → 200', async () => {
      const { status } = await api(`/goals/${goalId}/knowledge-gaps`);
      expect(status).toBe(200);
    });

    it('DELETE /goals/:id/links/:linkId → 200', async () => {
      const { status } = await api(`/goals/${goalId}/links/${linkId}`, {
        method: 'DELETE',
      });
      expect(status).toBe(200);
    });

    it('DELETE /goals/:id → 200', async () => {
      const { status } = await api(`/goals/${goalId}`, { method: 'DELETE' });
      expect(status).toBe(200);
    });
  });

  // ─── Goals BDI Phase 3: Desire/Intention ─────────────────────
  describe('Goals BDI Phase 3: Desire/Intention', () => {
    let bdiGoalId;

    it('POST /goals with goalType=desire → 201', async () => {
      const { status, data } = await api('/goals', {
        method: 'POST',
        body: { title: `BDI Goal ${testId}`, type: 'outcome', goalType: 'desire' },
      });
      expect(status).toBe(201);
      expect(data.goalType).toBe('desire');
      bdiGoalId = data.id;
    });

    it('POST promote-to-intention without success_criteria → not ready', async () => {
      const { status, data } = await api(`/goals/${bdiGoalId}/promote-to-intention`, {
        method: 'POST',
      });
      expect(status).toBe(200);
      expect(data.ready).toBe(false);
      expect(data.gaps.length).toBeGreaterThanOrEqual(1);
    });

    it('PUT goal with successCriteria + link plan → ready to promote', async () => {
      // Add success criteria
      await api(`/goals/${bdiGoalId}`, {
        method: 'PUT',
        body: { successCriteria: [{ metric: 'test coverage', target: '80%' }] },
      });

      // Link the shared plan
      await api(`/goals/${bdiGoalId}/links`, {
        method: 'POST',
        body: { linkedType: 'plan', linkedId: planId },
      });

      // Now promote
      const { status, data } = await api(`/goals/${bdiGoalId}/promote-to-intention`, {
        method: 'POST',
      });
      expect(status).toBe(200);
      expect(data.ready).toBe(true);
      expect(data.goal.goalType).toBe('intention');
      expect(data.goal.promotedAt).toBeDefined();
    });

    it('GET goal after promotion shows intention type', async () => {
      const { status, data } = await api(`/goals/${bdiGoalId}`);
      expect(status).toBe(200);
      expect(data.goalType).toBe('intention');
      expect(data.promotedAt).toBeDefined();
    });

    it('GET /goals/:id/knowledge-gaps includes goal_type and gap_severity', async () => {
      const { status, data } = await api(`/goals/${bdiGoalId}/knowledge-gaps`);
      expect(status).toBe(200);
      expect(data).toHaveProperty('goal_type');
      // Any gaps for an intention goal should be 'blocking'
      if (data.gaps && data.gaps.length > 0) {
        data.gaps.forEach(g => expect(g.gap_severity).toBe('blocking'));
      }
    });

    it('GET /goals/:id/portfolio returns goal subtree → 200', async () => {
      const { status, data } = await api(`/goals/${bdiGoalId}/portfolio`);
      expect(status).toBe(200);
      expect(data.goal.id).toBe(bdiGoalId);
      expect(data.goal.goal_type).toBe('intention');
      expect(data).toHaveProperty('descendants');
      expect(data).toHaveProperty('linked_plans');
      expect(data).toHaveProperty('stats');
      expect(data.stats.linked_plan_count).toBeGreaterThanOrEqual(1);
    });

    it('DELETE /goals/:id cleans up → 200', async () => {
      const { status } = await api(`/goals/${bdiGoalId}`, { method: 'DELETE' });
      expect(status).toBe(200);
    });
  });

  // ─── Claims (BDI) ───────────────────────────────────────────
  describe('Claims (BDI)', () => {
    const agentId = `smoke-agent-${testId}`;

    it('POST claim with belief_snapshot → 201', async () => {
      const { status, data } = await api(`/plans/${planId}/nodes/${taskBId}/claim`, {
        method: 'POST',
        body: { agent_id: agentId, ttl_minutes: 5, belief_snapshot: ['ep-001', 'ep-002'] },
      });
      expect(status).toBe(201);
      expect(data.agent_id).toBe(agentId);
      expect(data.node_id).toBe(taskBId);
      expect(data.belief_snapshot).toEqual(['ep-001', 'ep-002']);
      expect(data).toHaveProperty('expires_at');
    });

    it('POST claim again → 409 conflict', async () => {
      const { status, data } = await api(`/plans/${planId}/nodes/${taskBId}/claim`, {
        method: 'POST',
        body: { agent_id: 'other-agent', ttl_minutes: 5 },
      });
      // 409 when claims DAL detects active claim; 500 if unique constraint fires first
      expect([409, 500]).toContain(status);
      if (status === 409) {
        expect(data).toHaveProperty('existing_claim');
      }
    });

    it('POST claim missing agent_id → 400', async () => {
      const { status } = await api(`/plans/${planId}/nodes/${taskBId}/claim`, {
        method: 'POST',
        body: {},
      });
      expect(status).toBe(400);
    });

    it('GET claim returns active claim → 200', async () => {
      const { status, data } = await api(`/plans/${planId}/nodes/${taskBId}/claim`);
      expect(status).toBe(200);
      expect(data.agent_id).toBe(agentId);
      expect(data.belief_snapshot).toEqual(['ep-001', 'ep-002']);
    });

    it('DELETE claim releases it → 200', async () => {
      const { status, data } = await api(`/plans/${planId}/nodes/${taskBId}/claim`, {
        method: 'DELETE',
        body: { agent_id: agentId },
      });
      expect(status).toBe(200);
      expect(data).toHaveProperty('released_at');
      expect(data.released_at).not.toBeNull();
    });
  });

  // ─── Knowledge Loop (BDI Phase 4) ───────────────────────────
  describe('Knowledge Loop (BDI Phase 4)', () => {
    let loopId;

    it('POST start loop → 201', async () => {
      const { status, data } = await api(`/plans/${planId}/knowledge-loop/start`, {
        method: 'POST',
        body: { max_iterations: 5 },
      });
      expect(status).toBe(201);
      expect(data).toHaveProperty('loop_id');
      expect(data.status).toBe('running');
      expect(data).toHaveProperty('quality_before');
      expect(data.max_iterations).toBe(5);
      loopId = data.loop_id;
    });

    it('POST start while running → 409', async () => {
      const { status } = await api(`/plans/${planId}/knowledge-loop/start`, {
        method: 'POST',
        body: { max_iterations: 5 },
      });
      expect(status).toBe(409);
    });

    it('GET status → running', async () => {
      const { status, data } = await api(`/plans/${planId}/knowledge-loop/status`);
      expect(status).toBe(200);
      expect(data.status).toBe('running');
      expect(data.loop_id).toBe(loopId);
      expect(data.iterations_completed).toBe(0);
    });

    it('GET context → plan + knowledge', async () => {
      const { status, data } = await api(`/plans/${planId}/knowledge-loop/context`);
      expect(status).toBe(200);
      expect(data).toHaveProperty('plan');
      expect(data).toHaveProperty('nodes');
      expect(data).toHaveProperty('loop');
      expect(data.plan.id).toBe(planId);
    });

    it('POST iterate → records iteration', async () => {
      const { status, data } = await api(`/plans/${planId}/knowledge-loop/iterate`, {
        method: 'POST',
        body: {
          quality_score: 0.6,
          rationale: 'Added missing dependency',
          modifications: ['Added dependency: Task A blocks Task B'],
        },
      });
      expect(status).toBe(200);
      expect(data.iteration).toBe(1);
      expect(data.quality_score).toBe(0.6);
      expect(data.loop_status).toBe('running');
    });

    it('POST iterate with missing quality_score → 400', async () => {
      const { status } = await api(`/plans/${planId}/knowledge-loop/iterate`, {
        method: 'POST',
        body: { rationale: 'no score' },
      });
      expect(status).toBe(400);
    });

    it('POST iterate × 3 with same score → converges', async () => {
      // Iterations 2, 3, 4 all with same score → delta < 0.02 over window of 3
      for (let i = 0; i < 3; i++) {
        await api(`/plans/${planId}/knowledge-loop/iterate`, {
          method: 'POST',
          body: { quality_score: 0.6, rationale: `Iteration ${i + 2}` },
        });
      }
      const { data } = await api(`/plans/${planId}/knowledge-loop/status`);
      expect(data.status).toBe('converged');
      expect(data.iterations_completed).toBe(4);
    });

    it('GET status after convergence shows full history', async () => {
      const { status, data } = await api(`/plans/${planId}/knowledge-loop/status`);
      expect(status).toBe(200);
      expect(data.status).toBe('converged');
      expect(data.quality_progression.length).toBe(4);
      expect(data.completed_at).toBeDefined();
    });

    it('POST stop on non-running loop → 404', async () => {
      const { status } = await api(`/plans/${planId}/knowledge-loop/stop`, { method: 'POST' });
      expect(status).toBe(404);
    });
  });

  // ─── Episode Links (BDI) ────────────────────────────────────
  describe('Episode Links (BDI)', () => {
    const fakeEpisodeId = `smoke-ep-${testId}`;
    let episodeLinkId;

    it('POST episode-link → 201', async () => {
      const { status, data } = await api(`/plans/${planId}/nodes/${taskAId}/episode-links`, {
        method: 'POST',
        body: { episode_id: fakeEpisodeId, link_type: 'supports' },
      });
      expect(status).toBe(201);
      expect(data.episode_id).toBe(fakeEpisodeId);
      expect(data.node_id).toBe(taskAId);
      expect(data.link_type).toBe('supports');
      episodeLinkId = data.id;
    });

    it('POST episode-link second type → 201', async () => {
      const { status, data } = await api(`/plans/${planId}/nodes/${taskAId}/episode-links`, {
        method: 'POST',
        body: { episode_id: `${fakeEpisodeId}-2`, link_type: 'informs' },
      });
      expect(status).toBe(201);
      expect(data.link_type).toBe('informs');
    });

    it('POST episode-link missing episode_id → 400', async () => {
      const { status } = await api(`/plans/${planId}/nodes/${taskAId}/episode-links`, {
        method: 'POST',
        body: { link_type: 'informs' },
      });
      expect(status).toBe(400);
    });

    it('POST episode-link invalid link_type → 400', async () => {
      const { status } = await api(`/plans/${planId}/nodes/${taskAId}/episode-links`, {
        method: 'POST',
        body: { episode_id: 'xyz', link_type: 'banana' },
      });
      expect(status).toBe(400);
    });

    it('POST episode-link duplicate → 409', async () => {
      const { status } = await api(`/plans/${planId}/nodes/${taskAId}/episode-links`, {
        method: 'POST',
        body: { episode_id: fakeEpisodeId, link_type: 'supports' },
      });
      expect(status).toBe(409);
    });

    it('GET episode-links lists all → 200', async () => {
      const { status, data } = await api(`/plans/${planId}/nodes/${taskAId}/episode-links`);
      expect(status).toBe(200);
      expect(Array.isArray(data)).toBe(true);
      expect(data.length).toBeGreaterThanOrEqual(2);
    });

    it('GET episode-links?link_type=supports filters → 200', async () => {
      const { status, data } = await api(`/plans/${planId}/nodes/${taskAId}/episode-links?link_type=supports`);
      expect(status).toBe(200);
      data.forEach(l => expect(l.link_type).toBe('supports'));
    });

    it('DELETE episode-link → 200', async () => {
      const { status, data } = await api(`/plans/${planId}/nodes/${taskAId}/episode-links/${episodeLinkId}`, {
        method: 'DELETE',
      });
      expect(status).toBe(200);
      expect(data.link_type).toBe('supports');
    });
  });

  // ─── Coherence Endpoint (BDI Phase 2) ────────────────────────
  describe('Coherence Endpoint (BDI Phase 2)', () => {
    // Rate limiter may kick in after many rapid requests — brief pause
    beforeAll(() => new Promise(r => setTimeout(r, 1000)));
    it('GET /plans/:id/coherence returns issues list → 200', async () => {
      const { status, data } = await api(`/plans/${planId}/coherence`);
      expect(status).toBe(200);
      expect(data).toHaveProperty('issues');
      expect(Array.isArray(data.issues)).toBe(true);
      expect(data).toHaveProperty('count');
      expect(data.plan_id).toBe(planId);
    });

    it('GET /plans/:id/coherence shows flagged nodes', async () => {
      // Set a node to contradiction_detected and link an episode
      await api(`/plans/${planId}/nodes/${taskAId}`, {
        method: 'PUT',
        body: { coherence_status: 'contradiction_detected' },
      });
      await api(`/plans/${planId}/nodes/${taskAId}/episode-links`, {
        method: 'POST',
        body: { episode_id: `coherence-test-ep-${testId}`, link_type: 'contradicts' },
      });

      const { status, data } = await api(`/plans/${planId}/coherence`);
      expect(status).toBe(200);
      expect(data.count).toBeGreaterThanOrEqual(1);

      const issue = data.issues.find(i => i.node_id === taskAId);
      expect(issue).toBeDefined();
      expect(issue.coherence_status).toBe('contradiction_detected');
      expect(issue.triggering_episodes.length).toBeGreaterThanOrEqual(1);
      // Should have a 'contradicts' link among the triggering episodes
      const contradictLink = issue.triggering_episodes.find(e => e.link_type === 'contradicts');
      expect(contradictLink).toBeDefined();
    });
  });

  // ─── Coherence Engine Flow (BDI Phase 2, requires Graphiti) ──
  describe('Coherence Engine Flow (BDI Phase 2)', () => {
    let graphitiAvailable = false;

    beforeAll(async () => {
      const { status, data } = await api('/knowledge/graphiti/status');
      graphitiAvailable = status === 200 && data?.available === true;
    });

    it('POST /knowledge/episodes response includes coherence_warnings field', async () => {
      if (!graphitiAvailable) return;
      const { status, data } = await api('/knowledge/episodes', {
        method: 'POST',
        body: {
          content: `Coherence test episode ${testId}: we are switching from REST to GraphQL`,
          name: `coherence-test-${testId}`,
          plan_id: planId,
        },
      });
      expect(status).toBe(201);
      expect(data).toHaveProperty('coherence_warnings');
      expect(Array.isArray(data.coherence_warnings)).toBe(true);
      // coherence_warnings may be empty if no tasks match the episode content
    });

    it('POST /knowledge/episodes without plan_id returns empty coherence_warnings', async () => {
      if (!graphitiAvailable) return;
      const { status, data } = await api('/knowledge/episodes', {
        method: 'POST',
        body: {
          content: `General knowledge ${testId}: the sky is blue`,
          name: `general-${testId}`,
        },
      });
      expect(status).toBe(201);
      expect(data.coherence_warnings).toEqual([]);
    });
  });

  // ─── Knowledge / Graphiti (conditional) ──────────────────────
  describe('Knowledge / Graphiti', () => {
    let graphitiAvailable = false;

    beforeAll(async () => {
      const { status, data } = await api('/knowledge/graphiti/status');
      graphitiAvailable = status === 200 && data?.available === true;
    });

    it('GET /knowledge/graphiti/status → 200', async () => {
      const { status } = await api('/knowledge/graphiti/status');
      expect(status).toBe(200);
    });

    it('POST /knowledge/episodes creates episode', async () => {
      if (!graphitiAvailable) return;
      const { status, data } = await api('/knowledge/episodes', {
        method: 'POST',
        body: { content: `Smoke test knowledge ${testId}`, name: `smoke-${testId}` },
      });
      expect(status).toBe(201);
      expect(data).toHaveProperty('episode');
    });

    it('POST /knowledge/episodes missing content → 400', async () => {
      if (!graphitiAvailable) return;
      const { status } = await api('/knowledge/episodes', {
        method: 'POST',
        body: { name: 'bad' },
      });
      expect([400, 500]).toContain(status);
    });

    it('GET /knowledge/episodes lists recent → 200', async () => {
      if (!graphitiAvailable) return;
      const { status } = await api('/knowledge/episodes');
      expect(status).toBe(200);
    });

    it('POST /knowledge/graph-search → 200', async () => {
      if (!graphitiAvailable) return;
      const { status } = await api('/knowledge/graph-search', {
        method: 'POST',
        body: { query: 'smoke test', max_results: 3 },
      });
      expect(status).toBe(200);
    });
  });
  // ─── Full BDI Loop E2E (Phase 5 acceptance test) ──────────────
  describe('Full BDI Loop E2E', () => {
    let bdiPlanId, bdiGoalId, bdiTaskId, bdiRootId;

    beforeAll(async () => {
      // Note: If rate-limited (429), set RATE_LIMIT_GENERAL=1000 on the API container
      // Create a dedicated plan for the BDI flow
      const { data: plan } = await api('/plans', {
        method: 'POST',
        body: { title: `BDI E2E Plan ${testId}`, status: 'active' },
      });
      bdiPlanId = plan.id;

      // Get root node
      const { data: tree } = await api(`/plans/${bdiPlanId}/nodes`);
      bdiRootId = tree[0]?.id;

      // Create a task
      const { data: task } = await api(`/plans/${bdiPlanId}/nodes`, {
        method: 'POST',
        body: {
          node_type: 'task',
          title: `Use PostgreSQL for data storage ${testId}`,
          description: 'Store all application data in PostgreSQL with pgvector for embeddings',
          parent_id: bdiRootId,
        },
      });
      bdiTaskId = task.id;

      // Create a desire goal
      const { data: goal } = await api('/goals', {
        method: 'POST',
        body: {
          title: `Build scalable data layer ${testId}`,
          type: 'outcome',
          goalType: 'desire',
        },
      });
      bdiGoalId = goal.id;
    });

    afterAll(async () => {
      if (bdiPlanId) await api(`/plans/${bdiPlanId}`, { method: 'DELETE' });
      if (bdiGoalId) await api(`/goals/${bdiGoalId}`, { method: 'DELETE' });
    });

    it('Step 1: Goal starts as desire', async () => {
      const { data } = await api(`/goals/${bdiGoalId}`);
      expect(data.goalType).toBe('desire');
    });

    it('Step 2: Promotion fails without criteria + plan', async () => {
      const { data } = await api(`/goals/${bdiGoalId}/promote-to-intention`, { method: 'POST' });
      expect(data.ready).toBe(false);
      expect(data.gaps.length).toBeGreaterThanOrEqual(1);
    });

    it('Step 3: Add success criteria and link plan', async () => {
      await api(`/goals/${bdiGoalId}`, {
        method: 'PUT',
        body: { successCriteria: [{ metric: 'query latency', target: '<100ms p99' }] },
      });
      await api(`/goals/${bdiGoalId}/links`, {
        method: 'POST',
        body: { linkedType: 'plan', linkedId: bdiPlanId },
      });
      const { data } = await api(`/goals/${bdiGoalId}`);
      expect(data.successCriteria).toBeDefined();
      expect(data.links.some(l => l.linkedType === 'plan')).toBe(true);
    });

    it('Step 4: Promote desire → intention', async () => {
      const { data } = await api(`/goals/${bdiGoalId}/promote-to-intention`, { method: 'POST' });
      expect(data.ready).toBe(true);
      expect(data.goal.goalType).toBe('intention');
    });

    it('Step 5: Start knowledge loop', async () => {
      const { status, data } = await api(`/plans/${bdiPlanId}/knowledge-loop/start`, {
        method: 'POST',
        body: { goal_id: bdiGoalId, max_iterations: 5 },
      });
      expect(status).toBe(201);
      expect(data.status).toBe('running');
      expect(data.quality_before).toBeDefined();
    });

    it('Step 6: Agent iterates — improve quality', async () => {
      // Iteration 1: evaluate and improve
      const { data: iter1 } = await api(`/plans/${bdiPlanId}/knowledge-loop/iterate`, {
        method: 'POST',
        body: {
          quality_score: 0.55,
          rationale: 'Coverage is low — task lacks explicit dependency ordering',
          modifications: ['Added dependency analysis task'],
        },
      });
      expect(iter1.iteration).toBe(1);
      expect(iter1.loop_status).toBe('running');

      // Iteration 2: further improvement
      const { data: iter2 } = await api(`/plans/${bdiPlanId}/knowledge-loop/iterate`, {
        method: 'POST',
        body: {
          quality_score: 0.72,
          rationale: 'Added acceptance criteria and dependency edges',
          modifications: ['Updated task descriptions', 'Added blocking dependency'],
        },
      });
      expect(iter2.quality_delta).toBeGreaterThan(0);
    });

    it('Step 7: Check coherence endpoint', async () => {
      const { status, data } = await api(`/plans/${bdiPlanId}/coherence`);
      expect(status).toBe(200);
      expect(data).toHaveProperty('issues');
      expect(data.plan_id).toBe(bdiPlanId);
    });

    it('Step 8: Knowledge-gaps includes goal_type', async () => {
      const { data } = await api(`/goals/${bdiGoalId}/knowledge-gaps`);
      // goal_type is present in all knowledge-gaps responses
      expect(data).toHaveProperty('goal_type');
    });

    it('Step 9: Portfolio shows the full graph', async () => {
      // Brief pause to avoid rate limiting from rapid requests
      await new Promise(r => setTimeout(r, 1000));
      const { status, data } = await api(`/goals/${bdiGoalId}/portfolio`);
      expect(status).toBe(200);
      expect(data.goal.goal_type).toBe('intention');
      expect(data.stats.linked_plan_count).toBeGreaterThanOrEqual(1);
    });

    it('Step 10: Stop the loop and verify final state', async () => {
      const { data: stopResult } = await api(`/plans/${bdiPlanId}/knowledge-loop/stop`, { method: 'POST' });
      expect(stopResult.status).toBe('stopped');
      expect(stopResult.iterations_completed).toBe(2);

      // Verify quality was persisted to the plan
      const { data: plan } = await api(`/plans/${bdiPlanId}`);
      expect(plan.quality_score).toBe(0.72);
    });
  });
});

// ─── Helpers ─────────────────────────────────────────────────────

/** Flatten a node tree into a flat array */
function flattenTree(nodes) {
  const result = [];
  for (const n of nodes) {
    result.push(n);
    if (n.children) result.push(...flattenTree(n.children));
  }
  return result;
}
