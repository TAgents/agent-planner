/**
 * Unit Tests for Authentication Middleware
 * Tests JWT and API token authentication
 */

const crypto = require('crypto');
const {
  createMockRequest,
  createMockResponse,
  createMockNext,
  createMockUser
} = require('../../fixtures/testData');

// Mock supabase-auth (for adminAuth.getUser)
jest.mock('../../../src/services/supabase-auth', () => ({
  adminAuth: {
    getUser: jest.fn(),
  },
}));

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
  return { tokensDal, usersDal };
});

jest.mock('../../../src/utils/logger', () => ({ error: jest.fn(), api: jest.fn() }));

const { adminAuth } = require('../../../src/services/supabase-auth');
const { tokensDal, usersDal } = require('../../../src/db/dal.cjs');
const { authenticate } = require('../../../src/middleware/auth.middleware');

describe('Authentication Middleware', () => {
  let mockUser;

  beforeEach(() => {
    jest.clearAllMocks();
    mockUser = createMockUser();
    adminAuth.getUser.mockResolvedValue({ data: { user: null }, error: null });
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

  describe('Supabase JWT Authentication (Bearer)', () => {
    it('should authenticate valid Supabase JWT', async () => {
      const req = createMockRequest({ headers: { authorization: 'Bearer valid.jwt.token' } });
      const res = createMockResponse();
      const next = createMockNext();

      adminAuth.getUser.mockResolvedValue({
        data: {
          user: {
            id: mockUser.id, email: mockUser.email,
            user_metadata: { name: mockUser.name },
            app_metadata: {}
          }
        },
        error: null
      });

      await authenticate(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(req.user).toBeDefined();
      expect(req.user.id).toBe(mockUser.id);
      expect(req.user.authMethod).toBe('supabase_jwt');
    });

    it('should return 401 for invalid JWT', async () => {
      const req = createMockRequest({ headers: { authorization: 'Bearer invalid.jwt.token' } });
      const res = createMockResponse();
      const next = createMockNext();

      adminAuth.getUser.mockResolvedValue({ data: { user: null }, error: { message: 'Invalid token' } });

      await authenticate(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(next).not.toHaveBeenCalled();
    });

    it('should sync GitHub profile for GitHub OAuth users', async () => {
      const req = createMockRequest({ headers: { authorization: 'Bearer valid.jwt.token' } });
      const res = createMockResponse();
      const next = createMockNext();

      adminAuth.getUser.mockResolvedValue({
        data: {
          user: {
            id: mockUser.id, email: mockUser.email,
            user_metadata: { name: mockUser.name, user_name: 'github_user', avatar_url: 'https://github.com/avatar.png', provider_id: '12345' },
            app_metadata: { provider: 'github' }
          }
        },
        error: null
      });

      await authenticate(req, res, next);

      expect(usersDal.update).toHaveBeenCalledWith(mockUser.id, expect.objectContaining({
        githubUsername: 'github_user',
      }));
      expect(next).toHaveBeenCalled();
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

    it('should return 401 for revoked API token', async () => {
      const apiToken = crypto.randomBytes(32).toString('hex');
      const req = createMockRequest({ headers: { authorization: `ApiKey ${apiToken}` } });
      const res = createMockResponse();
      const next = createMockNext();

      tokensDal.findByHash.mockResolvedValue({
        id: 'token-id', userId: mockUser.id, permissions: [], revoked: true
      });

      await authenticate(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({ error: 'Invalid API token' });
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
      expect(res.json).toHaveBeenCalledWith({ error: 'User not found' });
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
      adminAuth.getUser.mockResolvedValue({
        data: {
          user: { id: mockUser.id, email: mockUser.email, user_metadata: { name: mockUser.name }, app_metadata: {} }
        },
        error: null
      });

      await authenticate(req, res, next);

      expect(adminAuth.getUser).toHaveBeenCalled();
    });
  });

  describe('Edge Cases', () => {
    it('should handle database errors gracefully', async () => {
      const req = createMockRequest({ headers: { authorization: 'Bearer some.jwt.token' } });
      const res = createMockResponse();
      const next = createMockNext();

      adminAuth.getUser.mockRejectedValue(new Error('Database connection failed'));

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
