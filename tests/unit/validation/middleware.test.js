/**
 * Unit Tests for Validation Middleware
 */

const { z } = require('zod');
const {
  validate,
  validateBody,
  validateParams,
  validateQuery,
  formatZodError
} = require('../../../src/validation/middleware');
const {
  createMockRequest,
  createMockResponse,
  createMockNext
} = require('../../fixtures/testData');

describe('Validation Middleware', () => {
  describe('formatZodError', () => {
    it('should format Zod errors with field paths', () => {
      const schema = z.object({
        name: z.string().min(1),
        age: z.number().positive()
      });

      try {
        schema.parse({ name: '', age: -1 });
      } catch (error) {
        const formatted = formatZodError(error);
        
        expect(formatted.error).toBe('Validation failed');
        expect(formatted.message).toBeDefined();
        expect(formatted.details).toBeInstanceOf(Array);
        expect(formatted.details.length).toBe(2);
        
        const fields = formatted.details.map(d => d.field);
        expect(fields).toContain('name');
        expect(fields).toContain('age');
      }
    });

    it('should handle root-level errors', () => {
      const schema = z.string().email();

      try {
        schema.parse('not-an-email');
      } catch (error) {
        const formatted = formatZodError(error);
        
        expect(formatted.details[0].field).toBe('root');
      }
    });
  });

  describe('validateBody', () => {
    const schema = z.object({
      title: z.string().min(1, 'Title is required'),
      count: z.number().optional()
    });

    it('should pass validation with valid body', async () => {
      const req = createMockRequest({
        body: { title: 'Test', count: 5 }
      });
      const res = createMockResponse();
      const next = createMockNext();

      await validateBody(schema)(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(req.body.title).toBe('Test');
      expect(req.body.count).toBe(5);
    });

    it('should return 400 with invalid body', async () => {
      const req = createMockRequest({
        body: { title: '', count: 'not-a-number' }
      });
      const res = createMockResponse();
      const next = createMockNext();

      await validateBody(schema)(req, res, next);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalled();
      expect(next).not.toHaveBeenCalled();
      
      const response = res.json.mock.calls[0][0];
      expect(response.error).toBe('Validation failed');
    });

    it('should apply default values from schema', async () => {
      const schemaWithDefault = z.object({
        title: z.string(),
        status: z.string().default('draft')
      });

      const req = createMockRequest({
        body: { title: 'Test' }
      });
      const res = createMockResponse();
      const next = createMockNext();

      await validateBody(schemaWithDefault)(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(req.body.status).toBe('draft');
    });
  });

  describe('validateParams', () => {
    const schema = z.object({
      id: z.string().uuid()
    });

    it('should pass validation with valid UUID', async () => {
      const req = createMockRequest({
        params: { id: '550e8400-e29b-41d4-a716-446655440000' }
      });
      const res = createMockResponse();
      const next = createMockNext();

      await validateParams(schema)(req, res, next);

      expect(next).toHaveBeenCalled();
    });

    it('should return 400 with invalid UUID', async () => {
      const req = createMockRequest({
        params: { id: 'not-a-uuid' }
      });
      const res = createMockResponse();
      const next = createMockNext();

      await validateParams(schema)(req, res, next);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(next).not.toHaveBeenCalled();
    });
  });

  describe('validateQuery', () => {
    const schema = z.object({
      page: z.coerce.number().int().min(1).default(1),
      limit: z.coerce.number().int().min(1).max(100).default(10)
    });

    it('should coerce and validate query parameters', async () => {
      const req = createMockRequest({
        query: { page: '2', limit: '50' }
      });
      const res = createMockResponse();
      const next = createMockNext();

      await validateQuery(schema)(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(req.query.page).toBe(2);
      expect(req.query.limit).toBe(50);
    });

    it('should apply defaults when query params missing', async () => {
      const req = createMockRequest({
        query: {}
      });
      const res = createMockResponse();
      const next = createMockNext();

      await validateQuery(schema)(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(req.query.page).toBe(1);
      expect(req.query.limit).toBe(10);
    });

    it('should return 400 when limit exceeds max', async () => {
      const req = createMockRequest({
        query: { limit: '200' }
      });
      const res = createMockResponse();
      const next = createMockNext();

      await validateQuery(schema)(req, res, next);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(next).not.toHaveBeenCalled();
    });
  });

  describe('validate (combined)', () => {
    const schemas = {
      params: z.object({ id: z.string().uuid() }),
      body: z.object({ title: z.string().min(1) }),
      query: z.object({ include: z.string().optional() })
    };

    it('should run all validators in correct order', async () => {
      const req = createMockRequest({
        params: { id: '550e8400-e29b-41d4-a716-446655440000' },
        body: { title: 'Test' },
        query: { include: 'details' }
      });
      const res = createMockResponse();
      const next = createMockNext();

      const middlewares = validate(schemas);
      
      // Run all middlewares
      for (const middleware of middlewares) {
        await middleware(req, res, next);
      }

      // next should be called once per successful middleware
      expect(next).toHaveBeenCalledTimes(3);
    });

    it('should stop on first validation failure', async () => {
      const req = createMockRequest({
        params: { id: 'invalid' },
        body: { title: 'Test' },
        query: {}
      });
      const res = createMockResponse();
      const next = createMockNext();

      const middlewares = validate(schemas);
      
      // First middleware (params) should fail
      await middlewares[0](req, res, next);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(next).not.toHaveBeenCalled();
    });

    it('should only create middlewares for provided schemas', () => {
      const middlewares = validate({ body: schemas.body });
      
      expect(middlewares.length).toBe(1);
    });
  });
});
