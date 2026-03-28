/**
 * Docker Smoke Test — self-hosting validation
 *
 * Validates that a fresh docker-compose environment works end-to-end.
 * Run after: docker compose -f docker-compose.local.yml up --build -d
 *
 * Requires: Docker stack running on localhost (API:3000, Frontend:3001)
 * Run: API_URL=http://localhost:3000 npm run test:e2e -- docker-smoke
 */
const axios = require('axios');

const API_URL = process.env.API_URL || 'http://localhost:3000';
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3001';
const api = axios.create({ baseURL: API_URL, timeout: 15000 });

describe('Docker Smoke Test: Self-Hosting Validation', () => {
  // ── Health Checks ────────────────────────────────────

  it('should have healthy API', async () => {
    const res = await api.get('/health');
    expect(res.status).toBe(200);
    expect(res.data.status).toBe('ok');
  });

  it('should have healthy database', async () => {
    const res = await api.get('/health');
    expect(res.data.database).toBeTruthy();
  });

  it('should serve frontend', async () => {
    const res = await axios.get(FRONTEND_URL, { timeout: 10000 });
    expect(res.status).toBe(200);
    expect(res.data).toContain('Agent Planner');
  });

  it('should serve API docs', async () => {
    const res = await api.get('/api-docs/');
    expect(res.status).toBe(200);
  });

  // ── Core Flow ────────────────────────────────────────

  let token = null;
  let planId = null;

  it('should register a user', async () => {
    const email = `smoke-${Date.now()}@test.local`;
    const res = await api.post('/auth/register', {
      email,
      password: 'SmokeTest123!',
      name: 'Smoke Test',
    });
    expect(res.status).toBe(201);
    token = res.data.access_token || res.data.token;
    expect(token).toBeTruthy();
  });

  it('should create a plan', async () => {
    const res = await api.post('/plans', {
      title: 'Smoke Test Plan',
      status: 'active',
    }, { headers: { Authorization: `Bearer ${token}` } });
    expect(res.status).toBe(201);
    planId = res.data.id;
  });

  it('should create a task', async () => {
    const res = await api.post(`/plans/${planId}/nodes`, {
      node_type: 'task',
      title: 'Smoke Task',
    }, { headers: { Authorization: `Bearer ${token}` } });
    expect(res.status).toBe(201);
  });

  it('should list nodes', async () => {
    const res = await api.get(`/plans/${planId}/nodes`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    expect(Array.isArray(res.data)).toBe(true);
  });

  it('should complete a task', async () => {
    const nodesRes = await api.get(`/plans/${planId}/nodes?flat=true`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const task = nodesRes.data.find(n => n.node_type === 'task');
    expect(task).toBeTruthy();

    const res = await api.put(`/plans/${planId}/nodes/${task.id}/status`, {
      status: 'completed',
    }, { headers: { Authorization: `Bearer ${token}` } });
    expect(res.status).toBe(200);
  });

  // ── Cleanup ──────────────────────────────────────────

  it('should delete the plan', async () => {
    const res = await api.delete(`/plans/${planId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(204);
  });
});
