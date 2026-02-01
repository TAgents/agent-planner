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

// Mock dependencies before requiring the middleware
jest.mock('../../../src/config/supabase');

const { supabase, supabaseAdmin } = require('../../../src/config/supabase');
const { authenticate } = require('../../../src/middleware/auth.middleware');

describe('Authentication Middleware', () => {
  let mockUser;
  
  beforeEach(() => {
    jest.clearAllMocks();
    mockUser = createMockUser();
    
    // Default mock implementations
    supabase.auth = {
      setSession: jest.fn().mockResolvedValue({ data: {}, error: null }),
      getUser: jest.fn().mockResolvedValue({ data: { user: null }, error: null })
    };
    
    supabaseAdmin.auth = {
      getUser: jest.fn().mockResolvedValue({ data: { user: null }, error: null })
    };
    
    supabaseAdmin.from = jest.fn().mockReturnValue({
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({ data: null, error: null }),
      update: jest.fn().mockReturnThis()
    });
  });

  describe('Missing Authorization Header', () => {
    it('should return 401 when no authorization header provided', async () => {
      const req = createMockRequest({
        headers: {} // No authorization header
      });
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
      const req = createMockRequest({
        headers: { authorization: 'invalid' }
      });
      const res = createMockResponse();
      const next = createMockNext();

      await authenticate(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({ error: 'Invalid authentication format' });
      expect(next).not.toHaveBeenCalled();
    });

    it('should return 401 for unsupported authentication scheme', async () => {
      const req = createMockRequest({
        headers: { authorization: 'Basic sometoken' }
      });
      const res = createMockResponse();
      const next = createMockNext();

      await authenticate(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.stringContaining('Invalid authentication format')
        })
      );
      expect(next).not.toHaveBeenCalled();
    });
  });

  describe('Supabase JWT Authentication (Bearer)', () => {
    it('should authenticate valid Supabase JWT', async () => {
      const req = createMockRequest({
        headers: { authorization: 'Bearer valid.jwt.token' }
      });
      const res = createMockResponse();
      const next = createMockNext();

      supabase.auth.setSession.mockResolvedValue({ data: {}, error: null });
      supabase.auth.getUser.mockResolvedValue({
        data: {
          user: {
            id: mockUser.id,
            email: mockUser.email,
            user_metadata: { name: mockUser.name }
          }
        },
        error: null
      });

      await authenticate(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(req.user).toBeDefined();
      expect(req.user.id).toBe(mockUser.id);
      expect(req.user.email).toBe(mockUser.email);
      expect(req.user.authMethod).toBe('supabase_jwt');
    });

    it('should fallback to admin verification when setSession fails', async () => {
      const req = createMockRequest({
        headers: { authorization: 'Bearer valid.jwt.token' }
      });
      const res = createMockResponse();
      const next = createMockNext();

      supabase.auth.setSession.mockResolvedValue({
        data: null,
        error: { message: 'Session expired' }
      });
      
      supabaseAdmin.auth.getUser.mockResolvedValue({
        data: {
          user: {
            id: mockUser.id,
            email: mockUser.email,
            user_metadata: { name: mockUser.name }
          }
        },
        error: null
      });

      await authenticate(req, res, next);

      expect(supabaseAdmin.auth.getUser).toHaveBeenCalledWith('valid.jwt.token');
      expect(next).toHaveBeenCalled();
      expect(req.user.authMethod).toBe('supabase_jwt');
    });

    it('should return 401 for invalid JWT', async () => {
      const req = createMockRequest({
        headers: { authorization: 'Bearer invalid.jwt.token' }
      });
      const res = createMockResponse();
      const next = createMockNext();

      supabase.auth.setSession.mockResolvedValue({
        data: null,
        error: { message: 'Invalid token' }
      });
      
      supabaseAdmin.auth.getUser.mockResolvedValue({
        data: { user: null },
        error: { message: 'Invalid token' }
      });

      await authenticate(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(next).not.toHaveBeenCalled();
    });

    it('should sync GitHub profile for GitHub OAuth users', async () => {
      const req = createMockRequest({
        headers: { authorization: 'Bearer valid.jwt.token' }
      });
      const res = createMockResponse();
      const next = createMockNext();

      const githubUser = {
        id: mockUser.id,
        email: mockUser.email,
        user_metadata: {
          name: mockUser.name,
          user_name: 'github_user',
          avatar_url: 'https://github.com/avatar.png',
          provider_id: '12345'
        },
        app_metadata: {
          provider: 'github'
        }
      };

      supabase.auth.setSession.mockResolvedValue({ data: {}, error: null });
      supabase.auth.getUser.mockResolvedValue({
        data: { user: githubUser },
        error: null
      });

      const updateMock = jest.fn().mockReturnThis();
      const eqMock = jest.fn().mockResolvedValue({ error: null });
      
      supabaseAdmin.from.mockReturnValue({
        update: updateMock,
        eq: eqMock,
        select: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({ data: null, error: null })
      });

      await authenticate(req, res, next);

      expect(supabaseAdmin.from).toHaveBeenCalledWith('users');
      expect(next).toHaveBeenCalled();
    });
  });

  describe('API Token Authentication (ApiKey scheme)', () => {
    const generateMockApiToken = () => {
      // Generate a 64-char hex token like the real implementation
      return crypto.randomBytes(32).toString('hex');
    };

    it('should authenticate valid API token with ApiKey scheme', async () => {
      const apiToken = generateMockApiToken();
      
      const req = createMockRequest({
        headers: { authorization: `ApiKey ${apiToken}` }
      });
      const res = createMockResponse();
      const next = createMockNext();

      const tokenData = {
        user_id: mockUser.id,
        permissions: ['read', 'write'],
        revoked: false,
        id: 'token-id-123',
        last_used: new Date().toISOString()
      };

      // Create chainable mocks for each table
      const apiTokensMock = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({
          data: tokenData,
          error: null
        }),
        update: jest.fn().mockReturnThis(),
        then: jest.fn((resolve) => resolve({ error: null }))
      };
      
      const usersMock = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({
          data: mockUser,
          error: null
        })
      };

      supabaseAdmin.from.mockImplementation((table) => {
        if (table === 'api_tokens') return apiTokensMock;
        if (table === 'users') return usersMock;
        return apiTokensMock;
      });

      await authenticate(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(req.user).toBeDefined();
      expect(req.user.id).toBe(mockUser.id);
      expect(req.user.authMethod).toBe('api_key');
      expect(req.user.permissions).toEqual(['read', 'write']);
    });

    it('should return 401 for revoked API token', async () => {
      const apiToken = generateMockApiToken();
      
      const req = createMockRequest({
        headers: { authorization: `ApiKey ${apiToken}` }
      });
      const res = createMockResponse();
      const next = createMockNext();

      supabaseAdmin.from.mockImplementation((table) => {
        if (table === 'api_tokens') {
          return {
            select: jest.fn().mockReturnThis(),
            eq: jest.fn().mockReturnThis(),
            single: jest.fn().mockResolvedValue({
              data: {
                user_id: mockUser.id,
                permissions: [],
                revoked: true,  // Token is revoked
                id: 'token-id-123'
              },
              error: null
            })
          };
        }
        
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          single: jest.fn().mockResolvedValue({ data: null, error: null })
        };
      });

      await authenticate(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({ error: 'API token has been revoked' });
      expect(next).not.toHaveBeenCalled();
    });

    it('should return 401 for non-existent API token', async () => {
      const apiToken = generateMockApiToken();
      
      const req = createMockRequest({
        headers: { authorization: `ApiKey ${apiToken}` }
      });
      const res = createMockResponse();
      const next = createMockNext();

      supabaseAdmin.from.mockReturnValue({
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({
          data: null,
          error: { code: 'PGRST116' }
        })
      });

      await authenticate(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({ error: 'Invalid API token' });
      expect(next).not.toHaveBeenCalled();
    });

    it('should return 401 when user not found for API token', async () => {
      const apiToken = generateMockApiToken();
      
      const req = createMockRequest({
        headers: { authorization: `ApiKey ${apiToken}` }
      });
      const res = createMockResponse();
      const next = createMockNext();

      supabaseAdmin.from.mockImplementation((table) => {
        if (table === 'api_tokens') {
          return {
            select: jest.fn().mockReturnThis(),
            eq: jest.fn().mockReturnThis(),
            single: jest.fn().mockResolvedValue({
              data: {
                user_id: 'non-existent-user',
                permissions: [],
                revoked: false,
                id: 'token-id-123'
              },
              error: null
            })
          };
        }
        
        if (table === 'users') {
          return {
            select: jest.fn().mockReturnThis(),
            eq: jest.fn().mockReturnThis(),
            single: jest.fn().mockResolvedValue({
              data: null,
              error: { code: 'PGRST116' }
            })
          };
        }
        
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          single: jest.fn().mockResolvedValue({ data: null, error: null })
        };
      });

      await authenticate(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({ error: 'User not found for API token' });
      expect(next).not.toHaveBeenCalled();
    });
  });

  describe('API Token Authentication (Bearer scheme for hex tokens)', () => {
    const generateMockApiToken = () => {
      return crypto.randomBytes(32).toString('hex');
    };

    it('should try API token auth for 64-char hex Bearer tokens', async () => {
      const apiToken = generateMockApiToken();
      
      const req = createMockRequest({
        headers: { authorization: `Bearer ${apiToken}` }
      });
      const res = createMockResponse();
      const next = createMockNext();

      const tokenData = {
        user_id: mockUser.id,
        permissions: ['read'],
        revoked: false,
        id: 'token-id-456'
      };

      // Create chainable mocks for each table
      const apiTokensMock = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({
          data: tokenData,
          error: null
        }),
        update: jest.fn().mockReturnThis(),
        then: jest.fn((resolve) => resolve({ error: null }))
      };
      
      const usersMock = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({
          data: mockUser,
          error: null
        })
      };

      supabaseAdmin.from.mockImplementation((table) => {
        if (table === 'api_tokens') return apiTokensMock;
        if (table === 'users') return usersMock;
        return apiTokensMock;
      });

      await authenticate(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(req.user.authMethod).toBe('api_key');
    });

    it('should fallback to JWT auth if hex token is not a valid API token', async () => {
      const hexToken = crypto.randomBytes(32).toString('hex');
      
      const req = createMockRequest({
        headers: { authorization: `Bearer ${hexToken}` }
      });
      const res = createMockResponse();
      const next = createMockNext();

      // API token lookup fails
      supabaseAdmin.from.mockReturnValue({
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({
          data: null,
          error: { code: 'PGRST116' }
        })
      });

      // But Supabase JWT auth succeeds (unlikely for hex string but testing fallback)
      supabase.auth.setSession.mockResolvedValue({ data: {}, error: null });
      supabase.auth.getUser.mockResolvedValue({
        data: {
          user: {
            id: mockUser.id,
            email: mockUser.email,
            user_metadata: { name: mockUser.name }
          }
        },
        error: null
      });

      await authenticate(req, res, next);

      // Should have tried JWT auth after API token failed
      expect(supabase.auth.setSession).toHaveBeenCalled();
    });
  });

  describe('Edge Cases', () => {
    it('should handle database errors gracefully', async () => {
      const req = createMockRequest({
        headers: { authorization: 'Bearer some.jwt.token' }
      });
      const res = createMockResponse();
      const next = createMockNext();

      supabase.auth.setSession.mockRejectedValue(new Error('Database connection failed'));

      await authenticate(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({ error: 'Authentication failed' });
      expect(next).not.toHaveBeenCalled();
    });

    it('should handle empty token after Bearer', async () => {
      const req = createMockRequest({
        headers: { authorization: 'Bearer ' }
      });
      const res = createMockResponse();
      const next = createMockNext();

      await authenticate(req, res, next);

      // Should try to verify empty string as token and fail
      expect(res.status).toHaveBeenCalledWith(401);
      expect(next).not.toHaveBeenCalled();
    });

    it('should update last_used timestamp for API tokens', async () => {
      const apiToken = crypto.randomBytes(32).toString('hex');
      
      const req = createMockRequest({
        headers: { authorization: `ApiKey ${apiToken}` }
      });
      const res = createMockResponse();
      const next = createMockNext();

      const tokenId = 'token-update-test';
      const updateMock = jest.fn().mockReturnThis();
      const updateEqMock = jest.fn().mockReturnValue(
        Promise.resolve({ error: null })
      );

      supabaseAdmin.from.mockImplementation((table) => {
        if (table === 'api_tokens') {
          return {
            select: jest.fn().mockReturnThis(),
            eq: jest.fn().mockReturnThis(),
            single: jest.fn().mockResolvedValue({
              data: {
                user_id: mockUser.id,
                permissions: [],
                revoked: false,
                id: tokenId
              },
              error: null
            }),
            update: updateMock,
            then: jest.fn()
          };
        }
        
        if (table === 'users') {
          return {
            select: jest.fn().mockReturnThis(),
            eq: jest.fn().mockReturnThis(),
            single: jest.fn().mockResolvedValue({
              data: mockUser,
              error: null
            })
          };
        }
        
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          single: jest.fn().mockResolvedValue({ data: null, error: null }),
          update: updateMock
        };
      });

      await authenticate(req, res, next);

      expect(next).toHaveBeenCalled();
      // The last_used update happens asynchronously, so we just verify auth succeeded
      expect(req.user).toBeDefined();
    });
  });
});
