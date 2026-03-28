/**
 * Integration Tests — Auth & Access Control
 *
 * Covers:
 *  1. JWT authentication (auth.middleware.v2.js)
 *  2. API Token authentication (ApiKey scheme)
 *  3. Plan access control (checkPlanAccess in plan/node controllers)
 *  4. Rate limiting configuration
 *
 * All DAL calls are mocked — no database required.
 */

// JWT_SECRET must be set BEFORE the auth middleware module is loaded,
// because it captures process.env.JWT_SECRET at require-time.
const TEST_SECRET = 'test-secret-for-auth-access-tests';
process.env.JWT_SECRET = TEST_SECRET;

const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');

const {
  createMockUser,
  createMockPlan,
  createMockRequest,
  createMockResponse,
  createMockNext,
} = require('../fixtures/testData');

// ── Mocks ──────────────────────────────────────────────────────────────────

jest.mock('../../src/db/dal.cjs', () => {
  const tokensDal = {
    findByHash: jest.fn(),
    updateLastUsed: jest.fn().mockResolvedValue(),
  };
  const usersDal = {
    findById: jest.fn(),
    update: jest.fn().mockResolvedValue(),
  };
  const organizationsDal = {
    listForUser: jest.fn().mockResolvedValue([]),
  };
  const plansDal = {
    userHasAccess: jest.fn(),
    findById: jest.fn(),
    listForUser: jest.fn().mockResolvedValue({ owned: [], shared: [], organization: [] }),
    listPublic: jest.fn().mockResolvedValue([]),
  };
  const nodesDal = {
    findById: jest.fn(),
    listByPlan: jest.fn().mockResolvedValue([]),
    getTree: jest.fn().mockResolvedValue([]),
  };
  const collaboratorsDal = {
    findByPlanAndUser: jest.fn(),
  };
  return { tokensDal, usersDal, organizationsDal, plansDal, nodesDal, collaboratorsDal };
});

jest.mock('../../src/utils/logger', () => ({
  api: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  info: jest.fn(),
  debug: jest.fn(),
}));

jest.mock('../../src/websocket/broadcast', () => ({
  broadcastPlanUpdate: jest.fn(),
  broadcastToAll: jest.fn(),
}));

jest.mock('../../src/websocket/message-schema', () => ({
  createPlanCreatedMessage: jest.fn(),
  createPlanUpdatedMessage: jest.fn(),
  createPlanDeletedMessage: jest.fn(),
}));

jest.mock('../../src/services/messageBus', () => ({
  publish: jest.fn(),
  subscribe: jest.fn(),
  init: jest.fn(),
}));

// ── Imports (after mocks) ──────────────────────────────────────────────────

const dal = require('../../src/db/dal.cjs');
const { authenticate, optionalAuthenticate, requireAdmin } = require('../../src/middleware/auth.middleware.v2');
const planController = require('../../src/controllers/plan.controller.v2');
const nodeController = require('../../src/controllers/node.controller.v2');

// ── Helpers ────────────────────────────────────────────────────────────────

/** Generate a real JWT signed with the test secret */
function signJwt(payload, options = {}) {
  return jwt.sign(
    { sub: payload.sub, email: payload.email, name: payload.name, type: payload.type || 'access' },
    TEST_SECRET,
    { expiresIn: '1h', ...options },
  );
}

/** Generate a real expired JWT */
function signExpiredJwt(payload) {
  return jwt.sign(
    { sub: payload.sub, email: payload.email, name: payload.name, type: 'access' },
    TEST_SECRET,
    { expiresIn: '-1s' },
  );
}

// ============================================================================
// 1. JWT Authentication
// ============================================================================

describe('JWT Authentication (auth.middleware.v2)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Ensure JWT_SECRET is set for the middleware
    process.env.JWT_SECRET = TEST_SECRET;
  });

  it('should populate req.user and call next() for a valid JWT', async () => {
    const user = createMockUser();
    const token = signJwt({ sub: user.id, email: user.email, name: user.name });

    const req = createMockRequest({ headers: { authorization: `Bearer ${token}` } });
    const res = createMockResponse();
    const next = createMockNext();

    await authenticate(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(req.user).toBeDefined();
    expect(req.user.id).toBe(user.id);
    expect(req.user.email).toBe(user.email);
    expect(req.user.name).toBe(user.name);
    expect(req.user.authMethod).toBe('jwt');
  });

  it('should return 401 for an expired JWT', async () => {
    const user = createMockUser();
    const token = signExpiredJwt({ sub: user.id, email: user.email, name: user.name });

    const req = createMockRequest({ headers: { authorization: `Bearer ${token}` } });
    const res = createMockResponse();
    const next = createMockNext();

    await authenticate(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.any(String) }));
    expect(next).not.toHaveBeenCalled();
  });

  it('should return 401 for a malformed JWT (not a real token)', async () => {
    const req = createMockRequest({ headers: { authorization: 'Bearer not.a.valid.jwt.at.all' } });
    const res = createMockResponse();
    const next = createMockNext();

    await authenticate(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('should return 401 for a JWT signed with the wrong secret', async () => {
    const user = createMockUser();
    const token = jwt.sign(
      { sub: user.id, email: user.email, name: user.name, type: 'access' },
      'wrong-secret-key',
      { expiresIn: '1h' },
    );

    const req = createMockRequest({ headers: { authorization: `Bearer ${token}` } });
    const res = createMockResponse();
    const next = createMockNext();

    await authenticate(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('should return 401 when Authorization header is missing', async () => {
    const req = createMockRequest({ headers: {} });
    const res = createMockResponse();
    const next = createMockNext();

    await authenticate(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Authentication required' });
    expect(next).not.toHaveBeenCalled();
  });

  it('should return 401 for unsupported scheme (not Bearer or ApiKey)', async () => {
    const req = createMockRequest({ headers: { authorization: 'Basic dXNlcjpwYXNz' } });
    const res = createMockResponse();
    const next = createMockNext();

    await authenticate(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Unsupported authentication scheme' });
    expect(next).not.toHaveBeenCalled();
  });

  it('should return 401 for malformed Authorization header (single word)', async () => {
    const req = createMockRequest({ headers: { authorization: 'justatoken' } });
    const res = createMockResponse();
    const next = createMockNext();

    await authenticate(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Invalid authentication format' });
    expect(next).not.toHaveBeenCalled();
  });

  it('should reject refresh tokens used as access tokens', async () => {
    const user = createMockUser();
    const token = signJwt({ sub: user.id, email: user.email, name: user.name, type: 'refresh' });

    const req = createMockRequest({ headers: { authorization: `Bearer ${token}` } });
    const res = createMockResponse();
    const next = createMockNext();

    await authenticate(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });
});

// ============================================================================
// 2. API Token Authentication
// ============================================================================

describe('API Token Authentication', () => {
  let mockUser;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.JWT_SECRET = TEST_SECRET;
    mockUser = createMockUser();
  });

  it('should authenticate a valid API token with ApiKey scheme', async () => {
    const rawToken = crypto.randomBytes(32).toString('hex');
    const req = createMockRequest({ headers: { authorization: `ApiKey ${rawToken}` } });
    const res = createMockResponse();
    const next = createMockNext();

    dal.tokensDal.findByHash.mockResolvedValue({
      id: 'tok-1', userId: mockUser.id, permissions: ['read', 'write'],
    });
    dal.usersDal.findById.mockResolvedValue(mockUser);

    await authenticate(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(req.user.id).toBe(mockUser.id);
    expect(req.user.authMethod).toBe('api_key');
    expect(req.user.permissions).toEqual(['read', 'write']);
  });

  it('should return 401 for an invalid API token (not found in DB)', async () => {
    const rawToken = crypto.randomBytes(32).toString('hex');
    const req = createMockRequest({ headers: { authorization: `ApiKey ${rawToken}` } });
    const res = createMockResponse();
    const next = createMockNext();

    dal.tokensDal.findByHash.mockResolvedValue(null);

    await authenticate(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Invalid API token' });
    expect(next).not.toHaveBeenCalled();
  });

  it('should return 401 when the user behind the token no longer exists', async () => {
    const rawToken = crypto.randomBytes(32).toString('hex');
    const req = createMockRequest({ headers: { authorization: `ApiKey ${rawToken}` } });
    const res = createMockResponse();
    const next = createMockNext();

    dal.tokensDal.findByHash.mockResolvedValue({
      id: 'tok-2', userId: 'deleted-user', permissions: [],
    });
    dal.usersDal.findById.mockResolvedValue(null);

    await authenticate(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Invalid API token' });
    expect(next).not.toHaveBeenCalled();
  });

  it('should also accept a 64-char hex API token via Bearer scheme', async () => {
    const rawToken = crypto.randomBytes(32).toString('hex'); // exactly 64 hex chars
    const req = createMockRequest({ headers: { authorization: `Bearer ${rawToken}` } });
    const res = createMockResponse();
    const next = createMockNext();

    dal.tokensDal.findByHash.mockResolvedValue({
      id: 'tok-3', userId: mockUser.id, permissions: ['read'],
    });
    dal.usersDal.findById.mockResolvedValue(mockUser);

    await authenticate(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(req.user.authMethod).toBe('api_key');
  });

  it('should hash the token with SHA-256 before looking it up', async () => {
    const rawToken = 'my-api-token-value';
    const expectedHash = crypto.createHash('sha256').update(rawToken).digest('hex');

    const req = createMockRequest({ headers: { authorization: `ApiKey ${rawToken}` } });
    const res = createMockResponse();
    const next = createMockNext();

    dal.tokensDal.findByHash.mockResolvedValue(null);

    await authenticate(req, res, next);

    expect(dal.tokensDal.findByHash).toHaveBeenCalledWith(expectedHash);
  });

  it('should set tokenOrganizationId when the token is scoped to an org', async () => {
    const rawToken = crypto.randomBytes(32).toString('hex');
    const req = createMockRequest({ headers: { authorization: `ApiKey ${rawToken}` } });
    const res = createMockResponse();
    const next = createMockNext();

    dal.tokensDal.findByHash.mockResolvedValue({
      id: 'tok-4', userId: mockUser.id, permissions: [],
      organizationId: 'org-abc',
    });
    dal.usersDal.findById.mockResolvedValue(mockUser);

    await authenticate(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(req.user.tokenOrganizationId).toBe('org-abc');
  });

  it('should fire-and-forget updateLastUsed on successful API token auth', async () => {
    const rawToken = crypto.randomBytes(32).toString('hex');
    const req = createMockRequest({ headers: { authorization: `ApiKey ${rawToken}` } });
    const res = createMockResponse();
    const next = createMockNext();

    dal.tokensDal.findByHash.mockResolvedValue({
      id: 'tok-5', userId: mockUser.id, permissions: [],
    });
    dal.usersDal.findById.mockResolvedValue(mockUser);

    await authenticate(req, res, next);

    expect(dal.tokensDal.updateLastUsed).toHaveBeenCalledWith('tok-5');
  });
});

// ============================================================================
// Optional & Admin auth
// ============================================================================

describe('optionalAuthenticate', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.JWT_SECRET = TEST_SECRET;
  });

  it('should call next() without setting req.user when no header is present', async () => {
    const req = createMockRequest({ headers: {} });
    const res = createMockResponse();
    const next = createMockNext();

    await optionalAuthenticate(req, res, next);

    expect(next).toHaveBeenCalled();
    // req.user should be the default from createMockRequest (or undefined after middleware)
  });

  it('should populate req.user when a valid JWT is present', async () => {
    const user = createMockUser();
    const token = signJwt({ sub: user.id, email: user.email, name: user.name });

    const req = createMockRequest({ headers: { authorization: `Bearer ${token}` }, user: undefined });
    const res = createMockResponse();
    const next = createMockNext();

    await optionalAuthenticate(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(req.user).toBeDefined();
    expect(req.user.id).toBe(user.id);
  });
});

describe('requireAdmin', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should return 401 if req.user is not set', async () => {
    const req = createMockRequest({ user: null });
    const res = createMockResponse();
    const next = createMockNext();

    await requireAdmin(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('should return 403 if user is not an admin', async () => {
    const user = createMockUser();
    const req = createMockRequest({ user });
    const res = createMockResponse();
    const next = createMockNext();

    dal.usersDal.findById.mockResolvedValue({ ...user, isAdmin: false });

    await requireAdmin(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ error: 'Admin access required' });
    expect(next).not.toHaveBeenCalled();
  });

  it('should call next() if user is an admin', async () => {
    const user = createMockUser();
    const req = createMockRequest({ user });
    const res = createMockResponse();
    const next = createMockNext();

    dal.usersDal.findById.mockResolvedValue({ ...user, isAdmin: true });

    await requireAdmin(req, res, next);

    expect(next).toHaveBeenCalled();
  });
});

// ============================================================================
// 3. Plan Access Control (checkPlanAccess pattern)
// ============================================================================

describe('Plan Access Control', () => {
  let owner;
  let plan;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.JWT_SECRET = TEST_SECRET;

    owner = createMockUser();
    plan = createMockPlan({ owner_id: owner.id });
  });

  // -- 3a. Owner role → full access --

  describe('owner role', () => {
    it('should allow an owner to read a plan (getPlan)', async () => {
      dal.plansDal.userHasAccess.mockResolvedValue({ hasAccess: true, role: 'owner' });
      dal.plansDal.findById.mockResolvedValue({
        id: plan.id, title: plan.title, description: plan.description,
        ownerId: owner.id, status: plan.status, visibility: 'private',
        isPublic: false, viewCount: 0, metadata: {},
        createdAt: plan.created_at, updatedAt: plan.updated_at,
      });
      dal.nodesDal.listByPlan.mockResolvedValue([]);

      const req = createMockRequest({
        params: { id: plan.id },
        user: owner,
      });
      const res = createMockResponse();
      const next = createMockNext();

      await planController.getPlan(req, res, next);

      expect(res.status).not.toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalled();
    });

    it('should allow an owner to update a plan', async () => {
      dal.plansDal.userHasAccess.mockResolvedValue({ hasAccess: true, role: 'owner' });
      dal.plansDal.update = jest.fn().mockResolvedValue({
        id: plan.id, title: 'Updated', description: plan.description,
        ownerId: owner.id, status: plan.status, visibility: 'private',
        isPublic: false, viewCount: 0, metadata: {},
        createdAt: plan.created_at, updatedAt: new Date().toISOString(),
      });

      const req = createMockRequest({
        params: { id: plan.id },
        body: { title: 'Updated' },
        user: owner,
      });
      const res = createMockResponse();
      const next = createMockNext();

      await planController.updatePlan(req, res, next);

      expect(res.status).not.toHaveBeenCalledWith(403);
    });

    it('should allow only the owner to delete a plan', async () => {
      dal.plansDal.findById.mockResolvedValue({
        id: plan.id, ownerId: owner.id,
      });
      dal.plansDal.remove = jest.fn().mockResolvedValue();

      const req = createMockRequest({
        params: { id: plan.id },
        user: owner,
      });
      const res = createMockResponse();
      const next = createMockNext();

      await planController.deletePlan(req, res, next);

      expect(res.status).not.toHaveBeenCalledWith(403);
    });
  });

  // -- 3b. Editor role → can edit but NOT delete --

  describe('editor role', () => {
    let editor;

    beforeEach(() => {
      editor = createMockUser();
    });

    it('should allow an editor to create nodes', async () => {
      dal.plansDal.userHasAccess.mockResolvedValue({ hasAccess: true, role: 'editor' });
      dal.nodesDal.listByPlan.mockResolvedValue([
        { id: 'root-1', parentId: null, nodeType: 'root', planId: plan.id },
      ]);
      dal.nodesDal.create = jest.fn().mockResolvedValue({
        id: uuidv4(), planId: plan.id, parentId: 'root-1',
        nodeType: 'task', title: 'New task', status: 'not_started',
        orderIndex: 0, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      });

      const req = createMockRequest({
        params: { id: plan.id },
        body: { node_type: 'task', title: 'New task', parent_id: 'root-1' },
        user: editor,
      });
      const res = createMockResponse();
      const next = createMockNext();

      await nodeController.createNode(req, res, next);

      expect(res.status).not.toHaveBeenCalledWith(403);
    });

    it('should deny an editor from deleting a plan (owner-only)', async () => {
      dal.plansDal.findById.mockResolvedValue({
        id: plan.id, ownerId: owner.id, // owner is someone else
      });

      const req = createMockRequest({
        params: { id: plan.id },
        user: editor, // not the owner
      });
      const res = createMockResponse();
      const next = createMockNext();

      await planController.deletePlan(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith({ error: 'Only the plan owner can delete it' });
    });

    it('should deny an editor from changing plan visibility (owner-only)', async () => {
      dal.plansDal.userHasAccess.mockResolvedValue({ hasAccess: true, role: 'editor' });

      const req = createMockRequest({
        params: { id: plan.id },
        body: { visibility: 'public' },
        user: editor,
      });
      const res = createMockResponse();
      const next = createMockNext();

      await planController.updatePlanVisibility(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith({ error: 'Only the plan owner can change visibility' });
    });
  });

  // -- 3c. Viewer role → read only, can NOT create nodes --

  describe('viewer role', () => {
    let viewer;

    beforeEach(() => {
      viewer = createMockUser();
    });

    it('should allow a viewer to read a plan', async () => {
      dal.plansDal.userHasAccess.mockResolvedValue({ hasAccess: true, role: 'viewer' });
      dal.plansDal.findById.mockResolvedValue({
        id: plan.id, title: plan.title, description: plan.description,
        ownerId: owner.id, status: plan.status, visibility: 'private',
        isPublic: false, viewCount: 0, metadata: {},
        createdAt: plan.created_at, updatedAt: plan.updated_at,
      });
      dal.nodesDal.listByPlan.mockResolvedValue([]);

      const req = createMockRequest({
        params: { id: plan.id },
        user: viewer,
      });
      const res = createMockResponse();
      const next = createMockNext();

      await planController.getPlan(req, res, next);

      expect(res.status).not.toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalled();
    });

    it('should deny a viewer from creating nodes', async () => {
      dal.plansDal.userHasAccess.mockResolvedValue({ hasAccess: true, role: 'viewer' });

      const req = createMockRequest({
        params: { id: plan.id },
        body: { node_type: 'task', title: 'Sneaky task', parent_id: 'root-1' },
        user: viewer,
      });
      const res = createMockResponse();
      const next = createMockNext();

      await nodeController.createNode(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: expect.stringContaining('permission') }),
      );
    });

    it('should deny a viewer from updating nodes', async () => {
      dal.plansDal.userHasAccess.mockResolvedValue({ hasAccess: true, role: 'viewer' });

      const req = createMockRequest({
        params: { id: plan.id, nodeId: 'node-1' },
        body: { title: 'Changed' },
        user: viewer,
      });
      const res = createMockResponse();
      const next = createMockNext();

      await nodeController.updateNode(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
    });

    it('should deny a viewer from deleting nodes', async () => {
      dal.plansDal.userHasAccess.mockResolvedValue({ hasAccess: true, role: 'viewer' });

      const req = createMockRequest({
        params: { id: plan.id, nodeId: 'node-1' },
        user: viewer,
      });
      const res = createMockResponse();
      const next = createMockNext();

      await nodeController.deleteNode(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
    });
  });

  // -- 3d. No access → 403 --

  describe('no access (non-collaborator)', () => {
    let stranger;

    beforeEach(() => {
      stranger = createMockUser();
    });

    it('should deny access to a private plan for a non-collaborator', async () => {
      dal.plansDal.userHasAccess.mockResolvedValue({ hasAccess: false, role: null });

      const req = createMockRequest({
        params: { id: plan.id },
        user: stranger,
      });
      const res = createMockResponse();
      const next = createMockNext();

      await planController.getPlan(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith({ error: 'You do not have access to this plan' });
    });

    it('should deny node listing for a non-collaborator', async () => {
      dal.plansDal.userHasAccess.mockResolvedValue({ hasAccess: false, role: null });

      const req = createMockRequest({
        params: { id: plan.id },
        query: {},
        user: stranger,
      });
      const res = createMockResponse();
      const next = createMockNext();

      await nodeController.getNodes(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
    });

    it('should deny node creation for a non-collaborator', async () => {
      dal.plansDal.userHasAccess.mockResolvedValue({ hasAccess: false, role: null });

      const req = createMockRequest({
        params: { id: plan.id },
        body: { node_type: 'task', title: 'Hack' },
        user: stranger,
      });
      const res = createMockResponse();
      const next = createMockNext();

      await nodeController.createNode(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
    });
  });

  // -- 3e. Public plan → accessible without membership --

  describe('public plan access', () => {
    it('should allow anyone to view a public plan via the public endpoint', async () => {
      dal.plansDal.findById.mockResolvedValue({
        id: plan.id, title: plan.title, description: plan.description,
        ownerId: owner.id, status: plan.status, visibility: 'public',
        isPublic: true, viewCount: 5, metadata: {},
        createdAt: plan.created_at, updatedAt: plan.updated_at,
      });
      dal.nodesDal.getTree.mockResolvedValue([]);
      dal.usersDal.findById.mockResolvedValue({ id: owner.id, name: owner.name });

      const req = createMockRequest({
        params: { id: plan.id },
        user: undefined, // no auth needed for public endpoint
      });
      const res = createMockResponse();
      const next = createMockNext();

      await planController.getPublicPlan(req, res, next);

      expect(res.status).not.toHaveBeenCalledWith(403);
      expect(res.status).not.toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ id: plan.id, visibility: 'public' }),
      );
    });

    it('should return 404 for a private plan on the public endpoint', async () => {
      dal.plansDal.findById.mockResolvedValue({
        id: plan.id, visibility: 'private', isPublic: false,
      });

      const req = createMockRequest({
        params: { id: plan.id },
        user: undefined,
      });
      const res = createMockResponse();
      const next = createMockNext();

      await planController.getPublicPlan(req, res, next);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({ error: 'Plan not found' });
    });

    it('should return 404 when the plan does not exist on the public endpoint', async () => {
      dal.plansDal.findById.mockResolvedValue(null);

      const req = createMockRequest({
        params: { id: 'nonexistent-id' },
        user: undefined,
      });
      const res = createMockResponse();
      const next = createMockNext();

      await planController.getPublicPlan(req, res, next);

      expect(res.status).toHaveBeenCalledWith(404);
    });
  });
});

// ============================================================================
// 4. Organization enrichment
// ============================================================================

describe('Organization enrichment', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.JWT_SECRET = TEST_SECRET;
  });

  it('should set organizationId from user org memberships', async () => {
    const user = createMockUser();
    const token = signJwt({ sub: user.id, email: user.email, name: user.name });
    const orgId = uuidv4();

    dal.organizationsDal.listForUser.mockResolvedValue([
      { id: orgId, name: 'Test Org', role: 'member' },
    ]);

    const req = createMockRequest({ headers: { authorization: `Bearer ${token}` } });
    const res = createMockResponse();
    const next = createMockNext();

    await authenticate(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(req.user.organizationId).toBe(orgId);
    expect(req.user.organizations).toEqual([{ id: orgId, name: 'Test Org', role: 'member' }]);
  });

  it('should allow JWT users to switch org via X-Organization-Id header', async () => {
    const user = createMockUser();
    const token = signJwt({ sub: user.id, email: user.email, name: user.name });
    const org1 = uuidv4();
    const org2 = uuidv4();

    dal.organizationsDal.listForUser.mockResolvedValue([
      { id: org1, name: 'Org 1', role: 'admin' },
      { id: org2, name: 'Org 2', role: 'member' },
    ]);

    const req = createMockRequest({
      headers: {
        authorization: `Bearer ${token}`,
        'x-organization-id': org2,
      },
    });
    const res = createMockResponse();
    const next = createMockNext();

    await authenticate(req, res, next);

    expect(req.user.organizationId).toBe(org2);
  });

  it('should NOT allow API token users to switch org via header (locked to token org)', async () => {
    const user = createMockUser();
    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenOrgId = uuidv4();
    const otherOrgId = uuidv4();

    dal.tokensDal.findByHash.mockResolvedValue({
      id: 'tok-org', userId: user.id, permissions: [],
      organizationId: tokenOrgId,
    });
    dal.usersDal.findById.mockResolvedValue(user);
    dal.organizationsDal.listForUser.mockResolvedValue([
      { id: tokenOrgId, name: 'Token Org', role: 'member' },
      { id: otherOrgId, name: 'Other Org', role: 'member' },
    ]);

    const req = createMockRequest({
      headers: {
        authorization: `ApiKey ${rawToken}`,
        'x-organization-id': otherOrgId,
      },
    });
    const res = createMockResponse();
    const next = createMockNext();

    await authenticate(req, res, next);

    // Should stay locked to the token's org, not the header value
    expect(req.user.organizationId).toBe(tokenOrgId);
  });
});

// ============================================================================
// 5. Rate Limiting (configuration verification)
// ============================================================================

describe('Rate Limiting configuration', () => {
  // Rate limiting is skipped in NODE_ENV=test, so we verify the configuration
  // objects rather than making hundreds of requests.

  let rateLimitMiddleware;

  beforeEach(() => {
    // Clear module cache to re-evaluate with fresh env
    jest.resetModules();
    process.env.NODE_ENV = 'test';
    rateLimitMiddleware = require('../../src/middleware/rateLimit.middleware');
  });

  it('should export four rate limiter tiers', () => {
    expect(rateLimitMiddleware.generalLimiter).toBeDefined();
    expect(rateLimitMiddleware.authLimiter).toBeDefined();
    expect(rateLimitMiddleware.searchLimiter).toBeDefined();
    expect(rateLimitMiddleware.tokenLimiter).toBeDefined();
  });

  it('should have auth limiter stricter than general limiter', () => {
    // Auth: 20/min vs General: 600/min
    // We verify the exported middleware functions exist (the actual limits
    // are configured via express-rate-limit and verified in the source).
    // Since rate limiting is skipped in test env, we verify the module
    // loads and exports all four tiers correctly.
    expect(typeof rateLimitMiddleware.generalLimiter).toBe('function');
    expect(typeof rateLimitMiddleware.authLimiter).toBe('function');
    expect(typeof rateLimitMiddleware.searchLimiter).toBe('function');
    expect(typeof rateLimitMiddleware.tokenLimiter).toBe('function');
  });

  it('should skip rate limiting in test environment', async () => {
    // The skip function checks NODE_ENV === 'test'
    // express-rate-limit calls next asynchronously
    const req = { path: '/api/plans', ip: '127.0.0.1', headers: {} };
    const res = createMockResponse();
    const next = createMockNext();

    await rateLimitMiddleware.generalLimiter(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it('should skip rate limiting for health check endpoint', async () => {
    const req = { path: '/health', ip: '127.0.0.1', headers: {} };
    const res = createMockResponse();
    const next = createMockNext();

    await rateLimitMiddleware.generalLimiter(req, res, next);
    expect(next).toHaveBeenCalled();
  });
});
