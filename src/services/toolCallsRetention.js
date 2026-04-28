/**
 * Tool-call telemetry retention.
 *
 * Periodically deletes rows from `tool_calls` older than the configured
 * window so the table doesn't grow unbounded. Runs in-process inside
 * the API server via setInterval — no external scheduler dependency.
 *
 * Configurable via env vars:
 *   TOOL_CALLS_RETENTION_DAYS         (default: 90)
 *   TOOL_CALLS_RETENTION_INTERVAL_MS  (default: 24h)
 *   TOOL_CALLS_RETENTION_DISABLED     (default: false; set "true" to skip)
 *
 * Also re-exported via the CLI script scripts/purge-tool-calls.mjs for
 * one-shot ops use (e.g. running from a backup/restore checklist).
 */

const dal = require('../db/dal.cjs');
const logger = require('../utils/logger');

const DEFAULT_RETENTION_DAYS = 90;
const DEFAULT_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24h

function readConfig(overrides = {}) {
  const envDays = Number(process.env.TOOL_CALLS_RETENTION_DAYS);
  const envInterval = Number(process.env.TOOL_CALLS_RETENTION_INTERVAL_MS);
  const days = overrides.retentionDays || (envDays > 0 ? envDays : DEFAULT_RETENTION_DAYS);
  const intervalMs =
    overrides.intervalMs || (envInterval > 0 ? envInterval : DEFAULT_INTERVAL_MS);
  const disabled =
    overrides.disabled !== undefined
      ? Boolean(overrides.disabled)
      : String(process.env.TOOL_CALLS_RETENTION_DISABLED).toLowerCase() === 'true';
  return { days, intervalMs, disabled };
}

/**
 * Run one purge pass. Resolves with the number of deleted rows. Errors
 * are logged but never thrown — retention failures must not crash the
 * API. The returned promise always resolves.
 */
async function runOnce(overrides = {}) {
  const { days } = readConfig(overrides);
  try {
    const deleted = await dal.toolCallsDal.purgeOlderThan(days);
    if (deleted > 0) {
      await logger.api(`[toolCallsRetention] purged ${deleted} row(s) older than ${days}d`);
    }
    return deleted;
  } catch (err) {
    await logger.error('[toolCallsRetention] purge failed', err);
    return 0;
  }
}

/**
 * Start the periodic retention timer. Returns a stop() function so
 * tests / shutdown hooks can clear the interval. The timer is
 * `unref()`'d so it never blocks process exit.
 */
function startRetentionJob(overrides = {}) {
  const { days, intervalMs, disabled } = readConfig(overrides);
  if (disabled) {
    logger.api(`[toolCallsRetention] disabled via env`);
    return () => {};
  }

  // Kick off one pass shortly after boot so a long-stopped instance
  // catches up quickly, then settle into the configured cadence.
  const initial = setTimeout(() => runOnce({ retentionDays: days }), 60_000);
  initial.unref?.();

  const handle = setInterval(() => runOnce({ retentionDays: days }), intervalMs);
  handle.unref?.();

  logger.api(`[toolCallsRetention] scheduled — retention=${days}d interval=${intervalMs}ms`);

  return () => {
    clearTimeout(initial);
    clearInterval(handle);
  };
}

module.exports = { runOnce, startRetentionJob, DEFAULT_RETENTION_DAYS, DEFAULT_INTERVAL_MS };
