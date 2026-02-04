/**
 * Embedding Service
 * 
 * Generates vector embeddings using OpenAI's embedding API.
 * Used for semantic search in knowledge stores.
 */

const logger = require('../utils/logger');

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL || 'text-embedding-3-small';
const EMBEDDING_DIMENSIONS = parseInt(process.env.EMBEDDING_DIMENSIONS || '1536', 10);

/**
 * Check if embedding service is configured
 */
const isConfigured = () => {
  return !!OPENAI_API_KEY;
};

/**
 * Generate embedding for a single text
 * @param {string} text - Text to embed
 * @returns {Promise<number[]|null>} - Embedding vector or null if failed
 */
const generateEmbedding = async (text) => {
  if (!OPENAI_API_KEY) {
    await logger.warn('Embedding service not configured: OPENAI_API_KEY missing');
    return null;
  }

  if (!text || text.trim().length === 0) {
    return null;
  }

  try {
    const response = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: EMBEDDING_MODEL,
        input: text.slice(0, 8000), // Truncate to avoid token limits
        dimensions: EMBEDDING_DIMENSIONS,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      await logger.error('OpenAI embedding API error:', error);
      return null;
    }

    const data = await response.json();
    return data.data[0].embedding;
  } catch (error) {
    await logger.error('Failed to generate embedding:', error);
    return null;
  }
};

/**
 * Generate embeddings for multiple texts (batch)
 * @param {string[]} texts - Array of texts to embed
 * @returns {Promise<(number[]|null)[]>} - Array of embeddings
 */
const generateEmbeddings = async (texts) => {
  if (!OPENAI_API_KEY) {
    await logger.warn('Embedding service not configured: OPENAI_API_KEY missing');
    return texts.map(() => null);
  }

  const validTexts = texts.map(t => (t && t.trim()) || '');
  
  try {
    const response = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: EMBEDDING_MODEL,
        input: validTexts.map(t => t.slice(0, 8000)),
        dimensions: EMBEDDING_DIMENSIONS,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      await logger.error('OpenAI batch embedding API error:', error);
      return texts.map(() => null);
    }

    const data = await response.json();
    // OpenAI returns embeddings in the same order as input
    return data.data.map(d => d.embedding);
  } catch (error) {
    await logger.error('Failed to generate batch embeddings:', error);
    return texts.map(() => null);
  }
};

/**
 * Create searchable text from a knowledge entry
 * Combines title, content, and tags for better semantic matching
 */
const createSearchableText = (entry) => {
  const parts = [];
  if (entry.title) parts.push(entry.title);
  if (entry.content) parts.push(entry.content);
  if (entry.tags && entry.tags.length > 0) {
    parts.push(`Tags: ${entry.tags.join(', ')}`);
  }
  return parts.join('\n\n');
};

module.exports = {
  isConfigured,
  generateEmbedding,
  generateEmbeddings,
  createSearchableText,
  EMBEDDING_MODEL,
  EMBEDDING_DIMENSIONS,
};
