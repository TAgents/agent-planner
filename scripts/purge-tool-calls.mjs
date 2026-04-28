#!/usr/bin/env node
/**
 * One-shot tool_calls retention purge — for ops use outside the API
 * server's in-process schedule. Useful inside backup/restore checklists,
 * or when adjusting retention policy.
 *
 * Usage:
 *   DATABASE_URL=postgres://... node scripts/purge-tool-calls.mjs [days]
 *
 * If `days` is omitted, reads TOOL_CALLS_RETENTION_DAYS or 90.
 */
import 'dotenv/config';

const argDays = process.argv[2];
const days =
  (argDays !== undefined ? Number(argDays) : Number(process.env.TOOL_CALLS_RETENTION_DAYS)) || 90;

if (!Number.isFinite(days) || days <= 0) {
  console.error(`purge-tool-calls: invalid days argument: ${process.argv[2]}`);
  process.exit(2);
}

const { toolCallsDal } = await import('../src/db/dal/index.mjs');

try {
  const deleted = await toolCallsDal.purgeOlderThan(days);
  console.log(`Purged ${deleted} tool_calls row(s) older than ${days} day(s).`);
  process.exit(0);
} catch (err) {
  console.error('purge-tool-calls: failed', err);
  process.exit(1);
}
