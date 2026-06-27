/**
 * Service version info, surfaced at GET /version and inside GET /health.
 *
 * Lets you confirm exactly which build is running — the source of much
 * confusion when the same service is reachable through several routes
 * (hosted container vs. local dev vs. npx). The `commit` is best-effort:
 * set GIT_SHA (or COMMIT_SHA) at build/deploy time to populate it.
 */

const pkg = require('../package.json');

const STARTED_AT = new Date();

function versionInfo() {
  return {
    service: 'agent-planner-api',
    version: pkg.version,
    commit: process.env.GIT_SHA || process.env.COMMIT_SHA || 'unknown',
    node: process.version,
    started_at: STARTED_AT.toISOString(),
    uptime_seconds: Math.round(process.uptime()),
  };
}

module.exports = { versionInfo };
