/**
 * v1 spec extraction — derives the public OpenAPI document from the full
 * (internal) spec by keeping only operations tagged `v1`. Used by both the
 * runtime Swagger UI (src/index.js) and the docs generator
 * (scripts/generate-docs.js) so the two can't drift.
 */

const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete', 'options', 'head', 'trace'];

/**
 * Build the v1 spec from the full spec. Only paths under /v1 with at least
 * one `v1`-tagged operation survive; non-tagged operations on a surviving
 * path are dropped too.
 */
function extractV1Spec(fullSpec) {
  const paths = {};
  for (const [route, methods] of Object.entries(fullSpec.paths || {})) {
    if (!route.startsWith('/v1')) continue;
    const kept = {};
    for (const [method, op] of Object.entries(methods || {})) {
      if (!HTTP_METHODS.includes(method)) continue;
      if (Array.isArray(op.tags) && op.tags.includes('v1')) kept[method] = op;
    }
    if (Object.keys(kept).length > 0) paths[route] = kept;
  }

  return {
    openapi: fullSpec.openapi || '3.0.0',
    info: {
      title: 'AgentPlanner API',
      version: '1.0.0',
      description:
        'The public, versioned AgentPlanner API (~70 intent-shaped endpoints). ' +
        'This is the surface we commit to: stable shapes, deprecation policy, ' +
        'documented here. Hosted base URL: https://agentplanner.io/api/v1. ' +
        'The full internal spec (unversioned, subject to change without notice) ' +
        'is served at /api-docs/internal.',
    },
    servers: [
      { url: 'https://agentplanner.io/api', description: 'Hosted (paths already include /v1)' },
      { url: 'http://localhost:3000', description: 'Local development' },
    ],
    components: fullSpec.components,
    paths,
  };
}

module.exports = { extractV1Spec };
