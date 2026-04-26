/**
 * Onboarding routes — surfaces tied to the connect-flow UX.
 *
 * `POST /onboarding/test-connection` rounds-trips a `briefing()`-shaped
 * payload tuned for the onboarding TestPanel. Single endpoint instead
 * of extending briefing() so the agent contract stays unchanged.
 *
 * `GET /onboarding/recent-calls` powers the per-token "last call: 12s
 * ago" liveness indicator on /connect/* pages and Settings → Integrations.
 *
 * `GET /onboarding/releases/mcpb/latest` exposes the current Claude
 * Desktop .mcpb bundle metadata (version + URL + checksum) for the
 * one-click install button on /connect/claude-desktop.
 */

const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth.middleware');
const dal = require('../db/dal.cjs');
const graphitiBridge = require('../services/graphitiBridge');
const logger = require('../utils/logger');

const TEST_CONNECTION_TIMEOUT_MS = 5000;
const BELIEFS_PROBE_LIMIT = 500; // episodes are cheap; cap probe to bound latency

async function getUserPlanIds(userId, organizationId) {
  const { owned, shared, organization } = await dal.plansDal.listForUser(userId, { organizationId });
  return [...new Set([...owned, ...shared, ...organization].map((p) => p.id))];
}

/**
 * Compose the four briefing stat cards from existing services. Errors
 * in any single source degrade gracefully to `null` so the UI can show
 * a `—` placeholder rather than the whole panel failing.
 */
async function composeBriefing(req) {
  const userId = req.user.id;
  const organizationId = req.user.organizationId || null;
  const planIds = await getUserPlanIds(userId, organizationId);

  const goalsP = dal.goalsDal.findAll({ organizationId, userId }).catch(() => []);

  const plansCountP = planIds.length === 0
    ? Promise.resolve(0)
    : dal.plansDal.countByIds(planIds, { status: ['active'] }).catch(() => null);

  const decisionsP = (async () => {
    let total = 0;
    for (const planId of planIds) {
      try { total += await dal.decisionsDal.countPending(planId); } catch {}
    }
    return total;
  })();

  // Beliefs: Graphiti episode count is the proxy. Bound by BELIEFS_PROBE_LIMIT
  // since Graphiti has no native count; the soft cap is fine for onboarding
  // (the UI cares about "any" / order-of-magnitude, not exact totals).
  const groupId = organizationId ? `org_${organizationId}` : null;
  const beliefsP = (async () => {
    if (!groupId) return null;
    try {
      const res = await graphitiBridge.getEpisodes({ group_id: groupId, max_episodes: BELIEFS_PROBE_LIMIT });
      const episodes = res?.episodes?.episodes || res?.episodes || [];
      const count = Array.isArray(episodes) ? episodes.length : 0;
      return count >= BELIEFS_PROBE_LIMIT ? `${BELIEFS_PROBE_LIMIT}+` : count;
    } catch { return null; }
  })();

  const [goals, plansCount, decisionsCount, beliefsCount] = await Promise.all([
    goalsP, plansCountP, decisionsP, beliefsP,
  ]);

  const goalHealth = (goals || []).reduce(
    (acc, g) => {
      const h = g.health || 'on_track';
      acc[h] = (acc[h] || 0) + 1;
      acc.total += 1;
      return acc;
    },
    { on_track: 0, at_risk: 0, stale: 0, total: 0 },
  );

  // The UI renders this as the stat-card array. Order matters — these
  // are the four cards in 03-component-inventory.md TestPanel.
  return {
    cards: [
      {
        label: 'Goals',
        value: String(goalHealth.total),
        sub: goalHealth.total === 0
          ? 'No goals yet'
          : `${goalHealth.on_track} on track · ${goalHealth.at_risk} at risk`,
      },
      {
        label: 'Plans',
        value: plansCount === null ? '—' : String(plansCount),
        sub: plansCount === 0 ? 'No active plans' : 'Active',
      },
      {
        label: 'Decisions',
        value: String(decisionsCount),
        sub: 'Awaiting you',
      },
      {
        label: 'Beliefs',
        value: beliefsCount === null ? '—' : String(beliefsCount),
        sub: beliefsCount === null
          ? 'Knowledge graph unavailable'
          : 'Across all goals',
      },
    ],
    summary: {
      goals_count: goalHealth.total,
      goal_health: goalHealth,
      plans_count: plansCount,
      decisions_count: decisionsCount,
      beliefs_count: beliefsCount,
    },
  };
}

/**
 * @swagger
 * /onboarding/test-connection:
 *   post:
 *     summary: Test that an MCP/REST client can read a briefing
 *     tags: [Onboarding]
 *     responses:
 *       200:
 *         description: Connection ok; returns briefing stat-card payload
 *       500:
 *         description: Briefing failed; returns structured error envelope
 */
router.post('/test-connection', authenticate, async (req, res) => {
  const startedAt = Date.now();
  const timer = new Promise((_, reject) =>
    setTimeout(() => reject(new Error('TEST_TIMEOUT')), TEST_CONNECTION_TIMEOUT_MS),
  );

  try {
    const briefing = await Promise.race([composeBriefing(req), timer]);
    const elapsedMs = Date.now() - startedAt;
    res.json({
      ok: true,
      briefing,
      provenance: {
        endpoint: 'briefing()',
        server_time_ms: elapsedMs,
        client_label:
          req.headers['x-client-label'] ||
          req.headers['x-mcp-client'] ||
          (req.user.authMethod === 'jwt' ? 'web' : null),
      },
    });
  } catch (err) {
    const isTimeout = err && err.message === 'TEST_TIMEOUT';
    await logger.error('test-connection failed', err);
    res.status(isTimeout ? 504 : 500).json({
      ok: false,
      error: {
        code: isTimeout ? 'TIMEOUT' : 'INTERNAL',
        title: isTimeout
          ? 'Connection took too long'
          : 'Could not reach your workspace',
        plain: isTimeout
          ? 'The test took longer than 5 seconds. Your connection might be slow, or the server is busy. Try again in a moment.'
          : 'We hit an unexpected error while reading your workspace. The team has been notified.',
        technical: err && err.message ? err.message : String(err),
      },
    });
  }
});

/**
 * @swagger
 * /onboarding/recent-calls:
 *   get:
 *     summary: Recent tool_calls for the authenticated token (or org)
 *     description: Powers the "last call: 12s ago" liveness on /connect/* and Settings → Integrations.
 */
router.get('/recent-calls', authenticate, async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 20, 100);
    const tokenIdParam = req.query.token_id;

    let rows;
    if (tokenIdParam) {
      rows = await dal.toolCallsDal.listByToken(tokenIdParam, { limit });
    } else if (req.user.organizationId) {
      rows = await dal.toolCallsDal.recentByOrg(req.user.organizationId, { limit });
    } else {
      rows = [];
    }

    res.json({ calls: rows, fetched_at: new Date().toISOString() });
  } catch (err) {
    await logger.error('recent-calls failed', err);
    res.status(500).json({ error: 'Failed to fetch recent calls' });
  }
});

/**
 * @swagger
 * /onboarding/releases/mcpb/latest:
 *   get:
 *     summary: Latest .mcpb bundle metadata for one-click Claude Desktop install
 *     description: Static metadata JSON; refreshed at release time.
 */
const MCPB_RELEASE = {
  // Bumped at release time. Source of truth lives in
  // agent-planner-mcp/package.json + release artifacts.
  version: process.env.MCPB_LATEST_VERSION || '1.0.0',
  url: process.env.MCPB_LATEST_URL || 'https://github.com/TAgents/agent-planner-mcp/releases/latest/download/agent-planner.mcpb',
  sha256: process.env.MCPB_LATEST_SHA256 || null,
  published_at: process.env.MCPB_LATEST_PUBLISHED_AT || null,
  min_claude_desktop_version: '0.6.0',
};
router.get('/releases/mcpb/latest', (req, res) => {
  res.set('Cache-Control', 'public, max-age=60');
  res.json(MCPB_RELEASE);
});

module.exports = router;
