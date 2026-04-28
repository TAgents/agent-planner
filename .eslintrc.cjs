module.exports = {
  root: true,
  env: {
    es2022: true,
    jest: true,
    node: true,
  },
  extends: ['eslint:recommended'],
  ignorePatterns: ['**/*.test.js'],
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'script',
  },
  rules: {
    'no-console': 'off',
    'no-empty': ['error', { allowEmptyCatch: true }],
    'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
  },
};
