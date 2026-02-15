// CJS bridge for DAL — allows existing CommonJS controllers to import
// Usage: const { usersDal, plansDal } = require('../db/dal.cjs');

let _dal = null;
let _loading = null;

function loadDal() {
  if (_dal) return Promise.resolve(_dal);
  if (_loading) return _loading;

  _loading = import('./dal/index.mjs').then(mod => {
    _dal = mod;
    return _dal;
  });

  return _loading;
}

// Proxy that lazy-loads the ESM module
const handler = {
  get(_, prop) {
    // Allow Promise resolution checks (e.g. Promise.resolve(proxy.foo))
    if (prop === 'then' || prop === 'catch' || prop === 'finally') return undefined;
    return new Proxy({}, {
      get(_, method) {
        // Allow Promise resolution checks on sub-proxies too
        if (method === 'then' || method === 'catch' || method === 'finally') return undefined;
        return async (...args) => {
          const dal = await loadDal();
          if (!dal[prop]) throw new Error(`DAL module '${prop}' not found`);
          if (typeof dal[prop][method] !== 'function') {
            throw new Error(`DAL method '${prop}.${method}' not found`);
          }
          return dal[prop][method](...args);
        };
      },
    });
  },
};

module.exports = new Proxy({}, handler);
