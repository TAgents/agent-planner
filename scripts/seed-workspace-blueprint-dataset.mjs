#!/usr/bin/env node
/**
 * Golden dataset seeder for Workspace + Blueprint v1.1.
 *
 * Populates a dev instance with a representative set of workspaces,
 * blueprints, plans, and forks so the v1.1 redesign UI (Workspaces
 * Index/Detail, Blueprints Index/Detail, Mission Control strip,
 * Plan/Goal breadcrumbs) can be validated against realistic data.
 *
 * Exercises every UI state:
 *   - Workspaces: Default (backfilled), user-created, archived
 *   - Plan/goal counts on the index (non-zero so columns aren't all "—")
 *   - Workspace forked_from_blueprint_id provenance
 *   - Blueprints: plan-scope, with + without forks
 *   - Fork History rows on Blueprint Detail (≥1 fork to populate panel)
 *   - Mission Control "Recent forks" strip (≥1 forked plan with forked_at)
 *   - Plan tree breadcrumb walking back to workspace
 *   - Goal detail workspace ObjectChip
 *
 * Usage:
 *   API_URL=http://localhost:3000 \
 *   USER_API_TOKEN=eyJhbGc... \
 *   node scripts/seed-workspace-blueprint-dataset.mjs
 *
 * Idempotent: reuses existing rows with matching titles. Pass --reset
 * to delete the user's seeded workspaces and blueprints first.
 *
 * Companion test runbook lives in
 * `tests/fixtures/workspace-blueprint-golden.md`.
 */
import process from 'node:process';

const API = process.env.API_URL || 'http://localhost:3000';
const TOKEN = process.env.USER_API_TOKEN;
const RESET = process.argv.includes('--reset');

if (!TOKEN) {
  console.error('USER_API_TOKEN env var is required');
  process.exit(1);
}

const H = { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' };
const errors = [];

async function req(method, path, body) {
  const res = await fetch(API + path, {
    method,
    headers: H,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch {}
  if (!res.ok) errors.push({ method, path, status: res.status, body, response: data });
  return { ok: res.ok, status: res.status, data };
}
const get = (p) => req('GET', p);
const post = (p, b) => req('POST', p, b);
const patch = (p, b) => req('PATCH', p, b);
const del = (p) => req('DELETE', p);

async function getOrgs() {
  const { data } = await get('/organizations');
  return data?.organizations || [];
}

async function listWorkspaces(orgId, { includeArchived = false } = {}) {
  const qs = `organization_id=${orgId}${includeArchived ? '&include_archived=true' : ''}`;
  const { data } = await get(`/workspaces?${qs}`);
  return data?.workspaces || [];
}

async function findOrCreateWorkspace(orgId, title, { description, isArchived = false } = {}) {
  const live = await listWorkspaces(orgId, { includeArchived: true });
  let ws = live.find((w) => w.title === title);
  if (!ws) {
    const r = await post('/workspaces', { organization_id: orgId, title, description });
    ws = r.data;
    if (!ws) {
      console.error(`  ! failed to create workspace "${title}":`, r.status, r.data);
      return null;
    }
  }
  if (isArchived && !ws.archivedAt) {
    await post(`/workspaces/${ws.id}/archive`);
  } else if (!isArchived && ws.archivedAt) {
    await post(`/workspaces/${ws.id}/restore`);
  }
  return ws;
}

async function findOrCreatePlan(spec) {
  const { data } = await get('/plans?limit=200');
  const arr = Array.isArray(data) ? data : data?.plans || [];
  let plan = arr.find((p) => p.title === spec.title);
  if (!plan) {
    const r = await post('/plans', spec);
    plan = r.data;
  }
  return plan;
}

async function ensureNodes(planId, taskTitles) {
  const { data } = await get(`/plans/${planId}/nodes`);
  const rows = Array.isArray(data) ? data : data?.nodes || [];
  const flat = flattenTree(rows);
  const byTitle = new Map(flat.map((n) => [n.title, n]));
  // Need a phase parent so the tree has hierarchy
  let phase = flat.find((n) => (n.node_type || n.nodeType) === 'phase' && n.title === 'Tasks');
  if (!phase) {
    const rootRow = flat.find((n) => (n.node_type || n.nodeType) === 'root');
    if (rootRow) {
      const r = await post(`/plans/${planId}/nodes`, { node_type: 'phase', title: 'Tasks', parent_id: rootRow.id });
      phase = r.data;
    }
  }
  const created = [];
  for (const title of taskTitles) {
    if (byTitle.has(title)) { created.push(byTitle.get(title)); continue; }
    const r = await post(`/plans/${planId}/nodes`, { node_type: 'task', title, parent_id: phase?.id });
    if (r.data) created.push(r.data);
  }
  return created;
}

function flattenTree(nodes) {
  const out = [];
  for (const n of nodes) {
    out.push(n);
    if (n.children) out.push(...flattenTree(n.children));
  }
  return out;
}

async function listBlueprints() {
  const { data } = await get('/blueprints?owner_only=true');
  return data?.blueprints || [];
}

async function findOrSaveBlueprintFromPlan(planId, blueprintSpec) {
  const list = await listBlueprints();
  let bp = list.find((b) => b.title === blueprintSpec.title);
  if (!bp) {
    const r = await post(`/blueprints/from_plan/${planId}`, blueprintSpec);
    bp = r.data;
  }
  return bp;
}

async function listForks(blueprintId) {
  const { data } = await get(`/blueprints/${blueprintId}/forks`);
  return data?.forks || [];
}

async function ensureFork(blueprintId, workspaceId, title) {
  const existing = await listForks(blueprintId);
  if (existing.some((f) => f.title === title)) return existing.find((f) => f.title === title);
  const r = await post(`/blueprints/${blueprintId}/fork`, { workspace_id: workspaceId, title });
  return r.data;
}

async function resetSeed(orgId) {
  console.log('Reset: archiving seeded workspaces and deleting seeded blueprints…');
  const all = await listWorkspaces(orgId, { includeArchived: true });
  for (const w of all) {
    if (['Growth Engine — Q3', 'Old Initiative'].includes(w.title)) {
      await del(`/workspaces/${w.id}`).catch(() => {});
    }
  }
  const bps = await listBlueprints();
  for (const b of bps) {
    if (['Product Launch v3', 'Weekly Research Brief'].includes(b.title)) {
      await del(`/blueprints/${b.id}`);
    }
  }
}

async function main() {
  console.log(`Seeding Workspace + Blueprint dataset against ${API}`);
  const orgs = await getOrgs();
  if (orgs.length === 0) {
    console.error('No organizations for this user. Cannot seed workspaces.');
    process.exit(1);
  }
  const org = orgs[0];
  console.log(`Using org: ${org.name} (${org.slug})`);

  if (RESET) await resetSeed(org.id);

  // ─── Workspaces ──────────────────────────────────────────────
  console.log('\nWorkspaces:');
  const wsDefault = (await listWorkspaces(org.id)).find((w) => w.isDefault);
  if (wsDefault) console.log(`  ✓ Default (auto-created, ${wsDefault.id.slice(0, 8)})`);
  else console.warn('  ! No Default workspace found — run backfill-default-workspace.mjs first');

  const wsGrowth = await findOrCreateWorkspace(org.id, 'Growth Engine — Q3', {
    description: 'Q3 launch push: pricing, public sign-up, distribution channels.',
  });
  if (wsGrowth) console.log(`  ✓ Growth Engine — Q3 (${wsGrowth.id.slice(0, 8)})`);

  const wsArchived = await findOrCreateWorkspace(org.id, 'Old Initiative', {
    description: 'Wound-down workspace kept for archive testing.',
    isArchived: true,
  });
  if (wsArchived) console.log(`  ✓ Old Initiative (archived, ${wsArchived.id.slice(0, 8)})`);

  // ─── Plans inside Growth Engine ──────────────────────────────
  console.log('\nPlans:');
  const launchPlan = await findOrCreatePlan({
    title: 'Q3 Launch Plan',
    description: 'Drive the Q3 product launch: pricing, assets, distribution.',
    status: 'active',
    workspace_id: wsGrowth?.id,
    organization_id: org.id,
  });
  if (launchPlan) console.log(`  ✓ Q3 Launch Plan (${launchPlan.id.slice(0, 8)})`);

  const launchTasks = [
    'Frame the launch — who, what, why',
    'Set success criteria + tracking',
    'Lock scope: which surfaces ship',
    'Comp pricing — usage vs seat',
    'Build pricing page + checkout',
    'Site copy + visuals',
    'Email sequence + demo video',
    'PH launch + X thread',
    'Partner newsletters',
    'Retro: metrics + themes',
  ];
  if (launchPlan) await ensureNodes(launchPlan.id, launchTasks);

  const researchPlan = await findOrCreatePlan({
    title: 'Weekly Research Brief — Pricing',
    description: 'Scope → gather → synthesize → distribute. Repeatable weekly cadence.',
    status: 'draft',
    workspace_id: wsGrowth?.id,
    organization_id: org.id,
  });
  if (researchPlan) console.log(`  ✓ Weekly Research Brief — Pricing (${researchPlan.id.slice(0, 8)})`);
  if (researchPlan) await ensureNodes(researchPlan.id, [
    'Define this week\'s scope',
    'Gather comp pricing data',
    'Interview 3 design partners',
    'Synthesize into 1-pager',
    'Distribute to growth channel',
  ]);

  // ─── Blueprints ──────────────────────────────────────────────
  console.log('\nBlueprints:');
  const bpLaunch = launchPlan
    ? await findOrSaveBlueprintFromPlan(launchPlan.id, {
        title: 'Product Launch v3',
        description: 'A reusable operating model for a launch. Fork it to start a live plan with all phases preconfigured.',
        visibility: 'unlisted',
        tags: ['gtm', 'launch'],
      })
    : null;
  if (bpLaunch) console.log(`  ✓ Product Launch v3 (${bpLaunch.id.slice(0, 8)}, ${bpLaunch.payload?.nodes?.length ?? 0} nodes)`);

  const bpResearch = researchPlan
    ? await findOrSaveBlueprintFromPlan(researchPlan.id, {
        title: 'Weekly Research Brief',
        description: 'Repeatable weekly research plan: scope, gather, synthesize, distribute.',
        visibility: 'private',
        tags: ['internal-ops', 'research'],
      })
    : null;
  if (bpResearch) console.log(`  ✓ Weekly Research Brief (${bpResearch.id.slice(0, 8)}, ${bpResearch.payload?.nodes?.length ?? 0} nodes)`);

  // ─── Forks to populate Fork History + Recent Forks ───────────
  console.log('\nForks:');
  if (bpLaunch && wsGrowth) {
    const f1 = await ensureFork(bpLaunch.id, wsGrowth.id, 'Q3 Launch — execution');
    if (f1) console.log(`  ✓ Q3 Launch — execution (${f1.id?.slice(0, 8) || '—'} in Growth Engine — Q3)`);
  }
  if (bpLaunch && wsDefault) {
    const f2 = await ensureFork(bpLaunch.id, wsDefault.id, 'Sample Launch run-through');
    if (f2) console.log(`  ✓ Sample Launch run-through (${f2.id?.slice(0, 8) || '—'} in Default)`);
  }
  if (bpResearch && wsGrowth) {
    const f3 = await ensureFork(bpResearch.id, wsGrowth.id, 'Weekly research — week 1');
    if (f3) console.log(`  ✓ Weekly research — week 1 (${f3.id?.slice(0, 8) || '—'} in Growth Engine — Q3)`);
  }

  console.log('\nDone.');
  if (errors.length > 0) {
    console.warn(`\nNon-fatal errors (${errors.length}):`);
    for (const e of errors.slice(0, 10)) {
      console.warn(`  ${e.method} ${e.path} → ${e.status}: ${e.response?.error || ''}`);
    }
  }
}

main().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
