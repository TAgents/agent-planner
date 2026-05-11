#!/usr/bin/env node
/**
 * Backfill: every user without org membership gets a personal organization
 * (is_personal=true) with one Default workspace, and their existing
 * NULL-org plans/goals get moved into it.
 *
 * Companion to scripts/backfill-default-workspace.mjs, which handles
 * org-scoped data. This script handles the org-less population.
 *
 * Idempotent — safe to re-run. Skips users who already have memberships.
 *
 * Usage:
 *   DATABASE_URL=postgres://... node scripts/backfill-personal-workspaces.mjs [--dry-run]
 *
 * Naming rules:
 *   - org name = user.name || user.email.split('@')[0]
 *   - org slug = `personal-${user.id.slice(0, 8)}` (collision-resistant)
 *   - workspace title = 'Default', slug = 'default'
 *
 * Migration scope:
 *   - Moves plans + goals where owner_id = user AND workspace_id IS NULL
 *     AND organization_id IS NULL into the new (org, workspace) pair.
 *   - Other rows owned by the user but already in an org are LEFT ALONE.
 */
import process from 'node:process';
import { eq, and, isNull } from 'drizzle-orm';
import { db, closeConnection } from '../src/db/connection.mjs';
import { users } from '../src/db/schema/users.mjs';
import { organizations, organizationMembers } from '../src/db/schema/organizations.mjs';
import { workspaces } from '../src/db/schema/workspaces.mjs';
import { goals } from '../src/db/schema/goals.mjs';
import { plans } from '../src/db/schema/plans.mjs';

const DRY_RUN = process.argv.includes('--dry-run');

function slugify(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, 50);
}

function deriveOrgName(user) {
  if (user.name && user.name.trim()) return user.name.trim();
  const local = (user.email || '').split('@')[0] || 'personal';
  return local;
}

async function ensurePersonalScope(user) {
  // Skip users who already belong to any org.
  const [member] = await db.select({ id: organizationMembers.id })
    .from(organizationMembers)
    .where(eq(organizationMembers.userId, user.id))
    .limit(1);
  if (member) return { skipped: 'already_in_org' };

  const orgSlug = `personal-${user.id.slice(0, 8)}`;
  const orgName = deriveOrgName(user);

  // Maybe a prior partial run already created the org but failed before
  // membership/workspace — re-attach instead of duplicating.
  const [existingOrg] = await db.select()
    .from(organizations)
    .where(eq(organizations.slug, orgSlug))
    .limit(1);

  if (DRY_RUN) {
    return {
      action: existingOrg ? 'attach_existing_org' : 'create_org_and_workspace',
      org_slug: orgSlug,
      org_name: orgName,
    };
  }

  let org = existingOrg;
  if (!org) {
    [org] = await db.insert(organizations).values({
      name: orgName,
      slug: orgSlug,
      isPersonal: true,
      description: 'Personal workspace.',
    }).returning();
  }

  await db.insert(organizationMembers).values({
    organizationId: org.id,
    userId: user.id,
    role: 'owner',
  }).onConflictDoNothing();

  // One Default workspace, idempotent on (org_id, slug).
  const [existingWs] = await db.select()
    .from(workspaces)
    .where(and(eq(workspaces.organizationId, org.id), eq(workspaces.slug, 'default')))
    .limit(1);

  const ws = existingWs ?? (await db.insert(workspaces).values({
    organizationId: org.id,
    ownerId: user.id,
    title: 'Default',
    slug: 'default',
    isDefault: true,
    description: 'Default workspace — created by personal-scope backfill.',
  }).returning())[0];

  // Migrate the user's org-less + workspace-less rows into the new scope.
  const movedPlans = await db.update(plans)
    .set({ organizationId: org.id, workspaceId: ws.id, updatedAt: new Date() })
    .where(and(
      eq(plans.ownerId, user.id),
      isNull(plans.organizationId),
      isNull(plans.workspaceId),
    ))
    .returning({ id: plans.id });

  const movedGoals = await db.update(goals)
    .set({ organizationId: org.id, workspaceId: ws.id, updatedAt: new Date() })
    .where(and(
      eq(goals.ownerId, user.id),
      isNull(goals.organizationId),
      isNull(goals.workspaceId),
    ))
    .returning({ id: goals.id });

  return {
    action: 'created',
    org_id: org.id,
    workspace_id: ws.id,
    moved_plans: movedPlans.length,
    moved_goals: movedGoals.length,
  };
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is required');
    process.exit(1);
  }
  console.log(`Backfill personal workspaces${DRY_RUN ? ' (DRY RUN — no writes)' : ''}\n`);

  const allUsers = await db.select({
    id: users.id,
    email: users.email,
    name: users.name,
  }).from(users);

  let createdOrgs = 0;
  let skippedInOrg = 0;
  let totalPlansMoved = 0;
  let totalGoalsMoved = 0;
  const errors = [];

  for (const user of allUsers) {
    try {
      const result = await ensurePersonalScope(user);
      if (result.skipped === 'already_in_org') {
        skippedInOrg += 1;
        continue;
      }
      if (DRY_RUN) {
        console.log(`  [DRY] ${user.email} → ${result.action} (slug=${result.org_slug}, name=${result.org_name})`);
        continue;
      }
      createdOrgs += 1;
      totalPlansMoved += result.moved_plans;
      totalGoalsMoved += result.moved_goals;
      console.log(`  + ${user.email} → personal org ${result.org_id.slice(0, 8)} · ws ${result.workspace_id.slice(0, 8)} · ${result.moved_plans} plan(s), ${result.moved_goals} goal(s)`);
    } catch (err) {
      errors.push({ email: user.email, error: err.message });
    }
  }

  console.log('\n────────────────────────────────────────');
  console.log(`Users seen:                ${allUsers.length}`);
  console.log(`Already in an org:         ${skippedInOrg}`);
  console.log(`Personal scopes ${DRY_RUN ? 'planned' : 'created'}: ${DRY_RUN ? allUsers.length - skippedInOrg : createdOrgs}`);
  if (!DRY_RUN) {
    console.log(`Plans moved:               ${totalPlansMoved}`);
    console.log(`Goals moved:               ${totalGoalsMoved}`);
  }
  if (errors.length) {
    console.log(`Errors: ${errors.length}`);
    for (const e of errors.slice(0, 10)) console.log(`  ! ${e.email}: ${e.error}`);
  }
  console.log('────────────────────────────────────────');

  await closeConnection();
}

main().catch(async (err) => {
  console.error('Backfill failed:', err);
  try { await closeConnection(); } catch {}
  process.exit(1);
});
