/**
 * Rate Limiting Middleware
 * 
 * Protects API endpoints from abuse with configurable limits.
 * Uses in-memory store by default, can be extended to Redis for distributed deployments.
 */

const rateLimit = require('express-rate-limit');
const logger = require('../utils/logger');

// Default configuration from environment variables
const DEFAULT_GENERAL_LIMIT = parseInt(process.env.RATE_LIMIT_GENERAL) || 100;
const DEFAULT_GENERAL_WINDOW_MS = parseInt(process.env.RATE_LIMIT_GENERAL_WINDOW_MS) || 60 * 1000; // 1 minute

const DEFAULT_AUTH_LIMIT = parseInt(process.env.RATE_LIMIT_AUTH) || 10;
const DEFAULT_AUTH_WINDOW_MS = parseInt(process.env.RATE_LIMIT_AUTH_WINDOW_MS) || 60 * 1000; // 1 minute

const DEFAULT_SEARCH_LIMIT = parseInt(process.env.RATE_LIMIT_SEARCH) || 30;
const DEFAULT_SEARCH_WINDOW_MS = parseInt(process.env.RATE_LIMIT_SEARCH_WINDOW_MS) || 60 * 1000; // 1 minute

/**
 * Creates a standardized rate limit response
 */
const createRateLimitHandler = (type) => async (req, res) => {
  await logger.api(`Rate limit exceeded for ${type}: ${req.ip} - ${req.method} ${req.originalUrl}`);
  
  res.status(429).json({
    error: 'Too many requests',
    message: `You have exceeded the ${type} rate limit. Please try again later.`,
    type: type,
    retryAfter: res.getHeader('Retry-After')
  });
};

/**
 * Skip rate limiting for certain conditions
 */
const createSkipFunction = () => (req) => {
  // Skip rate limiting in test environment
  if (process.env.NODE_ENV === 'test') {
    return true;
  }
  
  // Skip for health check endpoint
  if (req.path === '/health') {
    return true;
  }
  
  return false;
};

/**
 * Key generator for rate limiting
 * Uses IP address, or user ID if authenticated
 */
const keyGenerator = (req) => {
  // If user is authenticated, use their user ID for more accurate limiting
  if (req.user && req.user.id) {
    return `user:${req.user.id}`;
  }
  
  // Fall back to IP address
  // Support for proxies (Cloud Run, nginx, etc.)
  const forwarded = req.headers['x-forwarded-for'];
  const ip = forwarded ? forwarded.split(',')[0].trim() : req.ip;
  return `ip:${ip}`;
};

/**
 * General API rate limiter
 * Applied to most endpoints
 * Default: 100 requests per minute
 */
const generalLimiter = rateLimit({
  windowMs: DEFAULT_GENERAL_WINDOW_MS,
  max: DEFAULT_GENERAL_LIMIT,
  standardHeaders: true, // Return rate limit info in `RateLimit-*` headers
  legacyHeaders: false, // Disable `X-RateLimit-*` headers
  skip: createSkipFunction(),
  keyGenerator: keyGenerator,
  handler: createRateLimitHandler('general'),
  message: {
    error: 'Too many requests',
    message: 'You have exceeded the rate limit. Please try again later.'
  },
  validate: false
});

/**
 * Auth endpoints rate limiter
 * Stricter limits to prevent brute force attacks
 * Default: 10 requests per minute
 */
const authLimiter = rateLimit({
  windowMs: DEFAULT_AUTH_WINDOW_MS,
  max: DEFAULT_AUTH_LIMIT,
  standardHeaders: true,
  legacyHeaders: false,
  skip: createSkipFunction(),
  keyGenerator: (req) => {
    // For auth endpoints, always use IP to prevent account enumeration
    const forwarded = req.headers['x-forwarded-for'];
    return forwarded ? forwarded.split(',')[0].trim() : req.ip;
  },
  handler: createRateLimitHandler('auth'),
  message: {
    error: 'Too many authentication attempts',
    message: 'You have exceeded the authentication rate limit. Please try again later.'
  },
  validate: false
});

/**
 * Search endpoints rate limiter
 * Moderate limits for computationally expensive operations
 * Default: 30 requests per minute
 */
const searchLimiter = rateLimit({
  windowMs: DEFAULT_SEARCH_WINDOW_MS,
  max: DEFAULT_SEARCH_LIMIT,
  standardHeaders: true,
  legacyHeaders: false,
  skip: createSkipFunction(),
  keyGenerator: keyGenerator,
  handler: createRateLimitHandler('search'),
  message: {
    error: 'Too many search requests',
    message: 'You have exceeded the search rate limit. Please try again later.'
  },
  validate: false
});

/**
 * Token generation rate limiter
 * Strict limits to prevent token abuse
 * Default: 5 requests per minute
 */
const tokenLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: parseInt(process.env.RATE_LIMIT_TOKEN) || 5,
  standardHeaders: true,
  legacyHeaders: false,
  skip: createSkipFunction(),
  keyGenerator: keyGenerator,
  handler: createRateLimitHandler('token'),
  message: {
    error: 'Too many token requests',
    message: 'You have exceeded the token generation rate limit. Please try again later.'
  },
  validate: false
});

/**
 * Webhook endpoints rate limiter
 * Moderate limits for webhook operations
 * Default: 20 requests per minute
 */
const webhookLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: parseInt(process.env.RATE_LIMIT_WEBHOOK) || 20,
  standardHeaders: true,
  legacyHeaders: false,
  skip: createSkipFunction(),
  keyGenerator: keyGenerator,
  handler: createRateLimitHandler('webhook'),
  message: {
    error: 'Too many webhook requests',
    message: 'You have exceeded the webhook rate limit. Please try again later.'
  },
  validate: false
});

module.exports = {
  generalLimiter,
  authLimiter,
  searchLimiter,
  tokenLimiter,
  webhookLimiter
};
