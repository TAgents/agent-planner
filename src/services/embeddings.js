/**
 * Embedding generation service using OpenAI text-embedding-3-small.
 * 
 * Produces 1536-dimension vectors for semantic search via pgvector.
 */
const axios = require('axios');
const logger = require('../utils/logger');

const OPENAI_API_URL = 'https://api.openai.com/v1/embeddings';
const MODEL = process.env.EMBEDDING_MODEL || 'text-embedding-3-small';
const DIMENSIONS = 1536;

// Max tokens for embedding model (~8191 for text-embedding-3-small)
const MAX_INPUT_CHARS = 30000;

/**
 * Generate an embedding vector for the given text.
 * @param {string} text - Input text to embed
 * @returns {Promise<number[]>} - 1536-dim float array
 */
async function generateEmbedding(text) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is required for embedding generation');
  }

  // Truncate very long inputs
  const input = text.length > MAX_INPUT_CHARS ? text.slice(0, MAX_INPUT_CHARS) : text;

  try {
    const response = await axios.post(
      OPENAI_API_URL,
      { model: MODEL, input, dimensions: DIMENSIONS },
      {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        timeout: 30000,
      }
    );

    return response.data.data[0].embedding;
  } catch (err) {
    const status = err.response?.status;
    const message = err.response?.data?.error?.message || err.message;
    await logger.error(`Embedding generation failed (${status}): ${message}`);
    throw new Error(`Embedding generation failed: ${message}`);
  }
}

/**
 * Generate embeddings for multiple texts in a single API call.
 * @param {string[]} texts - Array of input texts
 * @returns {Promise<number[][]>} - Array of 1536-dim float arrays
 */
async function generateEmbeddings(texts) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is required for embedding generation');
  }

  const inputs = texts.map(t => t.length > MAX_INPUT_CHARS ? t.slice(0, MAX_INPUT_CHARS) : t);

  try {
    const response = await axios.post(
      OPENAI_API_URL,
      { model: MODEL, input: inputs, dimensions: DIMENSIONS },
      {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        timeout: 60000,
      }
    );

    // Sort by index to maintain order
    return response.data.data
      .sort((a, b) => a.index - b.index)
      .map(d => d.embedding);
  } catch (err) {
    const status = err.response?.status;
    const message = err.response?.data?.error?.message || err.message;
    await logger.error(`Batch embedding generation failed (${status}): ${message}`);
    throw new Error(`Batch embedding generation failed: ${message}`);
  }
}

/**
 * Build embeddable text from a knowledge entry's fields.
 * Combines title + content + tags for richer embedding.
 */
function buildEmbeddingInput(entry) {
  const parts = [];
  if (entry.title) parts.push(entry.title);
  if (entry.content) parts.push(entry.content);
  if (entry.tags?.length) parts.push(`Tags: ${entry.tags.join(', ')}`);
  return parts.join('\n\n');
}

module.exports = {
  generateEmbedding,
  generateEmbeddings,
  buildEmbeddingInput,
  DIMENSIONS,
  MODEL,
};
