/**
 * v1 forwarding helpers.
 *
 * The /v1 surface aliases existing internal routes without re-implementing
 * them: each v1 route rewrites the request path (and method where the v1
 * shape differs, e.g. PATCH → PUT) and re-dispatches into the internal
 * router instance. The internal handler runs exactly as if the legacy path
 * had been hit directly — same auth, validation, and behavior.
 */

const e = encodeURIComponent;

/**
 * Build a handler that forwards into `targetRouter`.
 *
 * @param {import('express').Router} targetRouter - internal router instance
 * @param {(req) => string} buildPath - path relative to the target router's
 *   own mount point. May include its own query string; the original
 *   request's query string is appended either way.
 * @param {{ method?: string }} [opts] - optional method override (e.g.
 *   v1 PATCH forwarding to an internal PUT handler).
 */
function forwardTo(targetRouter, buildPath, { method } = {}) {
  return (req, res, next) => {
    const qIdx = req.url.indexOf('?');
    const originalQuery = qIdx === -1 ? '' : req.url.slice(qIdx + 1);
    let url = buildPath(req);
    if (originalQuery) url += (url.includes('?') ? '&' : '?') + originalQuery;
    req.url = url;
    if (method) req.method = method;
    targetRouter(req, res, next);
  };
}

/**
 * Map a facade ServiceError-style error onto the structured v1 error shape.
 */
function sendFacadeError(res, err) {
  const status = err.statusCode || 500;
  const body = { error: err.message || 'Internal Server Error' };
  if (err.code) body.code = err.code;
  res.status(status).json(body);
}

/**
 * Express 4 param pattern constraining an id to UUID shape. Used on v1
 * routes whose internal target router has literal sibling paths (e.g.
 * /plans/public, /goals/tree, /blueprints/public) so those internal
 * endpoints can't be reached through a v1 :id parameter.
 */
const UUID = '([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})';

module.exports = { forwardTo, sendFacadeError, e, UUID };
