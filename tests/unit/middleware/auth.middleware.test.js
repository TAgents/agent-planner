/**
 * Unit Tests for Authentication Middleware v2
 * Tests JWT (jsonwebtoken) and API token authentication
 */

const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const {
  createMockRequest,
  createMockResponse,
  createMockNext,
  createMockUser
} = require('../../fixtures/testData');

// Mock jsonwebtoken
jest.mock('jsonwebtoken');

// Mock DAL
jest.mock('../../../src/db/dal.cjs', () => {
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
  return { tokensDal, usersDal, organizationsDal };
});

jest.mock('../../../src/utils/logger', () => ({ error: jest.fn(), api: jest.fn() }));

const { tokensDal, usersDal } = require('../../../src/db/dal.cjs');
const { authenticate } = require('../../../src/middleware/auth.middleware');

describe('Authentication Middleware', () => {
  let mockUser;

  beforeEach(() => {
    jest.clearAllMocks();
    mockUser = createMockUser();
    // Default: JWT verify fails
    jwt.verify.mockImplementation(() => { throw new Error('invalid'); });
  });

  describe('Missing Authorization Header', () => {
    it('should return 401 when no authorization header provided', async () => {
      const req = createMockRequest({ headers: {} });
      const res = createMockResponse();
      const next = createMockNext();

      await authenticate(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({ error: 'Authentication required' });
      expect(next).not.toHaveBeenCalled();
    });
  });

  describe('Invalid Authorization Format', () => {
    it('should return 401 for malformed authorization header', async () => {
      const req = createMockRequest({ headers: { authorization: 'invalid' } });
      const res = createMockResponse();
      const next = createMockNext();

      await authenticate(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({ error: 'Invalid authentication format' });
    });

    it('should return 401 for unsupported authentication scheme', async () => {
      const req = createMockRequest({ headers: { authorization: 'Basic sometoken' } });
      const res = createMockResponse();
      const next = createMockNext();

      await authenticate(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({ error: 'Unsupported authentication scheme' });
    });
  });

  describe('JWT Authentication (Bearer)', () => {
    it('should authenticate valid JWT', async () => {
      const req = createMockRequest({ headers: { authorization: 'Bearer valid.jwt.token' } });
      const res = createMockResponse();
      const next = createMockNext();

      jwt.verify.mockReturnValue({
        sub: mockUser.id,
        email: mockUser.email,
        name: mockUser.name,
        type: 'access',
      });

      await authenticate(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(req.user).toBeDefined();
      expect(req.user.id).toBe(mockUser.id);
      expect(req.user.authMethod).toBe('jwt');
    });

    it('should return 401 for invalid JWT', async () => {
      const req = createMockRequest({ headers: { authorization: 'Bearer invalid.jwt.token' } });
      const res = createMockResponse();
      const next = createMockNext();

      jwt.verify.mockImplementation(() => { throw new Error('invalid token'); });

      await authenticate(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({ error: 'Invalid or expired token' });
      expect(next).not.toHaveBeenCalled();
    });

    it('should reject refresh tokens used as access tokens', async () => {
      const req = createMockRequest({ headers: { authorization: 'Bearer refresh.jwt.token' } });
      const res = createMockResponse();
      const next = createMockNext();

      jwt.verify.mockReturnValue({
        sub: mockUser.id,
        email: mockUser.email,
        type: 'refresh',
      });

      await authenticate(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(next).not.toHaveBeenCalled();
    });
  });

  describe('API Token Authentication (ApiKey scheme)', () => {
    it('should authenticate valid API token with ApiKey scheme', async () => {
      const apiToken = crypto.randomBytes(32).toString('hex');
      const req = createMockRequest({ headers: { authorization: `ApiKey ${apiToken}` } });
      const res = createMockResponse();
      const next = createMockNext();

      tokensDal.findByHash.mockResolvedValue({
        id: 'token-id-123', userId: mockUser.id,
        permissions: ['read', 'write'], revoked: false
      });
      usersDal.findById.mockResolvedValue(mockUser);

      await authenticate(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(req.user.id).toBe(mockUser.id);
      expect(req.user.authMethod).toBe('api_key');
      expect(req.user.permissions).toEqual(['read', 'write']);
    });

    it('should return 401 for non-existent API token', async () => {
      const apiToken = crypto.randomBytes(32).toString('hex');
      const req = createMockRequest({ headers: { authorization: `ApiKey ${apiToken}` } });
      const res = createMockResponse();
      const next = createMockNext();

      tokensDal.findByHash.mockResolvedValue(null);

      await authenticate(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({ error: 'Invalid API token' });
    });

    it('should return 401 when user not found for API token', async () => {
      const apiToken = crypto.randomBytes(32).toString('hex');
      const req = createMockRequest({ headers: { authorization: `ApiKey ${apiToken}` } });
      const res = createMockResponse();
      const next = createMockNext();

      tokensDal.findByHash.mockResolvedValue({
        id: 'token-id', userId: 'non-existent', permissions: [], revoked: false
      });
      usersDal.findById.mockResolvedValue(null);

      await authenticate(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({ error: 'Invalid API token' });
    });

    it('should include tokenOrganizationId when token has organizationId', async () => {
      const apiToken = crypto.randomBytes(32).toString('hex');
      const req = createMockRequest({ headers: { authorization: `ApiKey ${apiToken}` } });
      const res = createMockResponse();
      const next = createMockNext();

      tokensDal.findByHash.mockResolvedValue({
        id: 'token-id', userId: mockUser.id,
        permissions: ['read'], revoked: false,
        organizationId: 'org-123'
      });
      usersDal.findById.mockResolvedValue(mockUser);

      await authenticate(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(req.user.tokenOrganizationId).toBe('org-123');
    });
  });

  describe('Bearer hex token (API token via Bearer)', () => {
    it('should try API token auth for 64-char hex Bearer tokens', async () => {
      const apiToken = crypto.randomBytes(32).toString('hex');
      const req = createMockRequest({ headers: { authorization: `Bearer ${apiToken}` } });
      const res = createMockResponse();
      const next = createMockNext();

      tokensDal.findByHash.mockResolvedValue({
        id: 'token-id', userId: mockUser.id, permissions: ['read'], revoked: false
      });
      usersDal.findById.mockResolvedValue(mockUser);

      await authenticate(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(req.user.authMethod).toBe('api_key');
    });

    it('should fallback to JWT auth if hex token is not a valid API token', async () => {
      const hexToken = crypto.randomBytes(32).toString('hex');
      const req = createMockRequest({ headers: { authorization: `Bearer ${hexToken}` } });
      const res = createMockResponse();
      const next = createMockNext();

      tokensDal.findByHash.mockResolvedValue(null);
      jwt.verify.mockReturnValue({
        sub: mockUser.id,
        email: mockUser.email,
        name: mockUser.name,
        type: 'access',
      });

      await authenticate(req, res, next);

      expect(jwt.verify).toHaveBeenCalled();
      expect(next).toHaveBeenCalled();
      expect(req.user.authMethod).toBe('jwt');
    });
  });

  describe('Edge Cases', () => {
    it('should handle database errors gracefully', async () => {
      const apiToken = crypto.randomBytes(32).toString('hex');
      const req = createMockRequest({ headers: { authorization: `ApiKey ${apiToken}` } });
      const res = createMockResponse();
      const next = createMockNext();

      tokensDal.findByHash.mockRejectedValue(new Error('Database connection failed'));

      await authenticate(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({ error: 'Authentication failed' });
    });

    it('should handle empty token after Bearer', async () => {
      const req = createMockRequest({ headers: { authorization: 'Bearer ' } });
      const res = createMockResponse();
      const next = createMockNext();

      await authenticate(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
    });
  });
});
