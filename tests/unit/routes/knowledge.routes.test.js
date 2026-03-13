/**
 * Unit tests for knowledge routes — Graphiti temporal graph endpoints.
 */

jest.mock('../../../src/middleware/auth.middleware.v2', () => ({
  authenticate: (req, res, next) => {
    req.user = { id: 'user-1', name: 'Test User' };
    next();
  },
}));

jest.mock('../../../src/utils/logger', () => ({
  error: jest.fn(),
  info: jest.fn(),
}));

jest.mock('../../../src/services/graphitiBridge', () => ({
  isAvailable: jest.fn().mockReturnValue(false),
  getStatus: jest.fn().mockResolvedValue({ available: false }),
  orgGroupId: jest.fn().mockReturnValue('default'),
}));

describe('Knowledge Routes (Graphiti)', () => {
  it('should export an express Router', () => {
    const router = require('../../../src/routes/v2/knowledge.routes');
    expect(router).toBeDefined();
    expect(Array.isArray(router.stack)).toBe(true);
  });

  it('should have Graphiti route paths', () => {
    const router = require('../../../src/routes/v2/knowledge.routes');
    const paths = router.stack
      .filter(layer => layer.route)
      .map(layer => `${Object.keys(layer.route.methods)[0].toUpperCase()} ${layer.route.path}`);

    // Graphiti proxy routes
    expect(paths).toContain('GET /graphiti/status');
    expect(paths).toContain('GET /episodes');
    expect(paths).toContain('POST /episodes');
    expect(paths).toContain('POST /graph-search');
    expect(paths).toContain('POST /entities');
    expect(paths).toContain('POST /contradictions');
    expect(paths).toContain('DELETE /episodes/:episodeId');
  });

  it('should NOT have old flat knowledge routes', () => {
    const router = require('../../../src/routes/v2/knowledge.routes');
    const paths = router.stack
      .filter(layer => layer.route)
      .map(layer => `${Object.keys(layer.route.methods)[0].toUpperCase()} ${layer.route.path}`);

    // Old flat routes should be gone
    expect(paths).not.toContain('GET /');
    expect(paths).not.toContain('POST /');
    expect(paths).not.toContain('GET /:id');
    expect(paths).not.toContain('PUT /:id');
    expect(paths).not.toContain('DELETE /:id');
    expect(paths).not.toContain('POST /search');
    expect(paths).not.toContain('GET /graph');
    expect(paths).not.toContain('GET /:id/similar');
  });
});
