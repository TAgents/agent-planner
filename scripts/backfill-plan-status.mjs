#!/usr/bin/env node
/**
 * One-time backfill to reconcile plan.status with completion, matching the
 * runtime rule in reasoning.maintainPlanStatus (active⇄completed; draft and
 * archived untouched). "Complete" = has ≥1 work node (task/milestone) and none
 * are incomplete — the canonical denominator (docs/DERIVATIONS_AUDIT.md).
 *
 * Idempotent — safe to re-run. Going forward the runtime keeps this in sync on
 * every node.status.changed; this script only catches plans that were already
 * 100% (or already overdue for reopening) before the rule existed.
 *
 * Usage:
 *   DATABASE_URL=postgres://... node scripts/backfill-plan-status.mjs --dry-run
 *   DATABASE_URL=postgres://... node scripts/backfill-plan-status.mjs
 */
import process from 'node:process';
import { db, closeConnection } from '../src/db/connection.mjs';
import { sql } from 'drizzle-orm';

const dryRun = process.argv.includes('--dry-run');

// A plan is "complete" iff it has at least one work node and zero incomplete
// work nodes. Work nodes = task + milestone (root/phases are structure).
const isCompleteCond = sql`
  EXISTS (SELECT 1 FROM plan_nodes n
          WHERE n.plan_id = p.id AND n.node_type IN ('task','milestone'))
  AND NOT EXISTS (SELECT 1 FROM plan_nodes n
          WHERE n.plan_id = p.id AND n.node_type IN ('task','milestone')
            AND n.status <> 'completed')
`;

async function run() {
  // active → completed (all work done)
  const toComplete = await db.execute(sql`
    SELECT p.id, p.title FROM plans p
    WHERE p.status = 'active' AND ${isCompleteCond}
  `);
  // completed → active (work added / reopened / no work nodes)
  const toReopen = await db.execute(sql`
    SELECT p.id, p.title FROM plans p
    WHERE p.status = 'completed' AND NOT (${isCompleteCond})
  `);

  const complete = Array.from(toComplete);
  const reopen = Array.from(toReopen);

  console.log(`${complete.length} active plan(s) → completed:`);
  for (const p of complete) console.log(`  ✓ ${p.id}  ${p.title}`);
  console.log(`${reopen.length} completed plan(s) → active:`);
  for (const p of reopen) console.log(`  ↩ ${p.id}  ${p.title}`);

  if (dryRun) {
    console.log('\n[dry-run] no changes written.');
    return;
  }

  if (complete.length) {
    await db.execute(sql`UPDATE plans p SET status = 'completed', updated_at = now()
      WHERE p.status = 'active' AND ${isCompleteCond}`);
  }
  if (reopen.length) {
    await db.execute(sql`UPDATE plans p SET status = 'active', updated_at = now()
      WHERE p.status = 'completed' AND NOT (${isCompleteCond})`);
  }
  console.log(`\nDone. ${complete.length} completed, ${reopen.length} reopened.`);
}

run()
  .catch((err) => { console.error(err); process.exitCode = 1; })
  .finally(() => closeConnection());
