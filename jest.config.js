/**
 * Jest Configuration for Agent Planner
 */
module.exports = {
  // Test environment
  testEnvironment: 'node',

  // File patterns for tests
  testMatch: [
    '**/__tests__/**/*.js',
    '**/*.test.js',
    '**/*.spec.js'
  ],

  // Coverage configuration
  collectCoverageFrom: [
    'src/**/*.js',
    '!src/index.js',
    '!src/config/**',
    '!src/db/**',
    '!src/**/*.test.js',
    '!src/**/*.spec.js'
  ],

  // Coverage thresholds — baseline locked during architecture refactor (Phase 0, 2026-03-28)
  // Current: ~17% statements, ~8% branches/functions, ~18% lines
  // These must not decrease during refactor — increase as tests are added
  coverageThreshold: {
    global: {
      branches: 7,
      functions: 7,
      lines: 13,
      statements: 12
    }
  },

  // Coverage output
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'html'],

  // Setup files
  setupFilesAfterEnv: ['<rootDir>/tests/setup/jest.setup.js'],

  // Module paths
  modulePathIgnorePatterns: ['<rootDir>/node_modules/'],

  // Test timeout (30 seconds for integration tests)
  testTimeout: 30000,

  // Verbose output
  verbose: true,

  // Clear mocks between tests
  clearMocks: true,

  // Restore mocks after each test
  restoreMocks: true,

  // Projects for different test types
  projects: [
    {
      displayName: 'unit',
      testMatch: ['<rootDir>/tests/unit/**/*.test.js', '<rootDir>/src/**/*.test.js'],
      testEnvironment: 'node'
    },
    {
      displayName: 'integration',
      testMatch: ['<rootDir>/tests/integration/**/*.test.js'],
      testEnvironment: 'node'
    }
  ]
};
