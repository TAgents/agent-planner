#!/usr/bin/env node
/**
 * Seeds knowledge episodes (Graphiti) linked to seeded plan tasks so
 * the Knowledge Coverage tethers, Timeline plan attribution, and
 * entity-inspector linked-tasks panel have realistic data to show.
 *
 * Idempotent on (plan title, task title): skips episodes that look
 * like they've already been linked to a given task. Each task gets
 * one or two episodes so Coverage gauges show meaningful ratios.
 *
 * Usage:
 *   API_URL=http://localhost:3000 \
 *   USER_API_TOKEN=cd5f64f857c495ca1e33430089acac0d27d50d23aae76774a25e7be1fc0fc88e \
 *   node scripts/seed-knowledge-episodes.mjs
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
  try { data = await res.json(); } catch {}
  if (!res.ok) {
    console.warn(`  ! ${method} ${path} → ${res.status}`, data?.error || '');
  }
  return { ok: res.ok, status: res.status, data };
}
const get = (p) => req('GET', p);
const post = (p, b) => req('POST', p, b);

// Episode templates per task title. Each entry seeds one or two
// short, plausible knowledge episodes that an agent might log while
// working on that task. Keep them under ~280 chars so they read like
// "what the agent learned" not "the full task brief".
const EPISODES_BY_TASK = {
  // Plan 1 — Open-source MCP gateway launch
  'Survey existing MCP gateways': [
    {
      name: 'MCP gateway landscape — Q1 survey',
      content:
        'Surveyed 14 MCP gateways: 9 are stdio-only, 3 support HTTP/SSE, 2 (Cline, mcp-bridge) ship a one-click installer. Take-away: HTTP/SSE is the differentiator for our launch positioning.',
    },
  ],
  'Pick reference clients': [
    {
      name: 'Reference client criteria',
      content:
        'Picked Claude Desktop, Cursor, ChatGPT (custom GPTs) as reference clients. Rejected Windsurf for v1 — telemetry shows <5% of MCP tool-callers identify as Windsurf. Cline deferred to v1.1.',
    },
  ],
  'Write Claude Desktop install path': [
    {
      name: 'Claude Desktop .mcpb signing',
      content:
        'Bundle install requires the .mcpb to be signed; otherwise Claude Desktop blocks load. We use developer-id signing with a notarized bundle. Signing key lives in 1Password (vault: ENG-PROD).',
    },
    {
      name: 'Fallback install path',
      content:
        'When the .mcpb fails, users can fall back to manual config: ~/Library/Application Support/Claude/config.json with mcpServers.agentplanner. The Connect page surfaces this as the second tab.',
    },
  ],
  'Write Cursor install path': [
    {
      name: 'Cursor settings.json structure',
      content:
        'Cursor reads MCP servers from ~/.cursor/mcp.json (per-user) or .cursor/mcp.json in the workspace. Per-workspace is preferred for multi-org developers — keeps credentials scoped to the project.',
    },
  ],

  // Plan 2 — Goal coherence dial
  'Draft formula doc': [
    {
      name: 'Coherence formula v0.3',
      content:
        'Coherence = 1 − (w_d·decisions_pending + w_s·stale_plans_ratio + w_b·blocked_tasks_ratio + w_u·unlinked_goals_ratio). Weights: d=0.3, s=0.25, b=0.3, u=0.15. Clipped to [0,1].',
    },
  ],
  'Add worked example: stale plan': [
    {
      name: 'Stale-plan example writeup',
      content:
        'Worked example: a 12-task plan untouched for 8 days (>5d threshold) contributes stale_plans_ratio=1/total_active. With 3 total plans and weights above, coherence drops by ~8 points.',
    },
  ],

  // Plan 3 — Public-plan share-link spec
  'Map all status enums to public-safe equivalents': [
    {
      name: 'Status mask decision',
      content:
        'Decision: draft and plan_ready statuses mask to "not_started" for public viewers. Avoids leaking work-in-progress signals to anonymous viewers. Implemented in PublicPlanV1.helpers.ts.',
    },
  ],
  'Document what fields are stripped from /public/plans payload': [
    {
      name: 'Public payload field list',
      content:
        'Stripped from /plans/public response: owner_email, organization_id, github_repo_url, agent_instructions, decisions, node_logs. Title/description/structure remain. Confirmed via swagger schema diff.',
    },
  ],
  'Wire "Copy to my workspace" button': [
    {
      name: 'Fork endpoint contract',
      content:
        'POST /plans/:id/fork creates a new plan owned by the caller with metadata.forked_from = source_plan_id. Visibility resets to "private" — even if source is public, fork is private until owner re-publishes.',
    },
  ],
};

async function main() {
  console.log(`Seeding knowledge episodes via ${API}…`);

  // Pull all plans owned by the user, then for each task whose title
  // matches a template, create the episode + link it.
  const plansRes = await get('/plans?limit=200');
  const plans = Array.isArray(plansRes.data) ? plansRes.data : plansRes.data?.plans || [];
  if (plans.length === 0) {
    console.error('No plans found. Run scripts/seed-public-plans.mjs first.');
    process.exit(1);
  }

  let createdEpisodes = 0;
  let createdLinks = 0;

  // Tree → flat list of all task/milestone nodes (the endpoint nests
  // tasks inside phases via `children`, so a plain iteration would
  // miss every nested task).
  function flattenTaskNodes(tree) {
    const out = [];
    function walk(arr) {
      for (const n of arr || []) {
        if (n.node_type === 'task' || n.node_type === 'milestone') out.push(n);
        if (Array.isArray(n.children) && n.children.length > 0) walk(n.children);
      }
    }
    walk(Array.isArray(tree) ? tree : []);
    return out;
  }

  // Phase 1: queue every (task → episode) intent we want to write.
  // We don't poll between POSTs — Graphiti's queue handles them in
  // parallel and a single big sync at the end is far cheaper than
  // N×5 polls during creation.
  const intents = []; // {plan_id, node_id, name}
  for (const plan of plans) {
    const nodesRes = await get(`/plans/${plan.id}/nodes`);
    const tree = Array.isArray(nodesRes.data) ? nodesRes.data : nodesRes.data?.nodes || [];
    const nodes = flattenTaskNodes(tree);

    for (const node of nodes) {
      const templates = EPISODES_BY_TASK[node.title];
      if (!templates) continue;

      // Skip if this task already has any episode_link — idempotent.
      const existing = await get(`/plans/${plan.id}/nodes/${node.id}/episode-links`);
      const existingLinks = Array.isArray(existing.data) ? existing.data : existing.data?.links || [];
      if (existingLinks.length > 0) continue;

      for (const tmpl of templates) {
        const epRes = await post('/knowledge/episodes', {
          name: tmpl.name,
          content: tmpl.content,
          source: 'message',
          source_description: 'agentplanner knowledge entry',
        });
        if (epRes.ok) {
          intents.push({ plan_id: plan.id, node_id: node.id, name: tmpl.name });
          createdEpisodes += 1;
        }
      }
      console.log(`  ✓ ${plan.title} → ${node.title} (${templates.length} ep queued)`);
    }
  }

  if (intents.length === 0) {
    console.log('Nothing to link. Done.');
    return;
  }

  // Phase 2: wait for Graphiti to drain, then resolve each name → uuid
  // from a single recent-feed pull (max 200 — well above expected total).
  console.log(`Waiting 8s for Graphiti to commit ${intents.length} episodes…`);
  await new Promise((r) => setTimeout(r, 8000));

  const recent = await get('/knowledge/episodes?max_episodes=200');
  const list = recent.data?.episodes || [];
  // Build a name → most-recent-uuid map. If a name appears more than
  // once (re-runs across the seeder's history), we take the newest.
  const byName = new Map();
  for (const e of list) {
    const cur = byName.get(e.name);
    if (!cur || new Date(e.created_at) > new Date(cur.created_at)) byName.set(e.name, e);
  }

  for (const it of intents) {
    const ep = byName.get(it.name);
    if (!ep?.uuid) {
      console.warn(`    unresolved: "${it.name}" — Graphiti may still be processing`);
      continue;
    }
    const linkRes = await post(`/plans/${it.plan_id}/nodes/${it.node_id}/episode-links`, {
      episode_id: ep.uuid,
      link_type: 'informs',
    });
    if (linkRes.ok) createdLinks += 1;
  }

  console.log(`Done. Queued ${createdEpisodes} episodes, linked ${createdLinks}.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
