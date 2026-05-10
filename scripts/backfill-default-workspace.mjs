#!/usr/bin/env node
/**
 * Backfill: ensure every Organization has a Default workspace and that
 * any goal/plan with workspace_id = NULL is assigned to it.
 *
 * Idempotent — safe to re-run. Run after migration 0019 has applied.
 *
 * Usage:
 *   DATABASE_URL=postgres://... node scripts/backfill-default-workspace.mjs
 */
import process from 'node:process';
import { db, sql, closeConnection } from '../src/db/connection.mjs';
import { eq, and, isNull } from 'drizzle-orm';
import { organizations, organizationMembers } from '../src/db/schema/organizations.mjs';
import { workspaces } from '../src/db/schema/workspaces.mjs';
import { goals } from '../src/db/schema/goals.mjs';
import { plans } from '../src/db/schema/plans.mjs';

const DEFAULT_TITLE = 'Default';
const DEFAULT_SLUG = 'default';

async function ensureDefaultWorkspace(org) {
  // Already exists?
  const [existing] = await db.select()
    .from(workspaces)
    .where(and(
      eq(workspaces.organizationId, org.id),
      eq(workspaces.isDefault, true),
    ))
    .limit(1);
  if (existing) return existing;

  // Pick an owner: the first member, preferring the org owner role.
  const members = await db.select()
    .from(organizationMembers)
    .where(eq(organizationMembers.organizationId, org.id));
  if (members.length === 0) {
    console.warn(`  org ${org.id} (${org.slug}) has no members — skipping`);
    return null;
  }
  const ownerMember = members.find((m) => m.role === 'owner') || members[0];

  // Slug uniqueness guard — if "default" is taken (unlikely), append org slug.
  const [slugClash] = await db.select()
    .from(workspaces)
    .where(and(
      eq(workspaces.organizationId, org.id),
      eq(workspaces.slug, DEFAULT_SLUG),
    ))
    .limit(1);
  const slug = slugClash ? `default-${org.slug || org.id.slice(0, 8)}` : DEFAULT_SLUG;

  const [created] = await db.insert(workspaces).values({
    organizationId: org.id,
    ownerId: ownerMember.userId,
    title: DEFAULT_TITLE,
    slug,
    description: 'Default workspace — auto-created during migration to Workspaces.',
    isDefault: true,
  }).returning();
  console.log(`  + created Default workspace ${created.id} for org ${org.slug || org.id}`);
  return created;
}

async function assignGoals(orgId, workspaceId) {
  const result = await db.update(goals)
    .set({ workspaceId, updatedAt: new Date() })
    .where(and(eq(goals.organizationId, orgId), isNull(goals.workspaceId)))
    .returning({ id: goals.id });
  return result.length;
}

async function assignPlans(orgId, workspaceId) {
  const result = await db.update(plans)
    .set({ workspaceId, updatedAt: new Date() })
    .where(and(eq(plans.organizationId, orgId), isNull(plans.workspaceId)))
    .returning({ id: plans.id });
  return result.length;
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is required');
    process.exit(1);
  }

  const orgs = await db.select().from(organizations);
  console.log(`Backfilling Default workspace for ${orgs.length} organization(s)...`);

  let totalGoals = 0;
  let totalPlans = 0;
  let orgsHandled = 0;

  for (const org of orgs) {
    const ws = await ensureDefaultWorkspace(org);
    if (!ws) continue;
    const g = await assignGoals(org.id, ws.id);
    const p = await assignPlans(org.id, ws.id);
    if (g || p) {
      console.log(`  org ${org.slug || org.id}: ${g} goal(s), ${p} plan(s) → ${ws.id}`);
    }
    totalGoals += g;
    totalPlans += p;
    orgsHandled += 1;
  }

  // Personal (no-org) goals/plans: leave NULL for now. The "Inbox" virtual
  // workspace at the UI layer surfaces them until users opt in.
  const orphanGoals = await db.select({ id: goals.id })
    .from(goals)
    .where(and(isNull(goals.organizationId), isNull(goals.workspaceId)));
  const orphanPlans = await db.select({ id: plans.id })
    .from(plans)
    .where(and(isNull(plans.organizationId), isNull(plans.workspaceId)));

  console.log('');
  console.log(`Done. Orgs handled: ${orgsHandled}/${orgs.length}`);
  console.log(`  goals assigned: ${totalGoals}`);
  console.log(`  plans assigned: ${totalPlans}`);
  console.log(`  personal (no-org) goals still NULL: ${orphanGoals.length}`);
  console.log(`  personal (no-org) plans still NULL: ${orphanPlans.length}`);

  await closeConnection();
}

main().catch(async (err) => {
  console.error('Backfill failed:', err);
  try { await closeConnection(); } catch {}
  process.exit(1);
});
