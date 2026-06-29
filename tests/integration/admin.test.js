/**
 * Integration Tests — Admin activity feed (/admin/activity)
 *
 * Verifies the new system-wide activity endpoint:
 *  - 401 without auth
 *  - 403 for a non-admin user (requireAdmin)
 *  - 200 + audit entries for an admin (type=audit, the default)
 *  - 200 + tool-call entries for an admin (type=tools)
 *
 * All DAL calls are mocked — no database required.
 * NOTE: shared fixtures are `mock`-prefixed so jest allows them inside the
 * (hoisted) jest.mock factory.
 */

const TEST_SECRET = 'test-secret-for-admin-tests';
process.env.JWT_SECRET = TEST_SECRET;

const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');

// ── Shared fixtures (mock-prefixed for jest.mock hoisting) ───────────────────

const mockAdminId = uuidv4();
const mockNonAdminId = uuidv4();

const mockAuditRows = [
  { id: uuidv4(), userId: mockAdminId, action: 'plan.create', resourceType: 'plan', resourceId: uuidv4(), details: { title: 'New plan', visibility: 'private' }, createdAt: new Date().toISOString() },
];
const mockToolCallRows = [
  { id: uuidv4(), tokenId: uuidv4(), organizationId: uuidv4(), toolName: 'queue_decision', clientLabel: 'cli', responseStatus: 200, durationMs: 42, createdAt: new Date().toISOString() },
];

// Org fixtures + a tagged-template stub for dal.rawSql(). The /admin/organizations
// handlers run raw SQL via `const sql = await dal.rawSql()` then `sql\`...\``, so the
// stub inspects the query text to return list rows vs. the count row, and narrows the
// result set when the filtered (ILIKE) variant runs.
const mockOrgRows = [
  { id: uuidv4(), name: 'Acme', slug: 'acme', is_personal: false, created_at: new Date().toISOString(), member_count: 3, workspace_count: 2, plan_count: 5 },
  { id: uuidv4(), name: 'Personal Org', slug: 'personal-z9', is_personal: true, created_at: new Date().toISOString(), member_count: 1, workspace_count: 1, plan_count: 0 },
];

// Detail fixtures for GET /admin/organizations/:orgId (org row + members + workspaces).
const mockOrgDetailId = uuidv4();
const mockMissingOrgId = uuidv4();
const mockOrgDetailRow = { id: mockOrgDetailId, name: 'Acme', slug: 'acme', description: 'The Acme org', is_personal: false, created_at: new Date().toISOString(), member_count: 2, workspace_count: 1, plan_count: 5 };
const mockOrgMembers = [
  { id: uuidv4(), email: 'owner@acme.test', name: 'Owner', is_admin: false, role: 'owner', joined_at: new Date().toISOString() },
  { id: uuidv4(), email: 'member@acme.test', name: 'Member', is_admin: false, role: 'member', joined_at: new Date().toISOString() },
];
const mockOrgWorkspaces = [
  { id: uuidv4(), title: 'Default', slug: 'default', is_default: true, archived_at: null, created_at: new Date().toISOString(), owner_id: uuidv4(), plan_count: 5 },
];

// Plans-list fixtures (flat rows as returned by the SELECT; handler nests them).
// Row 2 has a null org to exercise the organization:null branch.
const mockPlanRows = [
  { id: uuidv4(), title: 'Alpha Plan', status: 'active', visibility: 'private', updated_at: new Date().toISOString(), owner_id: uuidv4(), owner_email: 'a@x.test', owner_name: 'A', org_id: uuidv4(), org_name: 'Org A', ws_id: uuidv4(), ws_title: 'Default', node_count: 10, completed_count: 4 },
  { id: uuidv4(), title: 'Beta Plan', status: 'draft', visibility: 'public', updated_at: new Date().toISOString(), owner_id: uuidv4(), owner_email: 'b@x.test', owner_name: 'B', org_id: null, org_name: null, ws_id: uuidv4(), ws_title: 'WS', node_count: 0, completed_count: 0 },
];

// Plan-detail fixtures (org row + linked goals + collaborators + node breakdown).
const mockPlanDetailId = uuidv4();
const mockMissingPlanId = uuidv4();
const mockPlanDetailRow = { id: mockPlanDetailId, title: 'Detail Plan', description: 'A plan to inspect', status: 'active', visibility: 'private', created_at: new Date().toISOString(), updated_at: new Date().toISOString(), owner_id: uuidv4(), owner_email: 'o@x.test', owner_name: 'O', org_id: uuidv4(), org_name: 'Org', ws_id: uuidv4(), ws_title: 'Default' };
const mockPlanGoals = [{ id: uuidv4(), title: 'Goal A', status: 'active' }];
const mockPlanCollabs = [{ id: uuidv4(), email: 'collab@x.test', name: 'Collab', role: 'editor', created_at: new Date().toISOString() }];
const mockNodeBreakdown = [{ status: 'completed', count: 3 }, { status: 'not_started', count: 2 }];

// Tool-call stats fixtures (GET /admin/activity/tools/stats).
const mockToolStatsTotals = { total: 100, errors: 5, p95_ms: 250 };
const mockToolStatsByTool = [
  { tool_name: 'queue_decision', count: 40, errors: 3, p95_ms: 300 },
  { tool_name: 'claim_next_task', count: 60, errors: 2, p95_ms: 120 },
];
const mockToolStatsByStatus = [
  { response_status: 200, count: 95 },
  { response_status: 500, count: 5 },
];

function mockOrgSql(strings, ...values) {
  const text = strings.join(' ');
  // Detail: organization row (by id) — empty array drives the 404 path.
  if (/FROM organizations o/i.test(text) && /WHERE o\.id/i.test(text)) {
    return Promise.resolve(values[0] === mockMissingOrgId ? [] : [mockOrgDetailRow]);
  }
  // Detail: members
  if (/FROM organization_members m/i.test(text) && /JOIN users/i.test(text)) {
    return Promise.resolve(mockOrgMembers);
  }
  // Detail: workspaces
  if (/FROM workspaces w/i.test(text) && /WHERE w\.organization_id/i.test(text)) {
    return Promise.resolve(mockOrgWorkspaces);
  }
  // Plan detail: single plan by id — empty array drives the 404 path.
  if (/FROM plans p/i.test(text) && /WHERE p\.id/i.test(text)) {
    return Promise.resolve(values[0] === mockMissingPlanId ? [] : [mockPlanDetailRow]);
  }
  // Plans list (q value narrows the result) vs. plans count.
  if (/FROM plans p/i.test(text) && /ORDER BY p\.updated_at/i.test(text)) {
    return Promise.resolve(values[0] ? [mockPlanRows[0]] : mockPlanRows);
  }
  if (/FROM plans p/i.test(text)) {
    return Promise.resolve([{ count: values[0] ? 1 : mockPlanRows.length }]);
  }
  // Tool-call stats aggregates (grouped variants before the totals catch-all).
  if (/FROM tool_calls/i.test(text) && /GROUP BY tool_name/i.test(text)) return Promise.resolve(mockToolStatsByTool);
  if (/FROM tool_calls/i.test(text) && /GROUP BY response_status/i.test(text)) return Promise.resolve(mockToolStatsByStatus);
  if (/FROM tool_calls/i.test(text)) return Promise.resolve([mockToolStatsTotals]);
  // Plan-detail sub-queries.
  if (/FROM goal_links gl/i.test(text)) return Promise.resolve(mockPlanGoals);
  if (/FROM plan_collaborators pc/i.test(text)) return Promise.resolve(mockPlanCollabs);
  if (/FROM plan_nodes/i.test(text) && /GROUP BY status/i.test(text)) return Promise.resolve(mockNodeBreakdown);
  // List: count row vs. rows; ILIKE variant is the q= filtered query.
  const filtered = /ILIKE/i.test(text);
  if (/count\(\*\)/i.test(text)) {
    return Promise.resolve([{ count: filtered ? 1 : mockOrgRows.length }]);
  }
  return Promise.resolve(filtered ? [mockOrgRows[0]] : mockOrgRows);
}

// ── Mocks ──────────────────────────────────────────────────────────────────

jest.mock('../../src/db/dal.cjs', () => ({
  usersDal: {
    // requireAdmin re-fetches the user; isAdmin decided by id.
    findById: jest.fn(async (id) => ({ id, isAdmin: id === mockAdminId })),
  },
  organizationsDal: {
    listForUser: jest.fn().mockResolvedValue([]),
  },
  auditDal: {
    listRecent: jest.fn().mockResolvedValue({ entries: mockAuditRows, total: mockAuditRows.length }),
  },
  toolCallsDal: {
    listRecentAll: jest.fn().mockResolvedValue({ entries: mockToolCallRows, total: mockToolCallRows.length }),
  },
  rawSql: jest.fn(async () => mockOrgSql),
}));

jest.mock('../../src/utils/logger', () => ({
  api: jest.fn(), error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn(), auth: jest.fn(),
}));

jest.mock('../../src/services/graphitiBridge', () => ({
  getStatus: jest.fn().mockResolvedValue({ available: true }),
}));

// ── App under test ───────────────────────────────────────────────────────────

const adminRoutes = require('../../src/routes/admin.routes');

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/admin', adminRoutes);
  return app;
}

function signJwt(sub) {
  return jwt.sign({ sub, type: 'access' }, TEST_SECRET, { expiresIn: '1h' });
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('GET /admin/activity', () => {
  const app = makeApp();

  it('returns 401 without authentication', async () => {
    await request(app).get('/admin/activity').expect(401);
  });

  it('returns 403 for a non-admin user', async () => {
    await request(app)
      .get('/admin/activity')
      .set('Authorization', `Bearer ${signJwt(mockNonAdminId)}`)
      .expect(403);
  });

  it('returns recent audit entries for an admin (default type)', async () => {
    const res = await request(app)
      .get('/admin/activity')
      .set('Authorization', `Bearer ${signJwt(mockAdminId)}`)
      .expect(200);

    expect(res.body.type).toBe('audit');
    expect(Array.isArray(res.body.entries)).toBe(true);
    expect(res.body.entries).toHaveLength(mockAuditRows.length);
    expect(res.body.entries[0].action).toBe('plan.create');
    // The audit details jsonb is surfaced for the expandable activity panel.
    expect(res.body.entries[0].details).toEqual({ title: 'New plan', visibility: 'private' });
  });

  it('returns recent tool calls for an admin when type=tools', async () => {
    const res = await request(app)
      .get('/admin/activity?type=tools&limit=10')
      .set('Authorization', `Bearer ${signJwt(mockAdminId)}`)
      .expect(200);

    expect(res.body.type).toBe('tools');
    expect(res.body.entries[0].toolName).toBe('queue_decision');
  });

  it('passes audit filters + pagination through to the DAL and returns total', async () => {
    // eslint-disable-next-line global-require
    const dal = require('../../src/db/dal.cjs');
    const res = await request(app)
      .get('/admin/activity?action=plan.create&since=2026-01-01T00:00:00Z&limit=5&offset=10')
      .set('Authorization', `Bearer ${signJwt(mockAdminId)}`)
      .expect(200);

    const args = dal.auditDal.listRecent.mock.calls[dal.auditDal.listRecent.mock.calls.length - 1][0];
    expect(args).toMatchObject({ action: 'plan.create', since: '2026-01-01T00:00:00Z', limit: 5, offset: 10 });
    expect(res.body.total).toBe(mockAuditRows.length);
    expect(res.body.offset).toBe(10);
  });

  it('passes tool-call filters through to the DAL', async () => {
    // eslint-disable-next-line global-require
    const dal = require('../../src/db/dal.cjs');
    await request(app)
      .get('/admin/activity?type=tools&toolName=queue_decision&responseStatus=500&until=2026-12-31T00:00:00Z')
      .set('Authorization', `Bearer ${signJwt(mockAdminId)}`)
      .expect(200);

    const args = dal.toolCallsDal.listRecentAll.mock.calls[dal.toolCallsDal.listRecentAll.mock.calls.length - 1][0];
    expect(args).toMatchObject({ toolName: 'queue_decision', responseStatus: 500, until: '2026-12-31T00:00:00Z' });
  });
});

describe('GET /admin/organizations', () => {
  const app = makeApp();

  it('returns 401 without authentication', async () => {
    await request(app).get('/admin/organizations').expect(401);
  });

  it('returns 403 for a non-admin user', async () => {
    await request(app)
      .get('/admin/organizations')
      .set('Authorization', `Bearer ${signJwt(mockNonAdminId)}`)
      .expect(403);
  });

  it('returns the org list with counts + total for an admin', async () => {
    const res = await request(app)
      .get('/admin/organizations')
      .set('Authorization', `Bearer ${signJwt(mockAdminId)}`)
      .expect(200);

    expect(Array.isArray(res.body.organizations)).toBe(true);
    expect(res.body.organizations).toHaveLength(mockOrgRows.length);
    expect(res.body.total).toBe(mockOrgRows.length);
    const o = res.body.organizations[0];
    expect(o).toHaveProperty('member_count');
    expect(o).toHaveProperty('workspace_count');
    expect(o).toHaveProperty('plan_count');
  });

  it('narrows the result set when q= is provided', async () => {
    const res = await request(app)
      .get('/admin/organizations?q=acme')
      .set('Authorization', `Bearer ${signJwt(mockAdminId)}`)
      .expect(200);

    expect(res.body.organizations).toHaveLength(1);
    expect(res.body.total).toBe(1);
  });

  it('echoes pagination params (limit/offset)', async () => {
    const res = await request(app)
      .get('/admin/organizations?limit=5&offset=10')
      .set('Authorization', `Bearer ${signJwt(mockAdminId)}`)
      .expect(200);

    expect(res.body.limit).toBe(5);
    expect(res.body.offset).toBe(10);
  });
});

describe('GET /admin/organizations/:orgId', () => {
  const app = makeApp();

  it('returns 401 without authentication', async () => {
    await request(app).get(`/admin/organizations/${mockOrgDetailId}`).expect(401);
  });

  it('returns 403 for a non-admin user', async () => {
    await request(app)
      .get(`/admin/organizations/${mockOrgDetailId}`)
      .set('Authorization', `Bearer ${signJwt(mockNonAdminId)}`)
      .expect(403);
  });

  it('returns org detail with members + workspaces for an admin', async () => {
    const res = await request(app)
      .get(`/admin/organizations/${mockOrgDetailId}`)
      .set('Authorization', `Bearer ${signJwt(mockAdminId)}`)
      .expect(200);

    expect(res.body.organization.id).toBe(mockOrgDetailId);
    expect(res.body.organization).toHaveProperty('description');
    expect(res.body.members).toHaveLength(mockOrgMembers.length);
    expect(res.body.members[0].role).toBe('owner');
    expect(res.body.workspaces).toHaveLength(mockOrgWorkspaces.length);
    expect(res.body.workspaces[0]).toHaveProperty('plan_count');
  });

  it('returns 404 for an unknown orgId', async () => {
    await request(app)
      .get(`/admin/organizations/${mockMissingOrgId}`)
      .set('Authorization', `Bearer ${signJwt(mockAdminId)}`)
      .expect(404);
  });
});

describe('GET /admin/plans', () => {
  const app = makeApp();

  it('returns 401 without authentication', async () => {
    await request(app).get('/admin/plans').expect(401);
  });

  it('returns 403 for a non-admin user', async () => {
    await request(app)
      .get('/admin/plans')
      .set('Authorization', `Bearer ${signJwt(mockNonAdminId)}`)
      .expect(403);
  });

  it('returns the plan list with nested owner/org/workspace + node rollup + total', async () => {
    const res = await request(app)
      .get('/admin/plans')
      .set('Authorization', `Bearer ${signJwt(mockAdminId)}`)
      .expect(200);

    expect(res.body.plans).toHaveLength(mockPlanRows.length);
    expect(res.body.total).toBe(mockPlanRows.length);
    const p = res.body.plans[0];
    expect(p.owner).toEqual({ id: mockPlanRows[0].owner_id, email: 'a@x.test', name: 'A' });
    expect(p.organization).toEqual({ id: mockPlanRows[0].org_id, name: 'Org A' });
    expect(p.workspace).toEqual({ id: mockPlanRows[0].ws_id, title: 'Default' });
    expect(p.node_count).toBe(10);
    expect(p.completed_count).toBe(4);
    // Row 2 has no org → organization is null.
    expect(res.body.plans[1].organization).toBeNull();
  });

  it('narrows the result set when q= is provided', async () => {
    const res = await request(app)
      .get('/admin/plans?q=alpha')
      .set('Authorization', `Bearer ${signJwt(mockAdminId)}`)
      .expect(200);

    expect(res.body.plans).toHaveLength(1);
    expect(res.body.total).toBe(1);
  });

  it('echoes pagination params (limit/offset)', async () => {
    const res = await request(app)
      .get('/admin/plans?limit=10&offset=20')
      .set('Authorization', `Bearer ${signJwt(mockAdminId)}`)
      .expect(200);

    expect(res.body.limit).toBe(10);
    expect(res.body.offset).toBe(20);
  });
});

describe('GET /admin/plans/:planId', () => {
  const app = makeApp();

  it('returns 401 without authentication', async () => {
    await request(app).get(`/admin/plans/${mockPlanDetailId}`).expect(401);
  });

  it('returns 403 for a non-admin user', async () => {
    await request(app)
      .get(`/admin/plans/${mockPlanDetailId}`)
      .set('Authorization', `Bearer ${signJwt(mockNonAdminId)}`)
      .expect(403);
  });

  it('returns plan detail with goals, collaborators, and node breakdown', async () => {
    const res = await request(app)
      .get(`/admin/plans/${mockPlanDetailId}`)
      .set('Authorization', `Bearer ${signJwt(mockAdminId)}`)
      .expect(200);

    expect(res.body.plan.id).toBe(mockPlanDetailId);
    expect(res.body.plan).toHaveProperty('description');
    expect(res.body.plan.owner).toEqual({ id: mockPlanDetailRow.owner_id, email: 'o@x.test', name: 'O' });
    expect(res.body.plan.organization).toEqual({ id: mockPlanDetailRow.org_id, name: 'Org' });
    expect(res.body.plan.workspace).toEqual({ id: mockPlanDetailRow.ws_id, title: 'Default' });
    expect(res.body.goals).toHaveLength(1);
    expect(res.body.goals[0].title).toBe('Goal A');
    expect(res.body.collaborators[0].role).toBe('editor');
    expect(res.body.node_breakdown).toEqual(mockNodeBreakdown);
  });

  it('returns 404 for an unknown planId', async () => {
    await request(app)
      .get(`/admin/plans/${mockMissingPlanId}`)
      .set('Authorization', `Bearer ${signJwt(mockAdminId)}`)
      .expect(404);
  });
});

describe('GET /admin/health', () => {
  const app = makeApp();
  // eslint-disable-next-line global-require
  const graphitiBridge = require('../../src/services/graphitiBridge');
  const ORIGINAL_KEY = process.env.OPENAI_API_KEY;

  afterEach(() => {
    if (ORIGINAL_KEY === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = ORIGINAL_KEY;
    graphitiBridge.getStatus.mockResolvedValue({ available: true });
  });

  it('returns 401 without authentication', async () => {
    await request(app).get('/admin/health').expect(401);
  });

  it('returns 403 for a non-admin user', async () => {
    await request(app)
      .get('/admin/health')
      .set('Authorization', `Bearer ${signJwt(mockNonAdminId)}`)
      .expect(403);
  });

  it('returns ok with all subsystem checks green', async () => {
    process.env.OPENAI_API_KEY = 'sk-test';
    graphitiBridge.getStatus.mockResolvedValue({ available: true });

    const res = await request(app)
      .get('/admin/health')
      .set('Authorization', `Bearer ${signJwt(mockAdminId)}`)
      .expect(200);

    expect(res.body.status).toBe('ok');
    expect(res.body.checks.database.ok).toBe(true);
    expect(res.body.checks.graphiti.ok).toBe(true);
    expect(res.body.checks.openai_key.configured).toBe(true);
    expect(res.body.version).toBeTruthy();
  });

  it('reports degraded + surfaces the silent-fail when OPENAI_API_KEY is missing', async () => {
    delete process.env.OPENAI_API_KEY;
    graphitiBridge.getStatus.mockResolvedValue({ available: true });

    const res = await request(app)
      .get('/admin/health')
      .set('Authorization', `Bearer ${signJwt(mockAdminId)}`)
      .expect(200);

    expect(res.body.status).toBe('degraded');
    expect(res.body.checks.openai_key.configured).toBe(false);
    expect(res.body.checks.openai_key.detail).toMatch(/no-op/i);
  });

  it('reports degraded when Graphiti is unreachable', async () => {
    process.env.OPENAI_API_KEY = 'sk-test';
    graphitiBridge.getStatus.mockResolvedValue({ available: false });

    const res = await request(app)
      .get('/admin/health')
      .set('Authorization', `Bearer ${signJwt(mockAdminId)}`)
      .expect(200);

    expect(res.body.status).toBe('degraded');
    expect(res.body.checks.graphiti.ok).toBe(false);
  });
});

describe('GET /admin/activity/tools/stats', () => {
  const app = makeApp();

  it('returns 401 without authentication', async () => {
    await request(app).get('/admin/activity/tools/stats').expect(401);
  });

  it('returns 403 for a non-admin user', async () => {
    await request(app)
      .get('/admin/activity/tools/stats')
      .set('Authorization', `Bearer ${signJwt(mockNonAdminId)}`)
      .expect(403);
  });

  it('returns totals (with error_rate), by_tool, and by_status', async () => {
    const res = await request(app)
      .get('/admin/activity/tools/stats')
      .set('Authorization', `Bearer ${signJwt(mockAdminId)}`)
      .expect(200);

    expect(res.body.totals.total).toBe(100);
    expect(res.body.totals.errors).toBe(5);
    expect(res.body.totals.error_rate).toBeCloseTo(0.05);
    expect(res.body.totals.p95_ms).toBe(250);
    expect(res.body.by_tool).toHaveLength(2);
    expect(res.body.by_tool[0].tool_name).toBe('queue_decision');
    expect(res.body.by_tool[0].error_rate).toBeCloseTo(3 / 40);
    expect(res.body.by_status).toEqual(mockToolStatsByStatus);
  });
});
