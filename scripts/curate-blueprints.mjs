#!/usr/bin/env node
/**
 * Curate the public Blueprint gallery.
 *
 * Applies the advisor's brief: 5 featured Blueprints get rewritten titles,
 * outcomes, "why fork" lines, audience + use_case tags, duration, tier.
 * Niche entries get tier='experimental'. NordLogistics gets tier='example'.
 * Everything else lands on tier='community'.
 *
 * Match strategy:
 *   - Match each Blueprint by case-insensitive title fragment (the
 *     source_plan_id back-link isn't reliable because some entries
 *     pre-date that field).
 *   - Idempotent: writes only the curation fields, leaves payload alone.
 *
 * Usage:
 *   DATABASE_URL=postgres://... node scripts/curate-blueprints.mjs [--dry-run]
 */
import process from 'node:process';
import { eq, sql, ilike, or } from 'drizzle-orm';
import { db, closeConnection } from '../src/db/connection.mjs';
import { blueprints } from '../src/db/schema/blueprints.mjs';

const DRY_RUN = process.argv.includes('--dry-run');

// ─── Featured 5 (advisor's rewrites) ─────────────────────────────

const FEATURED = [
  {
    matchFragments: ['Zero to SaaS', 'AI SaaS MVP', 'Launch Your MVP'],
    title: 'Launch an AI SaaS MVP in 10 Weeks',
    outcome: 'A founder-friendly blueprint for going from idea to shipped product with parallel workstreams for product, engineering, go-to-market, and operations.',
    whyFork: 'Use this when you need a concrete operating plan to ship fast without losing alignment across product, build, and launch work.',
    audience: ['founders', 'product-teams', 'early-stage-startups'],
    useCase: ['launch', 'mvp', 'saas'],
    durationLabel: '10 weeks',
    tier: 'featured',
  },
  {
    matchFragments: ['Migrating a Legacy Next.js', 'Next.js 15', 'App Router'],
    title: 'Migrate a Legacy Next.js App to App Router',
    outcome: 'A risk-managed migration blueprint for upgrading a production Next.js application without losing delivery speed, performance, or rollout safety.',
    whyFork: 'Use this when your team needs a structured path for modernizing a production app without turning the migration into chaos.',
    audience: ['engineering-teams', 'tech-leads', 'product-engineers'],
    useCase: ['migration', 'frontend-modernization', 'nextjs'],
    durationLabel: '6-10 weeks',
    tier: 'featured',
  },
  {
    matchFragments: ['Enterprise Monolith', 'Microservices', 'Monolith to'],
    title: 'Break a Monolith into Microservices Safely',
    outcome: 'A blueprint for planning a staged microservices migration with service boundaries, rollout sequencing, observability, and rollback discipline.',
    whyFork: 'Use this when the migration is strategically important and coordination risk matters as much as code.',
    audience: ['ctos', 'platform-teams', 'engineering-leadership'],
    useCase: ['architecture-migration', 'platform-modernization', 'enterprise-delivery'],
    durationLabel: '1-2 quarters',
    tier: 'featured',
  },
  {
    matchFragments: ['OpenClaw Skill', 'Production-Ready OpenClaw', 'ClawHub'],
    title: 'Build and Publish an OpenClaw Skill',
    outcome: 'A complete blueprint for designing, testing, validating, and publishing an OpenClaw skill using a multi-agent RPI workflow.',
    whyFork: 'Use this when you want a repeatable path from idea to a real published skill, not just an experiment on your laptop.',
    audience: ['ai-builders', 'agent-developers', 'mcp-ecosystem-builders'],
    useCase: ['agent-skills', 'openclaw', 'mcp-workflows'],
    durationLabel: '2-4 weeks',
    tier: 'featured',
  },
  {
    matchFragments: ['AI Transformation Playbook', 'NordLogistics'],
    title: 'Run an AI Transformation Program in Your Team',
    outcome: 'A practical transformation blueprint showing how a company can identify use cases, prioritize initiatives, run pilots, and scale adoption with human and AI collaboration.',
    whyFork: 'Use this when you need a structured way to move from "we should use AI" to an actual portfolio of pilots and operational rollout.',
    audience: ['founders', 'ops-leaders', 'innovation-teams'],
    useCase: ['ai-transformation', 'change-management', 'team-adoption'],
    durationLabel: '1-2 quarters',
    // Advisor flagged this one as risky if shown as a real customer case study.
    // Mark as 'example' (rendered with an explicit "Example" pill in the UI).
    tier: 'example',
  },
];

// Niche / labs entries that should not anchor the public catalog.
const EXPERIMENTAL_TITLE_FRAGMENTS = [
  'LeWM',
  'Orcs',
  'Autoresearch',
  'Building a Custom AI Agent',
];

async function findByFragments(fragments) {
  const conditions = fragments.map((f) => ilike(blueprints.title, `%${f}%`));
  const rows = await db.select()
    .from(blueprints)
    .where(or(...conditions));
  return rows;
}

async function applyCuration(row, plan) {
  const updates = {
    title: plan.title ?? row.title,
    outcome: plan.outcome ?? null,
    whyFork: plan.whyFork ?? null,
    audience: plan.audience ?? [],
    useCase: plan.useCase ?? [],
    durationLabel: plan.durationLabel ?? null,
    tier: plan.tier ?? row.tier ?? 'community',
    updatedAt: new Date(),
  };
  if (DRY_RUN) {
    console.log(`  [DRY] ${row.title.slice(0, 60)} → tier=${updates.tier} (${plan.audience?.length ?? 0}a/${plan.useCase?.length ?? 0}uc)`);
    if (plan.title && plan.title !== row.title) console.log(`         rename → "${plan.title}"`);
    return null;
  }
  await db.update(blueprints).set(updates).where(eq(blueprints.id, row.id));
  return updates;
}

async function setTier(row, tier) {
  if (row.tier === tier) return null;
  if (DRY_RUN) {
    console.log(`  [DRY] ${row.title.slice(0, 60)} → tier=${tier} (was ${row.tier || 'NULL'})`);
    return null;
  }
  await db.update(blueprints).set({ tier, updatedAt: new Date() }).where(eq(blueprints.id, row.id));
  return tier;
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL required');
    process.exit(1);
  }
  console.log(`Curate Blueprint gallery${DRY_RUN ? ' (DRY RUN)' : ''}\n`);

  // Only consider public/unlisted Blueprints — the catalog is what we curate.
  const allPublic = await db.select().from(blueprints)
    .where(or(eq(blueprints.visibility, 'public'), eq(blueprints.visibility, 'unlisted')));
  console.log(`Public/unlisted Blueprints: ${allPublic.length}\n`);

  const matchedIds = new Set();
  let curated = 0;

  // ── Featured 5 ──
  console.log('Featured 5:');
  for (const plan of FEATURED) {
    const candidates = await findByFragments(plan.matchFragments);
    const matches = candidates.filter((r) => allPublic.some((p) => p.id === r.id));
    if (matches.length === 0) {
      console.log(`  ! no match for "${plan.matchFragments[0]}" — skipping`);
      continue;
    }
    if (matches.length > 1) {
      console.log(`  ! ${matches.length} matches for "${plan.matchFragments[0]}" — taking newest`);
    }
    const target = matches.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0];
    matchedIds.add(target.id);
    await applyCuration(target, plan);
    curated += 1;
  }

  // ── Experimental ──
  console.log('\nExperimental:');
  for (const fragment of EXPERIMENTAL_TITLE_FRAGMENTS) {
    const candidates = await findByFragments([fragment]);
    const matches = candidates.filter((r) => allPublic.some((p) => p.id === r.id) && !matchedIds.has(r.id));
    for (const row of matches) {
      matchedIds.add(row.id);
      await setTier(row, 'experimental');
      curated += 1;
    }
  }

  // ── Everything else → community ──
  console.log('\nCommunity (default):');
  const remaining = allPublic.filter((r) => !matchedIds.has(r.id));
  for (const row of remaining) {
    if (row.tier) {
      console.log(`  skip ${row.title.slice(0, 60)} (already ${row.tier})`);
      continue;
    }
    await setTier(row, 'community');
    curated += 1;
  }

  console.log(`\n────────────────────────────────────────`);
  console.log(`Blueprints ${DRY_RUN ? 'planned' : 'updated'}: ${curated} / ${allPublic.length}`);
  console.log(`────────────────────────────────────────`);
  await closeConnection();
}

main().catch(async (err) => {
  console.error('Curation failed:', err);
  try { await closeConnection(); } catch {}
  process.exit(1);
});
