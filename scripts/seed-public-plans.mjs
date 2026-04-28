#!/usr/bin/env node
/**
 * Seeds 3 example public plans into a dev workspace so the user can
 * test /explore and /public/plans/:id end-to-end. Each plan has:
 *   - visibility: 'public'
 *   - 5–8 nodes (mix of phase + task) with varied statuses
 *
 * Idempotent: if a plan with the same title already exists for the
 * user, it is reused rather than duplicated.
 *
 * Usage:
 *   API_URL=http://localhost:3000 \
 *   USER_API_TOKEN=eyJhbGc... \
 *   node scripts/seed-public-plans.mjs
 */
import process from 'node:process';

const API = process.env.API_URL || 'http://localhost:3000';
const TOKEN = process.env.USER_API_TOKEN;

if (!TOKEN) {
  console.error('USER_API_TOKEN env var is required');
  process.exit(1);
}

const H = { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' };

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
  if (!res.ok) {
    console.warn(`  ! ${method} ${path} → ${res.status}`, data?.error || '');
  }
  return { ok: res.ok, status: res.status, data };
}
const get = (p) => req('GET', p);
const post = (p, b) => req('POST', p, b);
const put = (p, b) => req('PUT', p, b);

async function findOrCreatePlan(spec) {
  const list = (await get('/plans?limit=200')).data || [];
  const arr = Array.isArray(list) ? list : list.plans || [];
  const existing = arr.find((p) => p.title === spec.title);
  if (existing) {
    // Force visibility to public if not already (idempotent upgrade).
    if (existing.visibility !== 'public') {
      await put(`/plans/${existing.id}`, { visibility: 'public' });
    }
    return existing;
  }
  const { data } = await post('/plans', spec);
  return data;
}

async function ensureNodes(planId, taskList) {
  const list = (await get(`/plans/${planId}/nodes`)).data || [];
  const arr = Array.isArray(list) ? list : list.nodes || [];
  const byTitle = new Map(arr.map((n) => [n.title, n]));
  const created = [];
  for (const [title, status, nodeType = 'task'] of taskList) {
    let n = byTitle.get(title);
    if (!n) {
      const r = await post(`/plans/${planId}/nodes`, { node_type: nodeType, title });
      n = r.data;
    }
    if (n && status !== 'not_started') {
      await put(`/plans/${planId}/nodes/${n.id}/status`, { status });
    }
    created.push(n);
  }
  return created;
}

const PLANS = [
  {
    plan: {
      title: 'Open-source MCP gateway launch',
      description:
        'Ship a public release of the MCP gateway with docs, install paths for the major clients, and a beta program.',
      visibility: 'public',
    },
    tasks: [
      ['Phase 1 — Discovery', 'completed', 'phase'],
      ['Survey existing MCP gateways', 'completed', 'task'],
      ['Pick reference clients', 'completed', 'task'],
      ['Phase 2 — Build', 'in_progress', 'phase'],
      ['Write Claude Desktop install path', 'completed', 'task'],
      ['Write Cursor install path', 'in_progress', 'task'],
      ['Write ChatGPT custom-GPT path', 'not_started', 'task'],
      ['Phase 3 — Launch', 'not_started', 'phase'],
      ['Open beta cohort onboarding', 'not_started', 'task'],
    ],
  },
  {
    plan: {
      title: 'Goal coherence dial — public methodology',
      description:
        'Document how AgentPlanner computes its BDI coherence score, with worked examples and an open formula.',
      visibility: 'public',
    },
    tasks: [
      ['Draft formula doc', 'completed', 'task'],
      ['Add worked example: stale plan', 'completed', 'task'],
      ['Add worked example: blocked task', 'in_progress', 'task'],
      ['Peer review with two ML-aligned readers', 'not_started', 'task'],
      ['Publish to /docs/coherence', 'not_started', 'task'],
    ],
  },
  {
    plan: {
      title: 'Public-plan share-link spec',
      description:
        'Define what an anonymous share-link viewer can and cannot see — covers status masking, fork affordance, and crawler/SEO behavior.',
      visibility: 'public',
    },
    tasks: [
      ['Phase 1 — Audit current behavior', 'completed', 'phase'],
      ['Map all status enums to public-safe equivalents', 'completed', 'task'],
      ['Document what fields are stripped from /public/plans payload', 'completed', 'task'],
      ['Phase 2 — Design fork affordance', 'in_progress', 'phase'],
      ['Wire "Copy to my workspace" button', 'in_progress', 'task'],
      ['Decide attribution semantics for forked plans', 'not_started', 'task'],
      ['Phase 3 — SEO + sharing', 'not_started', 'phase'],
      ['Add OG card generator', 'not_started', 'task'],
      ['Add robots.txt rules for /public/plans/*', 'blocked', 'task'],
    ],
  },
];

async function main() {
  console.log(`Seeding public plans into ${API}…`);
  for (const { plan, tasks } of PLANS) {
    console.log(`  • ${plan.title}`);
    const p = await findOrCreatePlan(plan);
    if (!p?.id) {
      console.warn('    skip — no plan id returned');
      continue;
    }
    await ensureNodes(p.id, tasks);
    console.log(`    /public/plans/${p.id}`);
  }
  console.log('Done.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
