#!/usr/bin/env node
/**
 * Golden dataset seeder — populates a dev instance with a representative
 * set of goals, plans, links, evaluations, and varied task statuses so the
 * v1 redesign UI (Goals index, Mission Control, Strategic Overview) can be
 * validated against realistic data.
 *
 * Designed to exercise every UI state on the Goals index:
 *   - all 4 goal types (outcome / metric / constraint / principle)
 *   - all 4 statuses (active / achieved / paused / abandoned)
 *   - sub-goals (lineage rail)
 *   - plan-linked + unlinked goals
 *   - evaluations producing each quality color band
 *   - achievers driving each progress-bar segment (done / doing / blocked)
 *   - every attention pill (At risk / No plan / Stale / Paused / Done)
 *
 * Usage:
 *   API_URL=http://localhost:3000 \
 *   USER_API_TOKEN=eyJhbGc... \
 *   node scripts/seed-golden-dataset.mjs
 *
 * The seeder is roughly idempotent: if a goal/plan with the same title
 * already exists for the user, it is reused rather than duplicated. Pass
 * --reset to remove every goal/plan owned by the user before re-seeding.
 *
 * Companion golden assertions live in `tests/fixtures/golden-dataset.md`.
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
  try {
    data = await res.json();
  } catch {}
  if (!res.ok) errors.push({ method, path, status: res.status, body, response: data });
  return { ok: res.ok, status: res.status, data };
}
const get = (p) => req('GET', p);
const post = (p, b) => req('POST', p, b);
const put = (p, b) => req('PUT', p, b);
const del = (p) => req('DELETE', p);

async function getMe() {
  const { data } = await get('/auth/profile');
  if (!data?.id) throw new Error('Could not load /auth/profile — token invalid?');
  return data;
}

async function reset(userId) {
  console.log('Reset: deleting goals + plans owned by user…');
  const goals = (await get('/goals')).data?.goals || [];
  for (const g of goals) await del(`/goals/${g.id}`);
  const plans = (await get('/plans?limit=100')).data || [];
  const planList = Array.isArray(plans) ? plans : plans.plans || [];
  for (const p of planList) {
    if (p.owner_id === userId || p.ownerId === userId) await del(`/plans/${p.id}`);
  }
}

async function findOrCreatePlan(spec) {
  const list = (await get('/plans?limit=200')).data || [];
  const arr = Array.isArray(list) ? list : list.plans || [];
  const existing = arr.find((p) => p.title === spec.title);
  if (existing) return existing;
  const { data } = await post('/plans', spec);
  return data;
}

async function findOrCreateGoal(spec) {
  const list = (await get('/goals')).data?.goals || [];
  const existing = list.find((g) => g.title === spec.title);
  if (existing) return existing;
  const { data } = await post('/goals', spec);
  return data;
}

async function ensureNodes(planId, taskList) {
  const list = (await get(`/plans/${planId}/nodes`)).data || [];
  const arr = Array.isArray(list) ? list : list.nodes || [];
  const byTitle = new Map(arr.map((n) => [n.title, n]));
  for (const [title, status] of taskList) {
    let n = byTitle.get(title);
    if (!n) {
      const r = await post(`/plans/${planId}/nodes`, { node_type: 'task', title });
      n = r.data;
    }
    if (n && status !== 'not_started') {
      await put(`/plans/${planId}/nodes/${n.id}/status`, { status });
    }
  }
  return (await get(`/plans/${planId}/nodes`)).data || [];
}

async function ensureLink(goalId, linkedType, linkedId) {
  await post(`/goals/${goalId}/links`, { linkedType, linkedId });
}

async function ensureEval(goalId, userId, score, reasoning) {
  await post(`/goals/${goalId}/evaluations`, { evaluatedBy: userId, score, reasoning });
}

async function ensureAchievers(goalId, planId) {
  const list = (await get(`/plans/${planId}/nodes`)).data || [];
  const tasks = (Array.isArray(list) ? list : list.nodes || []).filter(
    (n) => (n.node_type || n.nodeType) === 'task',
  );
  for (const t of tasks) {
    await post(`/goals/${goalId}/achievers`, { source_node_id: t.id });
  }
}

function flattenTasks(arr) {
  const out = [];
  function walk(ns) {
    for (const n of ns) {
      out.push(n);
      if (n.children) walk(n.children);
    }
  }
  walk(arr);
  return out.filter((n) => (n.node_type || n.nodeType) === 'task');
}

async function ensureEpisodeWithLink(planId, episode, taskMatch) {
  const status = await get('/knowledge/graphiti/status');
  if (!status.data?.available) return null;
  // Add episode (idempotent at content-level — Graphiti dedupes by content+name)
  const created = await post('/knowledge/episodes', {
    content: episode.content,
    name: episode.name,
    plan_id: planId,
  });
  const ep = created.data;
  // Look up the matching task
  const list = (await get(`/plans/${planId}/nodes`)).data || [];
  const tasks = flattenTasks(Array.isArray(list) ? list : list.nodes || []);
  const task = tasks.find((t) => taskMatch.test(t.title));
  if (ep?.uuid && task) {
    await post(`/plans/${planId}/nodes/${task.id}/episode-links`, {
      episode_id: ep.uuid,
    });
  }
  return ep;
}

async function main() {
  const me = await getMe();
  console.log(`Auth: ${me.email} (${me.id})`);

  if (RESET) await reset(me.id);

  // ── Plans ──────────────────────────────────────
  const planAtlas = await findOrCreatePlan({
    title: 'Atlas v2.0 release plan',
    description: 'Ship Atlas v2.0 to design-partner cohort by EOQ.',
    status: 'active',
  });
  const planLatency = await findOrCreatePlan({
    title: 'p95 latency optimization',
    description: 'Bring p95 below 120ms.',
    status: 'active',
  });
  const planCost = await findOrCreatePlan({
    title: 'Infra cost ceiling enforcement',
    description: 'Keep monthly infra spend under $40k.',
    status: 'active',
  });
  const planAuth = await findOrCreatePlan({
    title: 'Auth & SSO foundation',
    description: 'SAML, OIDC, magic link.',
    status: 'completed',
  });
  const planSdk = await findOrCreatePlan({
    title: 'SDK release plan',
    description: 'Open-source the SDK by H2.',
    status: 'draft',
  });
  const planPilots = await findOrCreatePlan({
    title: 'Pilot onboarding playbook',
    description: 'Onboard 3 enterprise pilots.',
    status: 'active',
  });

  // ── Tasks per plan (drives progress segments) ──
  await ensureNodes(planAtlas.id, [
    ['Decide on release flag scope', 'completed'],
    ['Migrate auth tokens to v2 schema', 'completed'],
    ['Implement org-scoped query routing', 'completed'],
    ['Add admin-side feature toggle', 'completed'],
    ['Write upgrade guide', 'completed'],
    ['Set up partner onboarding emails', 'completed'],
    ['Implement billing rollover', 'in_progress'],
    ['Run multi-tenant load test', 'in_progress'],
    ['Coordinate cutover with first 3 partners', 'in_progress'],
    ['Final QA pass', 'in_progress'],
    ['Run rollback dry-run', 'blocked'],
    ['Send waitlist GA email', 'not_started'],
  ]);
  await ensureNodes(planLatency.id, [
    ['Add p95 latency dashboard', 'completed'],
    ['Profile heavy-tenant query plan', 'in_progress'],
    ['Index review for hot endpoints', 'in_progress'],
    ['Cache layer for /timeline endpoint', 'blocked'],
    ['Materialized view for reports', 'not_started'],
    ['Connection pool tuning', 'not_started'],
    ['Verify partner X measurement methodology', 'not_started'],
    ['Run load test at 4× current peak', 'not_started'],
  ]);
  await ensureNodes(planCost.id, [
    ['Tag all GCE instances with cost-center', 'completed'],
    ['Enable BigQuery slot reservations', 'completed'],
    ['Right-size Postgres replicas', 'completed'],
    ['Auto-shutoff for orphan dev VMs', 'in_progress'],
  ]);
  await ensureNodes(planAuth.id, [
    ['SAML provider integration', 'completed'],
    ['OIDC provider integration', 'completed'],
    ['Magic-link flow', 'completed'],
    ['Provider-discovery middleware', 'completed'],
    ['QA across 3 IDPs', 'completed'],
  ]);
  await ensureNodes(planSdk.id, [
    ['Draft contributor license', 'completed'],
    ['Send to legal review', 'not_started'],
    ['Spec public API surface', 'not_started'],
  ]);
  await ensureNodes(planPilots.id, [
    ['Northwind onboarding kickoff', 'in_progress'],
    ['Globex pilot scoping call', 'not_started'],
    ['Initech security review', 'not_started'],
    ['Define pilot success metrics', 'not_started'],
    ['Set up shared support channel', 'not_started'],
    ['Schedule weekly retros', 'not_started'],
  ]);

  // ── Goals ──────────────────────────────────────
  const gAtlas = await findOrCreateGoal({
    title: 'Ship Atlas v2.0 to design-partner cohort',
    description: 'GA-quality release for the 12-org partner waitlist by EOQ.',
    type: 'outcome',
    priority: 1,
  });
  const gLatency = await findOrCreateGoal({
    title: 'Cut p95 query latency below 120ms',
    description: 'Currently 187ms; partner X measured 340ms.',
    type: 'metric',
    priority: 0,
    parentGoalId: gAtlas.id,
  });
  const gRetention = await findOrCreateGoal({
    title: 'Achieve 30+ day pilot retention',
    description: 'Each pilot must complete 30 contiguous days of active use.',
    type: 'metric',
    priority: 0,
    parentGoalId: gAtlas.id,
  });
  const gPilots = await findOrCreateGoal({
    title: 'Onboard 3 enterprise pilots by April',
    description: 'Northwind, Globex, Initech in active conversation.',
    type: 'outcome',
    priority: 1,
  });
  const gAuth = await findOrCreateGoal({
    title: 'Auth & SSO foundation in production',
    description: 'SAML, OIDC, and magic-link verified across 3 IDPs.',
    type: 'outcome',
    priority: 0,
  });
  const gSdk = await findOrCreateGoal({
    title: 'Open-source the SDK by H2',
    description: 'Paused pending legal review of contributor license.',
    type: 'outcome',
    priority: 0,
  });
  const gCost = await findOrCreateGoal({
    title: 'Stay under $40k/mo infra spend',
    description: 'Hard ceiling; finance reviews monthly.',
    type: 'constraint',
    priority: 1,
  });
  const gPrincipleRr = await findOrCreateGoal({
    title: 'Read-replica reads only; never write to followers',
    description: 'Data correctness invariant — applies across all plans.',
    type: 'principle',
    priority: 0,
  });
  const gPrincipleDec = await findOrCreateGoal({
    title: 'Decisions over 4h must be visible to humans',
    description: 'Workspace-wide oversight contract.',
    type: 'principle',
    priority: 0,
  });

  // ── Status transitions ─────────────────────────
  await put(`/goals/${gAuth.id}`, { status: 'achieved' });
  await put(`/goals/${gSdk.id}`, { status: 'paused' });

  // ── Plan ↔ Goal links ──────────────────────────
  for (const [g, p] of [
    [gAtlas, planAtlas],
    [gLatency, planLatency],
    // gRetention has NO plan → exercises "No plan" attention
    [gPilots, planPilots],
    [gAuth, planAuth],
    [gSdk, planSdk],
    [gCost, planCost],
    [gPrincipleDec, planAtlas],
    [gPrincipleDec, planCost],
    [gPrincipleRr, planAtlas],
    [gPrincipleRr, planLatency],
    [gPrincipleRr, planCost],
    [gPrincipleRr, planAuth],
  ]) {
    await ensureLink(g.id, 'plan', p.id);
  }

  // ── Evaluations (drives quality color band) ────
  for (const [g, score, reasoning] of [
    [gAtlas, 84, 'Plan structure tight; partner waitlist firm.'],
    [gLatency, 72, 'Acceptable but at-risk vs. timeline.'],
    [gRetention, 60, 'No plan; needs scoping.'],
    [gPilots, 58, 'Conversations in flight; no signed pilots yet.'],
    [gAuth, 96, 'Done across 3 IDPs.'],
    [gSdk, 41, 'Paused pending legal review.'],
    [gCost, 91, 'Within budget; auto-shutoffs in place.'],
    [gPrincipleRr, 65, 'Solid invariant; not enforced in CI.'],
    [gPrincipleDec, 88, 'Decision queue active for 8 plans.'],
  ]) {
    await ensureEval(g.id, me.id, score, reasoning);
  }

  // ── Achievers (drives progress bars) ───────────
  for (const [g, p] of [
    [gAtlas, planAtlas],
    [gLatency, planLatency],
    [gPilots, planPilots],
    [gAuth, planAuth],
    [gSdk, planSdk],
    [gCost, planCost],
  ]) {
    await ensureAchievers(g.id, p.id);
  }

  // ── Knowledge episodes + episode-links ─────────
  // Drives Knowledge Timeline + Coverage + Graph. Skipped silently when
  // Graphiti is offline (dev w/o OPENAI_API_KEY).
  const episodes = [
    {
      plan: planAtlas,
      taskMatch: /multi-tenant load test/i,
      ep: {
        name: 'Multi-tenant load test result',
        content:
          'Multi-tenant load test ran at 4× current peak. 12 of 14 partner tenants stayed within p95 budget. Tenant TENANT_X showed 320ms p95 due to a missing index on org_messages.thread_id. Filed as blocker; index migration patched in #2241.',
      },
    },
    {
      plan: planAtlas,
      taskMatch: /partner onboarding emails/i,
      ep: {
        name: 'Partner waitlist email cadence',
        content:
          'Partner onboarding emails will be sent in waves of 4. First wave is the 4 design partners who already signed the GA contract. Spacing: 48h between waves to keep human-in-the-loop oversight on initial setups.',
      },
    },
    {
      plan: planAtlas,
      taskMatch: /release flag scope/i,
      ep: {
        name: 'Release flag scope decision',
        content:
          'Decision: Atlas v2.0 release flag scope is ORG-level only, not user-level. Rationale: per-user flagging would explode the eval matrix and we trust org admins to own rollout pacing.',
      },
    },
    {
      plan: planLatency,
      taskMatch: /heavy-tenant query plan|profile heavy/i,
      ep: {
        name: 'p95 latency root-cause analysis',
        content:
          'Heavy-tenant query plan profiling showed 73% of p95 spent in /timeline endpoint waiting on a sequential scan over org_episodes. Adding a partial index on (org_id, created_at DESC) WHERE deleted_at IS NULL drops p95 from 187ms to 112ms in synthetic benchmark.',
      },
    },
    {
      plan: planLatency,
      taskMatch: /connection pool/i,
      ep: {
        name: 'Connection pool tuning',
        content:
          'Postgres connection pool tuned from 20 → 35 with explicit timeout 5s. Improves cold-start latency for newly connected partner tenants. Validated via partner X measurement methodology.',
      },
    },
    {
      plan: planCost,
      taskMatch: /auto-shutoff/i,
      ep: {
        name: 'Auto-shutoff for orphan dev VMs',
        content:
          'Implemented daily cron that flags GCE instances with no inbound traffic for >7 days as orphan candidates. Email to owner before shutdown on day 10. Saves ~$1.2k/mo at current orphan rate.',
      },
    },
    {
      plan: planCost,
      taskMatch: /bigquery/i,
      ep: {
        name: 'BigQuery slot reservation rationale',
        content:
          'Switched from on-demand to flat-rate slot reservations (200 slots) after analytics team usage stabilized. Saves ~30% on BQ spend at our query volume. Trade-off: slower for ad-hoc one-offs but acceptable.',
      },
    },
    {
      plan: planPilots,
      taskMatch: /northwind/i,
      ep: {
        name: 'Northwind kickoff outcome',
        content:
          'Northwind onboarding kickoff completed. Pilot scope: customer support intent classification with their 80k-row historical ticket corpus. Success metric: 30-day retention (logins on ≥20 of next 30 days). Decision-maker: Jane Park (VP Eng).',
      },
    },
    {
      plan: planPilots,
      taskMatch: /globex/i,
      ep: {
        name: 'Globex pilot scoping risk',
        content:
          'Globex pilot scoping call surfaced a risk: their security review requires SOC2 Type II evidence which we do not yet have (Type I in progress). Pushing scoping to after SOC2 Type II audit completes — early Q3.',
      },
    },
    {
      plan: planPilots,
      taskMatch: /initech/i,
      ep: {
        name: 'Initech security review delay',
        content:
          'Initech security review extended by 3 weeks because their security team is short-staffed during their Q2 audit. Mitigation: provide pre-filled VAQ + offer to do live walkthrough vs. sequential email rounds.',
      },
    },
  ];
  for (const e of episodes) {
    await ensureEpisodeWithLink(e.plan.id, e.ep, e.taskMatch);
  }

  console.log(`\nDone. ${errors.length} errors.`);
  if (errors.length) {
    console.log('Errors (first 5):');
    for (const e of errors.slice(0, 5)) console.log('  ', JSON.stringify(e));
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
