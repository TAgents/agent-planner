/**
 * Mock Supabase Client for Unit Tests
 * Provides a flexible mock that can be configured per test
 */

/**
 * Create a chainable mock query builder
 */
const createMockQueryBuilder = (resolvedData = null, resolvedError = null) => {
  const builder = {
    _data: resolvedData,
    _error: resolvedError,
    _filters: [],
    _selectFields: null,
    _single: false,
    _limit: null,
    _order: null,
    
    select: jest.fn(function(fields) {
      this._selectFields = fields;
      return this;
    }),
    
    insert: jest.fn(function(data) {
      return this;
    }),
    
    update: jest.fn(function(data) {
      return this;
    }),
    
    delete: jest.fn(function() {
      return this;
    }),
    
    eq: jest.fn(function(column, value) {
      this._filters.push({ type: 'eq', column, value });
      return this;
    }),
    
    neq: jest.fn(function(column, value) {
      this._filters.push({ type: 'neq', column, value });
      return this;
    }),
    
    in: jest.fn(function(column, values) {
      this._filters.push({ type: 'in', column, values });
      return this;
    }),
    
    is: jest.fn(function(column, value) {
      this._filters.push({ type: 'is', column, value });
      return this;
    }),
    
    ilike: jest.fn(function(column, pattern) {
      this._filters.push({ type: 'ilike', column, pattern });
      return this;
    }),
    
    or: jest.fn(function(conditions) {
      this._filters.push({ type: 'or', conditions });
      return this;
    }),
    
    order: jest.fn(function(column, options) {
      this._order = { column, ...options };
      return this;
    }),
    
    limit: jest.fn(function(count) {
      this._limit = count;
      return this;
    }),
    
    range: jest.fn(function(from, to) {
      return this;
    }),
    
    single: jest.fn(function() {
      this._single = true;
      return Promise.resolve({
        data: this._data,
        error: this._error
      });
    }),
    
    maybeSingle: jest.fn(function() {
      this._single = true;
      return Promise.resolve({
        data: this._data,
        error: this._error
      });
    }),
    
    then: function(resolve, reject) {
      const result = {
        data: this._data,
        error: this._error,
        count: Array.isArray(this._data) ? this._data.length : (this._data ? 1 : 0)
      };
      return Promise.resolve(result).then(resolve, reject);
    }
  };
  
  // Bind all methods to the builder
  Object.keys(builder).forEach(key => {
    if (typeof builder[key] === 'function' && key !== 'then') {
      builder[key] = builder[key].bind(builder);
    }
  });
  
  return builder;
};

/**
 * Create a mock Supabase client
 */
const createMockSupabaseClient = () => {
  // Store for mocked responses per table
  const mockResponses = new Map();
  
  const client = {
    // Set mock response for a table
    setMockResponse: (table, data, error = null) => {
      mockResponses.set(table, { data, error });
    },
    
    // Clear all mock responses
    clearMockResponses: () => {
      mockResponses.clear();
    },
    
    // The from method that returns query builder
    from: jest.fn((table) => {
      const response = mockResponses.get(table) || { data: null, error: null };
      return createMockQueryBuilder(response.data, response.error);
    }),
    
    // RPC calls
    rpc: jest.fn((functionName, params) => {
      const response = mockResponses.get(`rpc:${functionName}`) || { data: null, error: null };
      return Promise.resolve(response);
    }),
    
    // Auth methods
    auth: {
      getUser: jest.fn(() => Promise.resolve({ data: { user: null }, error: null })),
      signInWithPassword: jest.fn(() => Promise.resolve({ data: { user: null, session: null }, error: null })),
      signOut: jest.fn(() => Promise.resolve({ error: null }))
    },
    
    // Storage methods
    storage: {
      from: jest.fn((bucket) => ({
        upload: jest.fn(() => Promise.resolve({ data: { path: 'mock/path' }, error: null })),
        download: jest.fn(() => Promise.resolve({ data: new Blob(), error: null })),
        remove: jest.fn(() => Promise.resolve({ data: null, error: null })),
        getPublicUrl: jest.fn((path) => ({ data: { publicUrl: `https://mock.supabase.co/${bucket}/${path}` } }))
      }))
    }
  };
  
  return client;
};

/**
 * Create the default mock module for jest.mock
 */
const createSupabaseMock = () => {
  const mockClient = createMockSupabaseClient();
  
  return {
    supabaseAdmin: mockClient,
    supabase: mockClient,
    createClient: () => mockClient
  };
};

module.exports = {
  createMockQueryBuilder,
  createMockSupabaseClient,
  createSupabaseMock
};
