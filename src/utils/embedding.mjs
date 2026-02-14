/**
 * Embedding utility (ESM wrapper).
 * 
 * Uses OpenAI text-embedding-3-small (1536 dimensions).
 * Graceful fallback: returns null + logs warning if no API key.
 */
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

const logger = require('./logger');

const OPENAI_API_URL = 'https://api.openai.com/v1/embeddings';
const MODEL = process.env.EMBEDDING_MODEL || 'text-embedding-3-small';
const DIMENSIONS = 1536;
const MAX_INPUT_CHARS = 30000;

/**
 * Generate an embedding vector for the given text.
 * Returns null (with warning) if OPENAI_API_KEY is not set.
 * 
 * @param {string} text - Input text to embed
 * @returns {Promise<number[]|null>} - 1536-dim float array or null
 */
export async function generateEmbedding(text) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    await logger.info('OPENAI_API_KEY not set — skipping embedding generation');
    return null;
  }

  const input = text.length > MAX_INPUT_CHARS ? text.slice(0, MAX_INPUT_CHARS) : text;

  // Dynamic import axios (may be CJS)
  const axios = require('axios');

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
}

export { MODEL, DIMENSIONS };
