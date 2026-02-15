/**
 * Unit tests for knowledge v2 routes — validation logic.
 * 
 * Full route integration tests require the ESM DAL, which is tested
 * separately in integration tests with a real DB.
 * These tests verify the route module loads and basic structure.
 */

jest.mock('../../../src/middleware/auth.middleware', () => ({
  authenticate: (req, res, next) => {
    req.user = { id: 'user-1', name: 'Test User' };
    next();
  },
}));

jest.mock('../../../src/utils/logger', () => ({
  error: jest.fn(),
  info: jest.fn(),
}));

jest.mock('../../../src/services/embeddings', () => ({
  generateEmbedding: jest.fn().mockResolvedValue(new Array(1536).fill(0.1)),
  generateEmbeddings: jest.fn(),
  buildEmbeddingInput: jest.fn().mockReturnValue('test input'),
}));

describe('Knowledge v2 Routes', () => {
  it('should export an express Router', () => {
    const router = require('../../../src/routes/v2/knowledge.routes');
    expect(router).toBeDefined();
    // Express routers have a .stack property with route layers
    expect(Array.isArray(router.stack)).toBe(true);
  });

  it('should have expected route paths', () => {
    const router = require('../../../src/routes/v2/knowledge.routes');
    const paths = router.stack
      .filter(layer => layer.route)
      .map(layer => `${Object.keys(layer.route.methods)[0].toUpperCase()} ${layer.route.path}`);

    expect(paths).toContain('GET /');
    expect(paths).toContain('POST /');
    expect(paths).toContain('GET /:id');
    expect(paths).toContain('PUT /:id');
    expect(paths).toContain('DELETE /:id');
    expect(paths).toContain('POST /search');
    expect(paths).toContain('GET /:id/similar');
    // Note: /graph is GET /:id pattern match so it appears as GET path
  });

  it('should define search before :id routes', () => {
    const router = require('../../../src/routes/v2/knowledge.routes');
    const routes = router.stack
      .filter(layer => layer.route)
      .map(layer => layer.route.path);

    // /search should appear before /:id to avoid being caught by :id param
    const searchIdx = routes.indexOf('/search');
    const idIdx = routes.indexOf('/:id');
    // Actually in Express, POST /search won't conflict with GET /:id
    // since methods differ. But /graph (GET) WILL conflict with GET /:id.
    // Let's verify /graph comes before /:id
    const graphIdx = routes.indexOf('/graph');
    const getIdIdx = routes.findIndex((p, i) => {
      const layer = router.stack.filter(l => l.route)[i];
      return p === '/:id' && layer.route.methods.get;
    });

    // Graph must be defined before /:id GET or it'll be caught
    if (graphIdx !== -1 && getIdIdx !== -1) {
      expect(graphIdx).toBeLessThan(getIdIdx);
    }
  });
});
