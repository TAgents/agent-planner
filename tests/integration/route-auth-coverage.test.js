/**
 * Route auth-coverage guard (access-control audit, commercial gate #1).
 *
 * Boots the fully-mounted app router (without opening a DB connection or
 * binding a port — index.js only calls startServer() when run directly) and
 * walks app._router.stack to enumerate every registered route. Asserts that
 * every route either applies the `authenticate` middleware (directly or via a
 * router-level blanket) or is in the explicit PUBLIC_ALLOWLIST.
 *
 * Adding a new authenticated route needs no change here. Adding a PUBLIC route
 * forces a conscious edit to the allowlist below — which is the point: an
 * unprotected route can't ship unnoticed. See docs/ACCESS_CONTROL_AUDIT.md.
 */

const app = require('../../src/index');
const { authenticate } = require('../../src/middleware/auth.middleware');

// Every intentionally-public route, as "METHOD /path". Keep alphabetised-ish
// by group. A route here is asserted to genuinely have NO `authenticate`.
const PUBLIC_ALLOWLIST = new Set([
  // App basics
  'GET /',
  'GET /health',
  'GET /files/*', // dev-only static (NODE_ENV=development); harmless to allow
  // Auth bootstrap + recovery + OAuth (internal /auth)
  'POST /auth/register',
  'POST /auth/login',
  'POST /auth/logout',
  'POST /auth/refresh',
  'GET /auth/oauth/providers',
  'POST /auth/google/callback',
  'POST /auth/github/callback',
  'POST /auth/forgot-password',
  'POST /auth/reset-password',
  'POST /auth/verify-email',
  'POST /auth/resend-verification',
  // Public v1 bootstrap (the rest of /v1 is behind the router-level blanket)
  'POST /v1/auth/register',
  'POST /v1/auth/login',
  'POST /v1/auth/refresh',
  // Public plan surface (visibility-gated in the handler)
  'GET /plans/public',
  'GET /plans/public/sitemap.xml',
  'GET /plans/public/:id',
  'GET /plans/public/:id/og.svg',
  'GET /plans/public/:id/knowledge-digest',
  'GET /plans/:id/public',
  'POST /plans/:id/view',
  // Public blueprint gallery (visibility-gated)
  'GET /blueprints/public',
  'GET /blueprints/public/:id',
  // Token-scoped invite preview + misc public
  'GET /invites/info/:token',
  'GET /stats/',
  'GET /onboarding/releases/mcpb/latest',
  'GET /integrations/slack/callback',
]);

/**
 * Recover a router mount prefix from its layer regexp (e.g. /v1, /plans).
 * Express 4.x compiles mount paths into regexps of the form `^\/prefix\/?(?=...)`.
 * If that internal format ever changes, decodePrefix returns null and
 * collectRoutes throws loudly (rather than silently skipping a sub-tree).
 */
function decodePrefix(layer) {
  if (layer.regexp && layer.regexp.fast_slash) return '';
  const m = layer.regexp && layer.regexp.source.match(/^\^\\\/(.*?)\\\/\?\(\?=/);
  return m ? '/' + m[1].replace(/\\\//g, '/') : null;
}

/** Walk a router stack, tracking a router-level `authenticate` blanket. */
function collectRoutes(stack, prefix, inheritedAuth, out) {
  let blanketAuth = inheritedAuth;
  for (const layer of stack) {
    if (layer.route) {
      const routeHasAuth =
        blanketAuth || layer.route.stack.some((s) => s.handle === authenticate);
      for (const method of Object.keys(layer.route.methods)) {
        out.push({ method: method.toUpperCase(), path: prefix + layer.route.path, auth: routeHasAuth });
      }
    } else if (layer.name === 'router' && layer.handle && layer.handle.stack) {
      const sub = decodePrefix(layer);
      // null prefix = a mount-regexp shape we don't recognise; fail loudly
      // rather than silently skip a whole sub-tree.
      if (sub === null) {
        throw new Error(`Unrecognised router mount regexp (check decodePrefix): ${layer.regexp?.source}`);
      }
      collectRoutes(layer.handle.stack, prefix + sub, blanketAuth, out);
    } else if (layer.handle === authenticate) {
      blanketAuth = true; // router-level blanket applies to subsequent layers
    }
  }
}

describe('route auth coverage', () => {
  let routes;

  beforeAll(() => {
    routes = [];
    collectRoutes(app._router.stack, '', false, routes);
  });

  it('discovers a realistic number of routes (introspection sanity check)', () => {
    expect(routes.length).toBeGreaterThan(200);
  });

  it('every route is authenticated or explicitly public', () => {
    const unprotected = routes
      .filter((r) => !r.auth)
      .map((r) => `${r.method} ${r.path}`)
      .filter((sig) => !PUBLIC_ALLOWLIST.has(sig));

    expect(unprotected).toEqual([]);
  });

  it('the allowlist has no stale entries (every listed route still exists and is public)', () => {
    const noAuthSigs = new Set(
      routes.filter((r) => !r.auth).map((r) => `${r.method} ${r.path}`)
    );
    const stale = [...PUBLIC_ALLOWLIST].filter((sig) => !noAuthSigs.has(sig));
    // /files/* only mounts when NODE_ENV=development; tolerate its absence.
    const staleReal = stale.filter((s) => s !== 'GET /files/*');
    expect(staleReal).toEqual([]);
  });
});
