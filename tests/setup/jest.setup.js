/**
 * Jest Setup - Runs before each test file
 */

// Extend Jest matchers
require('jest-extended');

// Set test environment
process.env.NODE_ENV = 'test';

// Increase timeout for integration tests
jest.setTimeout(30000);

// Global mock for logger to suppress output during tests
jest.mock('../../src/utils/logger', () => ({
  api: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  info: jest.fn(),
  debug: jest.fn()
}));

// Global beforeAll - runs once before all tests
beforeAll(async () => {
  // Any global setup
});

// Global afterAll - runs once after all tests
afterAll(async () => {
  // Clean up any global resources
});
