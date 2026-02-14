/**
 * Unit tests for the embeddings service.
 */
const axios = require('axios');

jest.mock('axios');
jest.mock('../../../src/utils/logger', () => ({
  error: jest.fn(),
  info: jest.fn(),
}));

const { generateEmbedding, generateEmbeddings, buildEmbeddingInput } = require('../../../src/services/embeddings');

describe('Embeddings Service', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv, OPENAI_API_KEY: 'test-key' };
    jest.clearAllMocks();
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe('generateEmbedding', () => {
    it('should generate a 1536-dim embedding', async () => {
      const fakeEmbedding = new Array(1536).fill(0.1);
      axios.post.mockResolvedValue({
        data: { data: [{ embedding: fakeEmbedding, index: 0 }] },
      });

      const result = await generateEmbedding('test input');

      expect(result).toEqual(fakeEmbedding);
      expect(result).toHaveLength(1536);
      expect(axios.post).toHaveBeenCalledWith(
        'https://api.openai.com/v1/embeddings',
        expect.objectContaining({ model: 'text-embedding-3-small', dimensions: 1536 }),
        expect.objectContaining({
          headers: expect.objectContaining({ Authorization: 'Bearer test-key' }),
        }),
      );
    });

    it('should throw if OPENAI_API_KEY is missing', async () => {
      delete process.env.OPENAI_API_KEY;
      await expect(generateEmbedding('test')).rejects.toThrow('OPENAI_API_KEY is required');
    });

    it('should truncate very long inputs', async () => {
      const fakeEmbedding = new Array(1536).fill(0.1);
      axios.post.mockResolvedValue({
        data: { data: [{ embedding: fakeEmbedding, index: 0 }] },
      });

      const longText = 'x'.repeat(50000);
      await generateEmbedding(longText);

      const calledInput = axios.post.mock.calls[0][1].input;
      expect(calledInput.length).toBe(30000);
    });

    it('should throw on API error', async () => {
      axios.post.mockRejectedValue({
        response: { status: 429, data: { error: { message: 'Rate limited' } } },
      });

      await expect(generateEmbedding('test')).rejects.toThrow('Rate limited');
    });
  });

  describe('generateEmbeddings (batch)', () => {
    it('should generate embeddings for multiple texts', async () => {
      const fakeEmb1 = new Array(1536).fill(0.1);
      const fakeEmb2 = new Array(1536).fill(0.2);
      axios.post.mockResolvedValue({
        data: {
          data: [
            { embedding: fakeEmb2, index: 1 },
            { embedding: fakeEmb1, index: 0 },
          ],
        },
      });

      const result = await generateEmbeddings(['text 1', 'text 2']);

      expect(result).toHaveLength(2);
      // Should be sorted by index
      expect(result[0]).toEqual(fakeEmb1);
      expect(result[1]).toEqual(fakeEmb2);
    });
  });

  describe('buildEmbeddingInput', () => {
    it('should combine title, content, and tags', () => {
      const result = buildEmbeddingInput({
        title: 'My Title',
        content: 'Some content here',
        tags: ['api', 'design'],
      });
      expect(result).toContain('My Title');
      expect(result).toContain('Some content here');
      expect(result).toContain('Tags: api, design');
    });

    it('should handle missing fields gracefully', () => {
      const result = buildEmbeddingInput({ title: 'Title Only' });
      expect(result).toBe('Title Only');
    });
  });
});
