#!/usr/bin/env node
/**
 * One-shot: snapshot every public/unlisted plan as a Blueprint with
 * matching visibility. The live plan stays as-is; the Blueprint becomes
 * the canonical sharing surface going forward.
 *
 * Idempotent — skips plans that already have a Blueprint with
 * source_plan_id pointing at them.
 *
 * Usage:
 *   DATABASE_URL=postgres://... node scripts/migrate-public-plans-to-blueprints.mjs [--dry-run]
 *
 * Rationale: v1.1 introduces Blueprints as the proper sharing primitive
 * (with explicit fork semantics, scope, version, fork_count). Public
 * Plans were the v0 placeholder for what Blueprints now do. This
 * migration ensures every existing public artifact has a Blueprint
 * twin so the new /explore catalog isn't empty after the deploy.
 *
 * Companion to:
 *   - backfill-default-workspace.mjs (org-level workspaces)
 *   - backfill-personal-workspaces.mjs (personal scopes)
 */
import process from 'node:process';
import { eq, and, inArray, or, isNotNull } from 'drizzle-orm';
import { db, closeConnection } from '../src/db/connection.mjs';
import { plans, planNodes } from '../src/db/schema/plans.mjs';
import { blueprints } from '../src/db/schema/blueprints.mjs';
import { nodeDependencies } from '../src/db/schema/dependencies.mjs';

const DRY_RUN = process.argv.includes('--dry-run');
const PAYLOAD_VERSION = 1;

async function snapshotPlanPayload(planId) {
  const [plan] = await db.select().from(plans).where(eq(plans.id, planId)).limit(1);
  if (!plan) return null;
  const nodes = await db.select().from(planNodes).where(eq(planNodes.planId, planId));
  const nodeIds = nodes.map((n) => n.id);
  const deps = nodeIds.length === 0
    ? []
    : await db.select().from(nodeDependencies).where(inArray(nodeDependencies.sourceNodeId, nodeIds));
  const keyOf = new Map();
  nodes.forEach((n, i) => keyOf.set(n.id, `n${i}`));
  return {
    plan,
    payload: {
      version: PAYLOAD_VERSION,
      scope: 'plan',
      plan: { title: plan.title, description: plan.description },
      nodes: nodes.map((n) => ({
        key: keyOf.get(n.id),
        parent_key: n.parentId ? keyOf.get(n.parentId) ?? null : null,
        node_type: n.nodeType,
        title: n.title,
        description: n.description,
        order_index: n.orderIndex,
        task_mode: n.taskMode,
        context: n.context,
        agent_instructions: n.agentInstructions,
      })),
      dependencies: deps
        .filter((d) => keyOf.has(d.sourceNodeId) && keyOf.has(d.targetNodeId))
        .map((d) => ({
          source_key: keyOf.get(d.sourceNodeId),
          target_key: keyOf.get(d.targetNodeId),
          dependency_type: d.dependencyType,
        })),
    },
  };
}

async function existingBlueprintForPlan(planId) {
  const [row] = await db.select({ id: blueprints.id, visibility: blueprints.visibility })
    .from(blueprints)
    .where(eq(blueprints.sourcePlanId, planId))
    .limit(1);
  return row;
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is required');
    process.exit(1);
  }
  console.log(`Migrate public plans → Blueprints${DRY_RUN ? ' (DRY RUN — no writes)' : ''}\n`);

  // Pull every plan whose visibility is anything but private. is_public
  // legacy column is also checked so v0 rows aren't missed.
  const publicPlans = await db.select().from(plans)
    .where(or(
      eq(plans.visibility, 'public'),
      eq(plans.visibility, 'unlisted'),
      eq(plans.isPublic, true),
    ));

  let created = 0;
  let skipped = 0;
  const errors = [];

  for (const plan of publicPlans) {
    try {
      const existing = await existingBlueprintForPlan(plan.id);
      if (existing) {
        skipped += 1;
        console.log(`  skip ${plan.title.slice(0, 50)}… (blueprint ${existing.id.slice(0, 8)} exists)`);
        continue;
      }
      const visibility = plan.visibility === 'public' ? 'public' : 'unlisted';
      if (DRY_RUN) {
        console.log(`  [DRY] would snapshot ${plan.title.slice(0, 50)}… → visibility=${visibility}`);
        continue;
      }
      const snap = await snapshotPlanPayload(plan.id);
      if (!snap) { errors.push({ planId: plan.id, error: 'snapshot returned null' }); continue; }
      const [bp] = await db.insert(blueprints).values({
        ownerId: plan.ownerId,
        organizationId: plan.organizationId,
        title: plan.title,
        description: plan.description,
        scope: 'plan',
        visibility,
        version: 1,
        payload: snap.payload,
        sourcePlanId: plan.id,
        publishedAt: new Date(),
      }).returning();
      created += 1;
      console.log(`  + ${plan.title.slice(0, 50)}… → blueprint ${bp.id.slice(0, 8)} (visibility=${visibility}, ${snap.payload.nodes.length} nodes)`);
    } catch (err) {
      errors.push({ planId: plan.id, title: plan.title, error: err.message });
    }
  }

  console.log('\n────────────────────────────────────────');
  console.log(`Public/unlisted plans seen:  ${publicPlans.length}`);
  console.log(`Already had a Blueprint:     ${skipped}`);
  console.log(`Blueprints ${DRY_RUN ? 'planned' : 'created'}:      ${DRY_RUN ? publicPlans.length - skipped : created}`);
  if (errors.length) {
    console.log(`Errors: ${errors.length}`);
    for (const e of errors.slice(0, 10)) console.log(`  ! ${e.title || e.planId}: ${e.error}`);
  }
  console.log('────────────────────────────────────────');
  await closeConnection();
}

main().catch(async (err) => {
  console.error('Migration failed:', err);
  try { await closeConnection(); } catch {}
  process.exit(1);
});
