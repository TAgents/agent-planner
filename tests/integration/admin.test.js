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
  { id: uuidv4(), userId: mockAdminId, action: 'plan.create', resourceType: 'plan', resourceId: uuidv4(), details: {}, createdAt: new Date().toISOString() },
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
    listRecent: jest.fn().mockResolvedValue(mockAuditRows),
  },
  toolCallsDal: {
    listRecentAll: jest.fn().mockResolvedValue(mockToolCallRows),
  },
  rawSql: jest.fn(async () => mockOrgSql),
}));

jest.mock('../../src/utils/logger', () => ({
  api: jest.fn(), error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn(), auth: jest.fn(),
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
  });

  it('returns recent tool calls for an admin when type=tools', async () => {
    const res = await request(app)
      .get('/admin/activity?type=tools&limit=10')
      .set('Authorization', `Bearer ${signJwt(mockAdminId)}`)
      .expect(200);

    expect(res.body.type).toBe('tools');
    expect(res.body.entries[0].toolName).toBe('queue_decision');
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
