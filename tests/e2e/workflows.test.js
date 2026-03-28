/**
 * E2E Workflow Test — full human + agent workflow
 *
 * Tests the complete flow against a running API:
 * register → create plan → add tasks → RPI chain → update status →
 * request agent → add log → resolve decision → verify completion
 *
 * Requires: API running on API_URL (default http://localhost:3000)
 * Run: API_URL=http://localhost:3000 npm run test:e2e
 */
const axios = require('axios');

const API_URL = process.env.API_URL || 'http://localhost:3000';
const api = axios.create({ baseURL: API_URL, timeout: 10000 });

// Test user credentials — created fresh each run
const testEmail = `e2e-${Date.now()}@test.local`;
const testPassword = 'TestPass123!';
let token = null;
let userId = null;
let planId = null;
let rootNodeId = null;
let taskId = null;
let rpiChain = null;

const auth = () => ({ headers: { Authorization: `Bearer ${token}` } });

describe('E2E: Full Human + Agent Workflow', () => {
  // ── Setup ────────────────────────────────────────────

  it('should check API health', async () => {
    const res = await api.get('/health');
    expect(res.status).toBe(200);
    expect(res.data.status).toBe('ok');
  });

  it('should register a new user', async () => {
    const res = await api.post('/auth/register', {
      email: testEmail,
      password: testPassword,
      name: 'E2E Test User',
    });
    expect(res.status).toBe(201);
    token = res.data.access_token || res.data.token;
    userId = res.data.user?.id || res.data.id;
    expect(token).toBeTruthy();
  });

  it('should get user profile', async () => {
    const res = await api.get('/auth/profile', auth());
    expect(res.status).toBe(200);
    expect(res.data.email).toBe(testEmail);
  });

  // ── Plan Creation ────────────────────────────────────

  it('should create a plan', async () => {
    const res = await api.post('/plans', {
      title: 'E2E Test Plan',
      description: 'Automated workflow test',
      status: 'active',
    }, auth());
    expect(res.status).toBe(201);
    planId = res.data.id;
    expect(planId).toBeTruthy();
  });

  it('should get the plan', async () => {
    const res = await api.get(`/plans/${planId}`, auth());
    expect(res.status).toBe(200);
    expect(res.data.title).toBe('E2E Test Plan');
  });

  // ── Node Operations ──────────────────────────────────

  it('should list nodes (root only initially)', async () => {
    const res = await api.get(`/plans/${planId}/nodes?include_root=true`, auth());
    expect(res.status).toBe(200);
    expect(Array.isArray(res.data)).toBe(true);
    // Find root node
    const flat = [];
    const flatten = (nodes) => {
      for (const n of nodes) {
        flat.push(n);
        if (n.children) flatten(n.children);
      }
    };
    flatten(res.data);
    const root = flat.find(n => n.node_type === 'root');
    expect(root).toBeTruthy();
    rootNodeId = root.id;
  });

  it('should create a task node', async () => {
    const res = await api.post(`/plans/${planId}/nodes`, {
      node_type: 'task',
      title: 'E2E Task 1',
      description: 'First task',
      parent_id: rootNodeId,
    }, auth());
    expect(res.status).toBe(201);
    taskId = res.data.id;
    expect(taskId).toBeTruthy();
  });

  it('should create an RPI chain', async () => {
    const res = await api.post(`/plans/${planId}/nodes/rpi-chain`, {
      title: 'Feature Research',
      description: 'Research → Plan → Implement',
      parent_id: rootNodeId,
    }, auth());
    expect(res.status).toBe(201);
    rpiChain = res.data;
    expect(rpiChain.chain.research).toBeTruthy();
    expect(rpiChain.chain.plan).toBeTruthy();
    expect(rpiChain.chain.implement).toBeTruthy();
    expect(rpiChain.dependencies).toHaveLength(2);
  });

  // ── Status Updates ───────────────────────────────────

  it('should update task status to in_progress', async () => {
    const res = await api.put(`/plans/${planId}/nodes/${taskId}/status`, {
      status: 'in_progress',
    }, auth());
    expect(res.status).toBe(200);
    expect(res.data.status).toBe('in_progress');
  });

  it('should complete the task', async () => {
    const res = await api.put(`/plans/${planId}/nodes/${taskId}/status`, {
      status: 'completed',
    }, auth());
    expect(res.status).toBe(200);
    expect(res.data.status).toBe('completed');
  });

  // ── Logs ─────────────────────────────────────────────

  it('should add a log entry', async () => {
    const res = await api.post(`/plans/${planId}/nodes/${taskId}/logs`, {
      content: 'E2E test completed successfully',
      log_type: 'progress',
    }, auth());
    expect(res.status).toBe(201);
    expect(res.data.content).toBe('E2E test completed successfully');
  });

  it('should get logs for the node', async () => {
    const res = await api.get(`/plans/${planId}/nodes/${taskId}/logs`, auth());
    expect(res.status).toBe(200);
    expect(Array.isArray(res.data)).toBe(true);
    expect(res.data.length).toBeGreaterThan(0);
  });

  // ── Agent Request ────────────────────────────────────

  it('should request agent assistance', async () => {
    const researchId = rpiChain.chain.research.id;
    const res = await api.post(`/plans/${planId}/nodes/${researchId}/request-agent`, {
      request_type: 'start',
      message: 'Please begin research',
    }, auth());
    expect(res.status).toBe(200);
    expect(res.data.agent_requested).toBeTruthy();
  });

  // ── Context & Ancestry ──────────────────────────────

  it('should get node context', async () => {
    const res = await api.get(`/plans/${planId}/nodes/${taskId}/context`, auth());
    expect(res.status).toBe(200);
    expect(res.data.node).toBeTruthy();
    expect(res.data.plan).toBeTruthy();
  });

  it('should get node ancestry', async () => {
    const res = await api.get(`/plans/${planId}/nodes/${taskId}/ancestry`, auth());
    expect(res.status).toBe(200);
    expect(res.data.ancestry).toBeTruthy();
    expect(res.data.ancestry.length).toBeGreaterThan(0);
  });

  // ── Plan Progress ────────────────────────────────────

  it('should show plan progress', async () => {
    const res = await api.get(`/plans/${planId}/progress`, auth());
    expect(res.status).toBe(200);
    expect(res.data.total).toBeGreaterThan(0);
    expect(res.data.completed).toBeGreaterThan(0);
  });

  // ── Cleanup ──────────────────────────────────────────

  it('should delete the plan', async () => {
    const res = await api.delete(`/plans/${planId}`, auth());
    expect(res.status).toBe(204);
  });
});
