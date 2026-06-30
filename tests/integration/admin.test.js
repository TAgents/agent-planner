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

// Plan task-tree fixtures (GET /admin/plans/:planId/nodes).
const mockPlanNodesList = [
  { id: uuidv4(), parent_id: null, node_type: 'phase', title: 'Phase 1', status: 'completed', order_index: 0, task_mode: 'free' },
  { id: uuidv4(), parent_id: uuidv4(), node_type: 'task', title: 'Task A', status: 'in_progress', order_index: 0, task_mode: 'implement' },
];

// Goal-detail fixtures (GET /admin/goals/:goalId).
const mockGoalId = uuidv4();
const mockMissingGoalId = uuidv4();
const mockGoalRow = { id: mockGoalId, title: 'Ship it', description: 'A goal', type: 'outcome', status: 'active', promoted_at: new Date().toISOString(), created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
const mockGoalPlans = [{ id: uuidv4(), title: 'Plan X', status: 'active', visibility: 'private', updated_at: new Date().toISOString() }];

// User-detail fixtures (GET /admin/users/:userId).
const mockUserDetailId = uuidv4();
const mockMissingUserId = uuidv4();
const mockUserDetailRow = { id: mockUserDetailId, email: 'u@detail.test', name: 'Detail User', is_admin: false, avatar_url: null, github_username: 'ghuser', github_profile_url: null, capability_tags: ['planner'], created_at: new Date().toISOString(), updated_at: new Date().toISOString(), plan_count: 2, collaboration_count: 1, organization_count: 1 };
const mockUserOwnedPlans = [{ id: uuidv4(), title: 'Owned Plan', status: 'active', visibility: 'private', updated_at: new Date().toISOString(), org_id: uuidv4(), org_name: 'Org A', node_count: 5, completed_count: 2 }];
const mockUserOrgs = [{ id: uuidv4(), name: 'Org A', slug: 'org-a', is_personal: false, role: 'owner', joined_at: new Date().toISOString() }];
const mockUserCollabs = [{ id: uuidv4(), title: 'Shared Plan', status: 'active', visibility: 'organization', role: 'editor', created_at: new Date().toISOString(), owner_name: 'Owner', owner_email: 'owner@x.test' }];
const mockUserActivity = [{ id: uuidv4(), action: 'plan.update', resource_type: 'plan', resource_id: uuidv4(), details: { field: 'title' }, created_at: new Date().toISOString() }];

// Legacy-endpoint fixtures (GET /admin/stats, GET /admin/users, PUT .../admin).
const mockStatsCounts = { total_users: 37, users_last_30d: 5, total_plans: 120, plans_last_30d: 12, total_nodes: 800, completed_nodes: 300, total_collaborators: 15, total_organizations: 9 };
const mockTopUsers = [{ id: uuidv4(), email: 'top@x.test', name: 'Top', plan_count: 12, created_at: new Date().toISOString() }];
const mockPlansByVisibility = [{ visibility: 'private', count: 80 }, { visibility: 'organization', count: 30 }, { visibility: 'public', count: 10 }];
const mockUsersList = [
  { id: uuidv4(), email: 'u1@x.test', name: 'U1', is_admin: false, github_username: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString(), plan_count: 3, collaboration_count: 1 },
  { id: uuidv4(), email: 'u2@x.test', name: null, is_admin: true, github_username: 'gh2', created_at: new Date().toISOString(), updated_at: new Date().toISOString(), plan_count: 0, collaboration_count: 0 },
];
const mockToggleUserId = uuidv4();

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

// Sentinel ids for org-mutation tests, driving the dispatcher's branches.
const mockMut = {
  ORG_OK: uuidv4(),
  ORG_MISSING: uuidv4(),
  ORG_SOLO_OWNER: uuidv4(),
  USER_OK: uuidv4(),
  USER_MISSING: uuidv4(),
  USER_DUPLICATE: uuidv4(),
  MEMBER_OWNER: uuidv4(),
  MEMBER_PLAIN: uuidv4(),
  MEMBER_MISSING: uuidv4(),
};

// API-token fixtures (GET /admin/tokens, /admin/tokens/:tokenId).
const mockTokenDetailId = uuidv4();
const mockMissingTokenId = uuidv4();
const mockTokenRows = [
  { id: uuidv4(), name: 'CLI token', permissions: ['read', 'write'], created_at: new Date().toISOString(), last_used: new Date().toISOString(), revoked: false, owner_id: uuidv4(), owner_email: 't@x.test', owner_name: 'T', org_id: uuidv4(), org_name: 'Org', call_count: 120, error_count: 3, last_call_at: new Date().toISOString() },
  { id: uuidv4(), name: 'Old token', permissions: ['read'], created_at: new Date().toISOString(), last_used: null, revoked: true, owner_id: uuidv4(), owner_email: 'o@x.test', owner_name: null, org_id: null, org_name: null, call_count: 0, error_count: 0, last_call_at: null },
];
const mockTokenDetailRow = { id: mockTokenDetailId, name: 'Detail token', permissions: ['read'], created_at: new Date().toISOString(), last_used: new Date().toISOString(), revoked: false, owner_id: uuidv4(), owner_email: 'd@x.test', owner_name: 'D', org_id: uuidv4(), org_name: 'Org' };
const mockTokenCalls = [{ id: uuidv4(), tool_name: 'claim_next_task', client_label: 'cli', response_status: 200, duration_ms: 40, created_at: new Date().toISOString() }];
const mockTokenByTool = [{ tool_name: 'claim_next_task', count: 50, errors: 1 }];

// Decision-queue fixtures (GET /admin/decisions, /admin/decisions/:decisionId).
const mockDecisionDetailId = uuidv4();
const mockMissingDecisionId = uuidv4();
const mockDecisionRows = [
  { id: uuidv4(), title: 'Pick auth lib', urgency: 'blocking', status: 'pending', created_at: new Date().toISOString(), expires_at: new Date().toISOString(), decided_at: null, requested_by_agent_name: 'planner-1', plan_id: uuidv4(), plan_title: 'Plan A', org_id: uuidv4(), org_name: 'Org', req_user_id: uuidv4(), req_user_email: 'r@x.test', req_user_name: 'R', dec_user_id: null, dec_user_email: null, dec_user_name: null },
  { id: uuidv4(), title: 'Ship?', urgency: 'can_continue', status: 'decided', created_at: new Date().toISOString(), expires_at: null, decided_at: new Date().toISOString(), requested_by_agent_name: null, plan_id: uuidv4(), plan_title: 'Plan B', org_id: null, org_name: null, req_user_id: uuidv4(), req_user_email: 'r2@x.test', req_user_name: null, dec_user_id: uuidv4(), dec_user_email: 'd@x.test', dec_user_name: 'D' },
];
const mockDecisionDetailRow = { id: mockDecisionDetailId, title: 'Pick auth lib', context: 'We need to choose an auth library', options: [{ option: 'JWT', pros: ['simple'], cons: [] }], urgency: 'blocking', status: 'pending', created_at: new Date().toISOString(), updated_at: new Date().toISOString(), expires_at: new Date().toISOString(), decision: null, rationale: null, decided_at: null, requested_by_agent_name: 'planner-1', plan_id: uuidv4(), plan_title: 'Plan A', node_id: uuidv4(), node_title: 'Auth task', org_id: uuidv4(), org_name: 'Org', req_user_id: uuidv4(), req_user_email: 'r@x.test', req_user_name: 'R', dec_user_id: null, dec_user_email: null, dec_user_name: null };

// Knowledge-oversight fixtures (GET /admin/knowledge).
const mockKnowledgeTotals = { distinct_episodes: 42, total_links: 130 };
const mockKnowledgeByType = [
  { link_type: 'informs', count: 80, episodes: 30 },
  { link_type: 'supports', count: 40, episodes: 18 },
  { link_type: 'contradicts', count: 10, episodes: 5 },
];
const mockKnowledgeByOrg = [
  { id: uuidv4(), name: 'Acme', episode_count: 30, link_count: 90, last_linked_at: new Date().toISOString(), plan_count: 5, node_count: 40 },
  { id: uuidv4(), name: 'Empty Co', episode_count: 0, link_count: 0, last_linked_at: null, plan_count: 3, node_count: 25 },
];

// Sentinel ids for plan-sharing tests (POST/PUT/DELETE collaborators).
const mockShare = {
  PLAN_OK: uuidv4(),
  PLAN_MISSING: uuidv4(),
  PLAN_NO_ORG: uuidv4(),
  OWNER_ID: uuidv4(),
  ORG_ID: uuidv4(),
  USER_MEMBER: uuidv4(),
  USER_NOT_MEMBER: uuidv4(),
  USER_MISSING: uuidv4(),
  USER_EXISTING_COLLAB: uuidv4(),
  COLLAB_PRESENT: uuidv4(),
  COLLAB_ABSENT: uuidv4(),
};

function mockOrgSql(strings, ...values) {
  const text = strings.join(' ');

  // --- Org mutations (write paths) ---
  if (/UPDATE organizations\b/i.test(text)) {
    const orgId = values[2]; // name, description, orgId
    return Promise.resolve(
      orgId === mockMut.ORG_MISSING ? [] : [{ id: orgId, name: values[0] || 'Renamed', slug: 'slug', description: values[1] ?? null, is_personal: false }],
    );
  }
  if (/SELECT id FROM organizations WHERE id/i.test(text)) {
    return Promise.resolve(values[0] === mockMut.ORG_MISSING ? [] : [{ id: values[0] }]);
  }
  if (/SELECT id FROM users WHERE id/i.test(text)) {
    return Promise.resolve(values[0] === mockMut.USER_MISSING ? [] : [{ id: values[0] }]);
  }
  if (/INSERT INTO organization_members/i.test(text)) {
    const [orgId, userId, role] = values;
    if (userId === mockMut.USER_DUPLICATE) {
      const e = new Error('duplicate key');
      e.code = '23505';
      throw e;
    }
    return Promise.resolve([{ id: 'm1', organization_id: orgId, user_id: userId, role, joined_at: new Date().toISOString() }]);
  }
  if (/SELECT role FROM organization_members WHERE organization_id/i.test(text)) {
    const userId = values[1];
    if (userId === mockMut.MEMBER_MISSING) return Promise.resolve([]);
    return Promise.resolve([{ role: userId === mockMut.MEMBER_OWNER ? 'owner' : 'member' }]);
  }
  if (/AS owners FROM organization_members/i.test(text)) {
    return Promise.resolve([{ owners: values[0] === mockMut.ORG_SOLO_OWNER ? 1 : 2 }]);
  }
  if (/UPDATE organization_members SET role/i.test(text)) {
    const [role, orgId, userId] = values;
    return Promise.resolve([{ id: 'm1', organization_id: orgId, user_id: userId, role }]);
  }
  if (/DELETE FROM organization_members/i.test(text)) {
    return Promise.resolve([]);
  }
  // --- User detail (GET /admin/users/:userId) ---
  // Ordered before the generic plan/org/collab rules so the distinctive WHERE
  // clauses win (the user row's subselects also mention `FROM plans p`, etc.).
  if (/FROM users u/i.test(text) && /WHERE u\.id/i.test(text)) {
    return Promise.resolve(values[0] === mockMissingUserId ? [] : [mockUserDetailRow]);
  }
  if (/FROM plans p/i.test(text) && /WHERE p\.owner_id/i.test(text)) {
    return Promise.resolve(mockUserOwnedPlans);
  }
  if (/FROM organization_members m/i.test(text) && /WHERE m\.user_id/i.test(text)) {
    return Promise.resolve(mockUserOrgs);
  }
  if (/FROM plan_collaborators pc/i.test(text) && /WHERE pc\.user_id/i.test(text)) {
    return Promise.resolve(mockUserCollabs);
  }
  if (/FROM audit_logs/i.test(text) && /WHERE user_id/i.test(text)) {
    return Promise.resolve(mockUserActivity);
  }
  // --- Plan sharing / collaborators (POST/PUT/DELETE .../collaborators) ---
  if (/owner_id, organization_id FROM plans WHERE id/i.test(text)) {
    const planId = values[0];
    if (planId === mockShare.PLAN_MISSING) return Promise.resolve([]);
    const organization_id = planId === mockShare.PLAN_NO_ORG ? null : mockShare.ORG_ID;
    return Promise.resolve([{ id: planId, owner_id: mockShare.OWNER_ID, organization_id }]);
  }
  if (/SELECT id, email, name FROM users WHERE id/i.test(text)) {
    return Promise.resolve(values[0] === mockShare.USER_MISSING ? [] : [{ id: values[0], email: 'shared@x.test', name: 'Shared' }]);
  }
  if (/AS ok FROM organization_members/i.test(text)) {
    return Promise.resolve(values[1] === mockShare.USER_NOT_MEMBER ? [] : [{ ok: 1 }]);
  }
  if (/SELECT role FROM plan_collaborators WHERE plan_id/i.test(text)) {
    return Promise.resolve(values[1] === mockShare.USER_EXISTING_COLLAB ? [{ role: 'viewer' }] : []);
  }
  if (/INSERT INTO plan_collaborators/i.test(text)) {
    const [planId, userId, role] = values;
    return Promise.resolve([{ id: 'pc1', plan_id: planId, user_id: userId, role, created_at: new Date().toISOString() }]);
  }
  if (/UPDATE plan_collaborators SET role/i.test(text)) {
    const [role, planId, userId] = values;
    return Promise.resolve(userId === mockShare.COLLAB_ABSENT ? [] : [{ id: 'pc1', plan_id: planId, user_id: userId, role }]);
  }
  if (/DELETE FROM plan_collaborators/i.test(text)) {
    return Promise.resolve(values[1] === mockShare.COLLAB_ABSENT ? [] : [{ id: 'pc1' }]);
  }
  // --- API token oversight (GET /admin/tokens, /tokens/:id) ---
  // Token-scoped tool_calls rules carry WHERE token_id, so they win before the
  // generic tool-stats rules further down (which have no token_id predicate).
  if (/FROM tool_calls/i.test(text) && /WHERE token_id/i.test(text) && /GROUP BY tool_name/i.test(text)) {
    return Promise.resolve(mockTokenByTool);
  }
  if (/FROM tool_calls/i.test(text) && /WHERE token_id/i.test(text) && /ORDER BY created_at/i.test(text)) {
    return Promise.resolve(mockTokenCalls);
  }
  if (/FROM api_tokens t/i.test(text) && /WHERE t\.id/i.test(text)) {
    return Promise.resolve(values[0] === mockMissingTokenId ? [] : [mockTokenDetailRow]);
  }
  if (/FROM api_tokens t/i.test(text) && /count\(\*\)::int AS count/i.test(text)) {
    return Promise.resolve([{ count: values[0] ? 1 : mockTokenRows.length }]);
  }
  if (/FROM api_tokens t/i.test(text) && /ORDER BY t\.last_used/i.test(text)) {
    return Promise.resolve(values[0] ? [mockTokenRows[0]] : mockTokenRows);
  }
  // --- Decision queue (GET /admin/decisions, /decisions/:id) ---
  if (/FROM decision_requests d/i.test(text) && /WHERE d\.id/i.test(text)) {
    return Promise.resolve(values[0] === mockMissingDecisionId ? [] : [mockDecisionDetailRow]);
  }
  if (/FROM decision_requests d/i.test(text) && /count\(\*\)::int AS count/i.test(text)) {
    return Promise.resolve([{ count: values[4] ? 1 : mockDecisionRows.length }]);
  }
  if (/FROM decision_requests d/i.test(text)) {
    return Promise.resolve(values[4] ? [mockDecisionRows[0]] : mockDecisionRows);
  }
  // --- Knowledge oversight (GET /admin/knowledge) ---
  if (/AS distinct_episodes/i.test(text)) {
    return Promise.resolve([mockKnowledgeTotals]);
  }
  if (/FROM episode_node_links/i.test(text) && /GROUP BY link_type/i.test(text)) {
    return Promise.resolve(mockKnowledgeByType);
  }
  if (/AS episode_count/i.test(text)) {
    return Promise.resolve(mockKnowledgeByOrg);
  }
  // --- System stats (GET /admin/stats) ---
  if (/AS total_users/i.test(text)) {
    return Promise.resolve([mockStatsCounts]);
  }
  if (/FROM users u/i.test(text) && /ORDER BY plan_count/i.test(text)) {
    return Promise.resolve(mockTopUsers);
  }
  if (/FROM plans\b/i.test(text) && /GROUP BY visibility/i.test(text)) {
    return Promise.resolve(mockPlansByVisibility);
  }
  // --- Users list (GET /admin/users) ---
  if (/FROM users u/i.test(text) && /ORDER BY u\.created_at/i.test(text)) {
    return Promise.resolve(mockUsersList);
  }
  if (/AS count FROM users\b/i.test(text)) {
    return Promise.resolve([{ count: mockUsersList.length }]);
  }
  // --- Admin grant/revoke toggle (PUT /admin/users/:userId/admin) ---
  if (/UPDATE users SET is_admin/i.test(text)) {
    const isAdmin = values[0];
    const userId = values[1];
    return Promise.resolve(
      userId === mockMissingUserId ? [] : [{ id: userId, email: 'toggled@x.test', name: 'Toggled', is_admin: isAdmin }],
    );
  }
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
  // Plan task tree (nodes endpoint) — ORDER BY order_index distinguishes it
  // from the breakdown (GROUP BY status) and the list's count subqueries.
  if (/FROM plan_nodes/i.test(text) && /ORDER BY order_index/i.test(text)) return Promise.resolve(mockPlanNodesList);
  // Goal detail + its connected plans (JOIN plans before the generic goal_links rule).
  if (/FROM goals WHERE id/i.test(text)) return Promise.resolve(values[0] === mockMissingGoalId ? [] : [mockGoalRow]);
  if (/FROM goal_links gl/i.test(text) && /JOIN plans/i.test(text)) return Promise.resolve(mockGoalPlans);
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
    log: jest.fn().mockResolvedValue({}),
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

describe('Org management mutations', () => {
  const app = makeApp();
  const adminAuth = `Bearer ${signJwt(mockAdminId)}`;
  const nonAdminAuth = `Bearer ${signJwt(mockNonAdminId)}`;

  describe('PATCH /admin/organizations/:orgId', () => {
    it('returns 403 for a non-admin user', () =>
      request(app).patch(`/admin/organizations/${mockMut.ORG_OK}`).set('Authorization', nonAdminAuth).send({ name: 'X' }).expect(403));

    it('renames an org (200)', async () => {
      const res = await request(app)
        .patch(`/admin/organizations/${mockMut.ORG_OK}`)
        .set('Authorization', adminAuth)
        .send({ name: 'New Name' })
        .expect(200);
      expect(res.body.name).toBe('New Name');
    });

    it('returns 404 for an unknown org', () =>
      request(app).patch(`/admin/organizations/${mockMut.ORG_MISSING}`).set('Authorization', adminAuth).send({ name: 'X' }).expect(404));

    it('returns 400 for an empty name', () =>
      request(app).patch(`/admin/organizations/${mockMut.ORG_OK}`).set('Authorization', adminAuth).send({ name: '   ' }).expect(400));
  });

  describe('POST /admin/organizations/:orgId/members', () => {
    it('returns 403 for a non-admin user', () =>
      request(app).post(`/admin/organizations/${mockMut.ORG_OK}/members`).set('Authorization', nonAdminAuth).send({ userId: mockMut.USER_OK }).expect(403));

    it('adds a member (201)', async () => {
      const res = await request(app)
        .post(`/admin/organizations/${mockMut.ORG_OK}/members`)
        .set('Authorization', adminAuth)
        .send({ userId: mockMut.USER_OK, role: 'member' })
        .expect(201);
      expect(res.body.user_id).toBe(mockMut.USER_OK);
      expect(res.body.role).toBe('member');
    });

    it('returns 400 for an invalid role', () =>
      request(app).post(`/admin/organizations/${mockMut.ORG_OK}/members`).set('Authorization', adminAuth).send({ userId: mockMut.USER_OK, role: 'superuser' }).expect(400));

    it('returns 404 for an unknown user', () =>
      request(app).post(`/admin/organizations/${mockMut.ORG_OK}/members`).set('Authorization', adminAuth).send({ userId: mockMut.USER_MISSING }).expect(404));

    it('returns 409 for a duplicate member', () =>
      request(app).post(`/admin/organizations/${mockMut.ORG_OK}/members`).set('Authorization', adminAuth).send({ userId: mockMut.USER_DUPLICATE }).expect(409));
  });

  describe('PUT /admin/organizations/:orgId/members/:userId', () => {
    it('changes a member role (200)', async () => {
      const res = await request(app)
        .put(`/admin/organizations/${mockMut.ORG_OK}/members/${mockMut.MEMBER_PLAIN}`)
        .set('Authorization', adminAuth)
        .send({ role: 'admin' })
        .expect(200);
      expect(res.body.role).toBe('admin');
    });

    it('blocks demoting the last owner (400)', () =>
      request(app).put(`/admin/organizations/${mockMut.ORG_SOLO_OWNER}/members/${mockMut.MEMBER_OWNER}`).set('Authorization', adminAuth).send({ role: 'member' }).expect(400));

    it('returns 404 for an unknown member', () =>
      request(app).put(`/admin/organizations/${mockMut.ORG_OK}/members/${mockMut.MEMBER_MISSING}`).set('Authorization', adminAuth).send({ role: 'admin' }).expect(404));
  });

  describe('DELETE /admin/organizations/:orgId/members/:userId', () => {
    it('removes a member (204)', () =>
      request(app).delete(`/admin/organizations/${mockMut.ORG_OK}/members/${mockMut.MEMBER_PLAIN}`).set('Authorization', adminAuth).expect(204));

    it('blocks removing the last owner (400)', () =>
      request(app).delete(`/admin/organizations/${mockMut.ORG_SOLO_OWNER}/members/${mockMut.MEMBER_OWNER}`).set('Authorization', adminAuth).expect(400));

    it('returns 404 for an unknown member', () =>
      request(app).delete(`/admin/organizations/${mockMut.ORG_OK}/members/${mockMut.MEMBER_MISSING}`).set('Authorization', adminAuth).expect(404));
  });
});

describe('GET /admin/plans/:planId/nodes', () => {
  const app = makeApp();

  it('returns 401 without authentication', async () => {
    await request(app).get(`/admin/plans/${mockPlanDetailId}/nodes`).expect(401);
  });

  it('returns 403 for a non-admin user', async () => {
    await request(app)
      .get(`/admin/plans/${mockPlanDetailId}/nodes`)
      .set('Authorization', `Bearer ${signJwt(mockNonAdminId)}`)
      .expect(403);
  });

  it('returns the plan node list for an admin', async () => {
    const res = await request(app)
      .get(`/admin/plans/${mockPlanDetailId}/nodes`)
      .set('Authorization', `Bearer ${signJwt(mockAdminId)}`)
      .expect(200);

    expect(res.body.nodes).toHaveLength(mockPlanNodesList.length);
    expect(res.body.nodes[0]).toHaveProperty('parent_id');
    expect(res.body.nodes[0]).toHaveProperty('node_type');
    expect(res.body.nodes[0].title).toBe('Phase 1');
  });
});

describe('GET /admin/goals/:goalId', () => {
  const app = makeApp();

  it('returns 401 without authentication', async () => {
    await request(app).get(`/admin/goals/${mockGoalId}`).expect(401);
  });

  it('returns 403 for a non-admin user', async () => {
    await request(app)
      .get(`/admin/goals/${mockGoalId}`)
      .set('Authorization', `Bearer ${signJwt(mockNonAdminId)}`)
      .expect(403);
  });

  it('returns the goal with its connected plans', async () => {
    const res = await request(app)
      .get(`/admin/goals/${mockGoalId}`)
      .set('Authorization', `Bearer ${signJwt(mockAdminId)}`)
      .expect(200);

    expect(res.body.goal.id).toBe(mockGoalId);
    expect(res.body.goal.committed).toBe(true);
    expect(res.body.plans).toHaveLength(1);
    expect(res.body.plans[0].title).toBe('Plan X');
  });

  it('returns 404 for an unknown goal', async () => {
    await request(app)
      .get(`/admin/goals/${mockMissingGoalId}`)
      .set('Authorization', `Bearer ${signJwt(mockAdminId)}`)
      .expect(404);
  });
});

describe('GET /admin/users/:userId', () => {
  const app = makeApp();

  it('returns 401 without authentication', async () => {
    await request(app).get(`/admin/users/${mockUserDetailId}`).expect(401);
  });

  it('returns 403 for a non-admin user', async () => {
    await request(app)
      .get(`/admin/users/${mockUserDetailId}`)
      .set('Authorization', `Bearer ${signJwt(mockNonAdminId)}`)
      .expect(403);
  });

  it('returns user detail with owned plans, orgs, collaborations, and activity', async () => {
    const res = await request(app)
      .get(`/admin/users/${mockUserDetailId}`)
      .set('Authorization', `Bearer ${signJwt(mockAdminId)}`)
      .expect(200);

    expect(res.body.user.id).toBe(mockUserDetailId);
    expect(res.body.user.email).toBe('u@detail.test');
    expect(res.body.user.capability_tags).toEqual(['planner']);
    expect(res.body.user.plan_count).toBe(2);
    // Owned plans nest organization (null-safe).
    expect(res.body.plans).toHaveLength(1);
    expect(res.body.plans[0].organization).toEqual({ id: mockUserOwnedPlans[0].org_id, name: 'Org A' });
    expect(res.body.organizations[0].role).toBe('owner');
    expect(res.body.collaborations[0].owner).toEqual({ name: 'Owner', email: 'owner@x.test' });
    // Audit rows are camel-cased for the activity list.
    expect(res.body.recent_activity[0].action).toBe('plan.update');
    expect(res.body.recent_activity[0].resourceType).toBe('plan');
  });

  it('returns 404 for an unknown userId', async () => {
    await request(app)
      .get(`/admin/users/${mockMissingUserId}`)
      .set('Authorization', `Bearer ${signJwt(mockAdminId)}`)
      .expect(404);
  });
});

describe('GET /admin/stats', () => {
  const app = makeApp();

  it('returns 401 without authentication', async () => {
    await request(app).get('/admin/stats').expect(401);
  });

  it('returns 403 for a non-admin user', async () => {
    await request(app)
      .get('/admin/stats')
      .set('Authorization', `Bearer ${signJwt(mockNonAdminId)}`)
      .expect(403);
  });

  it('returns system counts, top users, and plans-by-visibility for an admin', async () => {
    const res = await request(app)
      .get('/admin/stats')
      .set('Authorization', `Bearer ${signJwt(mockAdminId)}`)
      .expect(200);

    expect(res.body.counts).toEqual(mockStatsCounts);
    expect(res.body.users).toHaveLength(mockTopUsers.length);
    expect(res.body.users[0].plan_count).toBe(12);
    expect(res.body.plans_by_visibility).toEqual(mockPlansByVisibility);
    expect(res.body.generated_at).toBeTruthy();
  });
});

describe('GET /admin/users', () => {
  const app = makeApp();

  it('returns 401 without authentication', async () => {
    await request(app).get('/admin/users').expect(401);
  });

  it('returns 403 for a non-admin user', async () => {
    await request(app)
      .get('/admin/users')
      .set('Authorization', `Bearer ${signJwt(mockNonAdminId)}`)
      .expect(403);
  });

  it('returns the user list with per-user counts + total for an admin', async () => {
    const res = await request(app)
      .get('/admin/users')
      .set('Authorization', `Bearer ${signJwt(mockAdminId)}`)
      .expect(200);

    expect(res.body.users).toHaveLength(mockUsersList.length);
    expect(res.body.total).toBe(mockUsersList.length);
    const u = res.body.users[0];
    expect(u).toHaveProperty('plan_count');
    expect(u).toHaveProperty('collaboration_count');
    expect(u).toHaveProperty('is_admin');
  });

  it('echoes pagination params (limit/offset)', async () => {
    const res = await request(app)
      .get('/admin/users?limit=10&offset=20')
      .set('Authorization', `Bearer ${signJwt(mockAdminId)}`)
      .expect(200);

    expect(res.body.limit).toBe(10);
    expect(res.body.offset).toBe(20);
  });
});

describe('PUT /admin/users/:userId/admin', () => {
  const app = makeApp();
  const adminAuth = `Bearer ${signJwt(mockAdminId)}`;

  it('returns 403 for a non-admin user', () =>
    request(app)
      .put(`/admin/users/${mockToggleUserId}/admin`)
      .set('Authorization', `Bearer ${signJwt(mockNonAdminId)}`)
      .send({ is_admin: true })
      .expect(403));

  it('grants admin and returns the updated row (200)', async () => {
    const res = await request(app)
      .put(`/admin/users/${mockToggleUserId}/admin`)
      .set('Authorization', adminAuth)
      .send({ is_admin: true })
      .expect(200);
    expect(res.body.id).toBe(mockToggleUserId);
    expect(res.body.is_admin).toBe(true);
  });

  it('revokes admin and returns the updated row (200)', async () => {
    const res = await request(app)
      .put(`/admin/users/${mockToggleUserId}/admin`)
      .set('Authorization', adminAuth)
      .send({ is_admin: false })
      .expect(200);
    expect(res.body.is_admin).toBe(false);
  });

  it('blocks removing your own admin access (400)', () =>
    request(app)
      .put(`/admin/users/${mockAdminId}/admin`)
      .set('Authorization', adminAuth)
      .send({ is_admin: false })
      .expect(400));

  it('returns 400 when is_admin is not a boolean', () =>
    request(app)
      .put(`/admin/users/${mockToggleUserId}/admin`)
      .set('Authorization', adminAuth)
      .send({ is_admin: 'yes' })
      .expect(400));

  it('returns 404 for an unknown user', () =>
    request(app)
      .put(`/admin/users/${mockMissingUserId}/admin`)
      .set('Authorization', adminAuth)
      .send({ is_admin: true })
      .expect(404));
});

describe('Plan sharing (admin collaborators)', () => {
  const app = makeApp();
  const adminAuth = `Bearer ${signJwt(mockAdminId)}`;
  const nonAdminAuth = `Bearer ${signJwt(mockNonAdminId)}`;

  describe('POST /admin/plans/:planId/collaborators', () => {
    it('returns 403 for a non-admin user', () =>
      request(app)
        .post(`/admin/plans/${mockShare.PLAN_OK}/collaborators`)
        .set('Authorization', nonAdminAuth)
        .send({ userId: mockShare.USER_MEMBER })
        .expect(403));

    it('shares the plan with an org member (201)', async () => {
      const res = await request(app)
        .post(`/admin/plans/${mockShare.PLAN_OK}/collaborators`)
        .set('Authorization', adminAuth)
        .send({ userId: mockShare.USER_MEMBER, role: 'editor' })
        .expect(201);
      expect(res.body.user_id).toBe(mockShare.USER_MEMBER);
      expect(res.body.role).toBe('editor');
      expect(res.body.email).toBe('shared@x.test');
    });

    it('returns 400 for an invalid role', () =>
      request(app)
        .post(`/admin/plans/${mockShare.PLAN_OK}/collaborators`)
        .set('Authorization', adminAuth)
        .send({ userId: mockShare.USER_MEMBER, role: 'superuser' })
        .expect(400));

    it('returns 404 for an unknown plan', () =>
      request(app)
        .post(`/admin/plans/${mockShare.PLAN_MISSING}/collaborators`)
        .set('Authorization', adminAuth)
        .send({ userId: mockShare.USER_MEMBER })
        .expect(404));

    it('returns 404 for an unknown user', () =>
      request(app)
        .post(`/admin/plans/${mockShare.PLAN_OK}/collaborators`)
        .set('Authorization', adminAuth)
        .send({ userId: mockShare.USER_MISSING })
        .expect(404));

    it('blocks adding the plan owner as a collaborator (400)', () =>
      request(app)
        .post(`/admin/plans/${mockShare.PLAN_OK}/collaborators`)
        .set('Authorization', adminAuth)
        .send({ userId: mockShare.OWNER_ID })
        .expect(400));

    it('blocks sharing a plan that is not in an organization (400)', () =>
      request(app)
        .post(`/admin/plans/${mockShare.PLAN_NO_ORG}/collaborators`)
        .set('Authorization', adminAuth)
        .send({ userId: mockShare.USER_MEMBER })
        .expect(400));

    it('blocks sharing with a non-member of the plan org (400)', () =>
      request(app)
        .post(`/admin/plans/${mockShare.PLAN_OK}/collaborators`)
        .set('Authorization', adminAuth)
        .send({ userId: mockShare.USER_NOT_MEMBER })
        .expect(400));

    it('returns 409 when the user is already a collaborator', () =>
      request(app)
        .post(`/admin/plans/${mockShare.PLAN_OK}/collaborators`)
        .set('Authorization', adminAuth)
        .send({ userId: mockShare.USER_EXISTING_COLLAB })
        .expect(409));
  });

  describe('PUT /admin/plans/:planId/collaborators/:userId', () => {
    it('changes a collaborator role (200)', async () => {
      const res = await request(app)
        .put(`/admin/plans/${mockShare.PLAN_OK}/collaborators/${mockShare.COLLAB_PRESENT}`)
        .set('Authorization', adminAuth)
        .send({ role: 'admin' })
        .expect(200);
      expect(res.body.role).toBe('admin');
    });

    it('returns 400 for an invalid role', () =>
      request(app)
        .put(`/admin/plans/${mockShare.PLAN_OK}/collaborators/${mockShare.COLLAB_PRESENT}`)
        .set('Authorization', adminAuth)
        .send({ role: 'superuser' })
        .expect(400));

    it('returns 404 for a non-collaborator', () =>
      request(app)
        .put(`/admin/plans/${mockShare.PLAN_OK}/collaborators/${mockShare.COLLAB_ABSENT}`)
        .set('Authorization', adminAuth)
        .send({ role: 'editor' })
        .expect(404));
  });

  describe('DELETE /admin/plans/:planId/collaborators/:userId', () => {
    it('removes a collaborator (204)', () =>
      request(app)
        .delete(`/admin/plans/${mockShare.PLAN_OK}/collaborators/${mockShare.COLLAB_PRESENT}`)
        .set('Authorization', adminAuth)
        .expect(204));

    it('returns 404 for a non-collaborator', () =>
      request(app)
        .delete(`/admin/plans/${mockShare.PLAN_OK}/collaborators/${mockShare.COLLAB_ABSENT}`)
        .set('Authorization', adminAuth)
        .expect(404));
  });
});

describe('GET /admin/tokens', () => {
  const app = makeApp();

  it('returns 401 without authentication', async () => {
    await request(app).get('/admin/tokens').expect(401);
  });

  it('returns 403 for a non-admin user', async () => {
    await request(app)
      .get('/admin/tokens')
      .set('Authorization', `Bearer ${signJwt(mockNonAdminId)}`)
      .expect(403);
  });

  it('returns tokens with nested owner/org + usage rollup + total (never the hash)', async () => {
    const res = await request(app)
      .get('/admin/tokens')
      .set('Authorization', `Bearer ${signJwt(mockAdminId)}`)
      .expect(200);

    expect(res.body.tokens).toHaveLength(mockTokenRows.length);
    expect(res.body.total).toBe(mockTokenRows.length);
    const t = res.body.tokens[0];
    expect(t.owner).toEqual({ id: mockTokenRows[0].owner_id, email: 't@x.test', name: 'T' });
    expect(t.organization).toEqual({ id: mockTokenRows[0].org_id, name: 'Org' });
    expect(t.call_count).toBe(120);
    expect(t.error_count).toBe(3);
    expect(t).not.toHaveProperty('token_hash');
    expect(t).not.toHaveProperty('tokenHash');
    // Row 2 has no org → organization is null.
    expect(res.body.tokens[1].organization).toBeNull();
  });

  it('narrows the result set when q= is provided', async () => {
    const res = await request(app)
      .get('/admin/tokens?q=cli')
      .set('Authorization', `Bearer ${signJwt(mockAdminId)}`)
      .expect(200);

    expect(res.body.tokens).toHaveLength(1);
    expect(res.body.total).toBe(1);
  });

  it('echoes pagination params (limit/offset)', async () => {
    const res = await request(app)
      .get('/admin/tokens?limit=10&offset=20')
      .set('Authorization', `Bearer ${signJwt(mockAdminId)}`)
      .expect(200);

    expect(res.body.limit).toBe(10);
    expect(res.body.offset).toBe(20);
  });
});

describe('GET /admin/tokens/:tokenId', () => {
  const app = makeApp();

  it('returns 401 without authentication', async () => {
    await request(app).get(`/admin/tokens/${mockTokenDetailId}`).expect(401);
  });

  it('returns 403 for a non-admin user', async () => {
    await request(app)
      .get(`/admin/tokens/${mockTokenDetailId}`)
      .set('Authorization', `Bearer ${signJwt(mockNonAdminId)}`)
      .expect(403);
  });

  it('returns token detail with recent calls + by-tool breakdown', async () => {
    const res = await request(app)
      .get(`/admin/tokens/${mockTokenDetailId}`)
      .set('Authorization', `Bearer ${signJwt(mockAdminId)}`)
      .expect(200);

    expect(res.body.token.id).toBe(mockTokenDetailId);
    expect(res.body.token).not.toHaveProperty('token_hash');
    expect(res.body.token.owner.email).toBe('d@x.test');
    expect(res.body.recent_calls[0].toolName).toBe('claim_next_task');
    expect(res.body.by_tool[0]).toEqual({ tool_name: 'claim_next_task', count: 50, errors: 1 });
  });

  it('returns 404 for an unknown tokenId', async () => {
    await request(app)
      .get(`/admin/tokens/${mockMissingTokenId}`)
      .set('Authorization', `Bearer ${signJwt(mockAdminId)}`)
      .expect(404);
  });
});

describe('GET /admin/decisions', () => {
  const app = makeApp();

  it('returns 401 without authentication', async () => {
    await request(app).get('/admin/decisions').expect(401);
  });

  it('returns 403 for a non-admin user', async () => {
    await request(app)
      .get('/admin/decisions')
      .set('Authorization', `Bearer ${signJwt(mockNonAdminId)}`)
      .expect(403);
  });

  it('returns decisions with nested plan/org/requester/resolver + total', async () => {
    const res = await request(app)
      .get('/admin/decisions')
      .set('Authorization', `Bearer ${signJwt(mockAdminId)}`)
      .expect(200);

    expect(res.body.decisions).toHaveLength(mockDecisionRows.length);
    expect(res.body.total).toBe(mockDecisionRows.length);
    const d = res.body.decisions[0];
    expect(d.plan).toEqual({ id: mockDecisionRows[0].plan_id, title: 'Plan A' });
    expect(d.organization).toEqual({ id: mockDecisionRows[0].org_id, name: 'Org' });
    expect(d.requested_by.agentName).toBe('planner-1');
    // Row 2: no org + agent-less requester + a resolver.
    expect(res.body.decisions[1].organization).toBeNull();
    expect(res.body.decisions[1].decided_by.email).toBe('d@x.test');
  });

  it('narrows the result set when q= is provided', async () => {
    const res = await request(app)
      .get('/admin/decisions?q=auth')
      .set('Authorization', `Bearer ${signJwt(mockAdminId)}`)
      .expect(200);

    expect(res.body.decisions).toHaveLength(1);
    expect(res.body.total).toBe(1);
  });

  it('echoes pagination params (limit/offset)', async () => {
    const res = await request(app)
      .get('/admin/decisions?limit=10&offset=20')
      .set('Authorization', `Bearer ${signJwt(mockAdminId)}`)
      .expect(200);

    expect(res.body.limit).toBe(10);
    expect(res.body.offset).toBe(20);
  });
});

describe('GET /admin/decisions/:decisionId', () => {
  const app = makeApp();

  it('returns 401 without authentication', async () => {
    await request(app).get(`/admin/decisions/${mockDecisionDetailId}`).expect(401);
  });

  it('returns 403 for a non-admin user', async () => {
    await request(app)
      .get(`/admin/decisions/${mockDecisionDetailId}`)
      .set('Authorization', `Bearer ${signJwt(mockNonAdminId)}`)
      .expect(403);
  });

  it('returns decision detail with context, options, node, and resolution', async () => {
    const res = await request(app)
      .get(`/admin/decisions/${mockDecisionDetailId}`)
      .set('Authorization', `Bearer ${signJwt(mockAdminId)}`)
      .expect(200);

    expect(res.body.decision.id).toBe(mockDecisionDetailId);
    expect(res.body.decision.context).toMatch(/auth library/);
    expect(res.body.decision.options).toEqual([{ option: 'JWT', pros: ['simple'], cons: [] }]);
    expect(res.body.decision.node).toEqual({ id: mockDecisionDetailRow.node_id, title: 'Auth task' });
    expect(res.body.decision.resolution).toEqual({ decision: null, rationale: null, decided_at: null });
  });

  it('returns 404 for an unknown decisionId', async () => {
    await request(app)
      .get(`/admin/decisions/${mockMissingDecisionId}`)
      .set('Authorization', `Bearer ${signJwt(mockAdminId)}`)
      .expect(404);
  });
});

describe('GET /admin/knowledge', () => {
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
    await request(app).get('/admin/knowledge').expect(401);
  });

  it('returns 403 for a non-admin user', async () => {
    await request(app)
      .get('/admin/knowledge')
      .set('Authorization', `Bearer ${signJwt(mockNonAdminId)}`)
      .expect(403);
  });

  it('returns totals, link-type breakdown, and per-org linkage', async () => {
    process.env.OPENAI_API_KEY = 'sk-test';
    graphitiBridge.getStatus.mockResolvedValue({ available: true });

    const res = await request(app)
      .get('/admin/knowledge')
      .set('Authorization', `Bearer ${signJwt(mockAdminId)}`)
      .expect(200);

    expect(res.body.totals).toEqual(mockKnowledgeTotals);
    expect(res.body.by_link_type).toEqual(mockKnowledgeByType);
    expect(res.body.by_org).toHaveLength(mockKnowledgeByOrg.length);
    expect(res.body.status.graphiti.ok).toBe(true);
    expect(res.body.status.openai_key.configured).toBe(true);
    // The zero-knowledge org (tasks but no episodes) is surfaced for silent-fail triage.
    const empty = res.body.by_org.find((o) => o.name === 'Empty Co');
    expect(empty).toMatchObject({ episode_count: 0, node_count: 25 });
  });

  it('flags the OPENAI_API_KEY silent-fail when the key is missing', async () => {
    delete process.env.OPENAI_API_KEY;
    graphitiBridge.getStatus.mockResolvedValue({ available: true });

    const res = await request(app)
      .get('/admin/knowledge')
      .set('Authorization', `Bearer ${signJwt(mockAdminId)}`)
      .expect(200);

    expect(res.body.status.openai_key.configured).toBe(false);
    expect(res.body.status.openai_key.detail).toMatch(/no-op/i);
  });

  it('reports Graphiti unreachable', async () => {
    process.env.OPENAI_API_KEY = 'sk-test';
    graphitiBridge.getStatus.mockResolvedValue({ available: false });

    const res = await request(app)
      .get('/admin/knowledge')
      .set('Authorization', `Bearer ${signJwt(mockAdminId)}`)
      .expect(200);

    expect(res.body.status.graphiti.ok).toBe(false);
  });
});
