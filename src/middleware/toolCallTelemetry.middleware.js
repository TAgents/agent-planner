/**
 * Tool-call telemetry — records one row in `tool_calls` per authenticated
 * REST request, keyed by API token / organization.
 *
 * Fire-and-forget: the insert happens after `res.finish` so it never
 * delays the response. Errors are swallowed inside the DAL.
 *
 * Mount AFTER the auth middleware so `req.user` is populated.
 */
const dal = require('../db/dal.cjs');

/** Cheap heuristic mapping a User-Agent header to a friendly client label. */
function inferClientLabel(userAgent) {
  if (!userAgent) return null;
  const ua = userAgent.toLowerCase();
  if (ua.includes('claude-code')) return 'Claude Code';
  if (ua.includes('claude') && ua.includes('desktop')) return 'Claude Desktop';
  if (ua.includes('claude')) return 'Claude';
  if (ua.includes('cursor')) return 'Cursor';
  if (ua.includes('chatgpt') || ua.includes('openai')) return 'ChatGPT';
  if (ua.includes('openclaw')) return 'OpenClaw';
  if (ua.includes('mcp')) return 'MCP Client';
  return null;
}

/**
 * Build a stable `tool_name` for the row. Prefers the matched route
 * pattern (e.g. "GET /plans/:id") so different IDs collapse onto one
 * key — useful for dashboard aggregations. Falls back to req.originalUrl.
 */
function buildToolName(req) {
  const method = req.method || 'GET';
  const routePath = req.route && req.route.path;
  const baseUrl = req.baseUrl || '';
  if (routePath) return `${method} ${baseUrl}${routePath}`.replace(/\/$/, '') || `${method} /`;
  return `${method} ${req.originalUrl || req.url || '/'}`.split('?')[0];
}

function clientIp(req) {
  const fwd = req.headers && req.headers['x-forwarded-for'];
  if (fwd && typeof fwd === 'string') return fwd.split(',')[0].trim();
  return req.ip || (req.connection && req.connection.remoteAddress) || null;
}

/**
 * Express middleware: records a tool_calls row on `res.finish`.
 *
 * Mount globally BEFORE the routes — `req.user` is read lazily inside
 * the finish handler so auth middleware (which runs per-route) has
 * populated it by then. Skips recording for unauthenticated requests.
 */
const recordToolCall = (req, res, next) => {
  const startedAt = Date.now();
  const userAgent = (req.headers && req.headers['user-agent']) || null;
  const ip = clientIp(req);
  const clientLabel =
    (req.headers && (req.headers['x-client-label'] || req.headers['x-mcp-client'])) ||
    inferClientLabel(userAgent);

  res.on('finish', () => {
    if (!req.user) return; // unauthenticated — skip telemetry
    // Best-effort fire-and-forget; DAL swallows its own errors.
    dal.toolCallsDal
      .record({
        tokenId: req.user.tokenId || null,
        organizationId: req.user.organizationId || null,
        toolName: buildToolName(req),
        clientLabel,
        userAgent,
        ip,
        durationMs: Date.now() - startedAt,
        responseStatus: res.statusCode || null,
      })
      .catch(() => {});
  });

  return next();
};

module.exports = { recordToolCall, inferClientLabel, buildToolName };
