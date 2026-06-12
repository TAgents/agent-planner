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
 *
 * Trade-off: re-dispatch mutates req.url/req.method in place, so logs and
 * error traces emitted inside the forwarded handler show the INTERNAL path
 * (e.g. /plans/:id/nodes), not the originating /v1/... path. The original
 * URL is still available as req.originalUrl (which is what the request
 * logger and tool-call telemetry record).
 */
function forwardTo(targetRouter, buildPath, { method } = {}) {
  return (req, res, next) => {
    const qIdx = req.url.indexOf('?');
    const originalQuery = qIdx === -1 ? '' : req.url.slice(qIdx + 1);
    let url = buildPath(req);
    if (originalQuery) url += (url.includes('?') ? '&' : '?') + originalQuery;
    req.url = url;
    if (method) req.method = method;
    // Express parses req.query eagerly from the ORIGINAL url, so query params
    // introduced by buildPath (e.g. ?node_id=... on the tasks/context alias)
    // would be invisible to the forwarded handler. Rebuild from the rewritten
    // url — it contains both the built and the original params.
    const newQIdx = url.indexOf('?');
    if (newQIdx !== -1) {
      const merged = {};
      for (const [k, v] of new URLSearchParams(url.slice(newQIdx + 1))) merged[k] = v;
      req.query = merged;
    }
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
