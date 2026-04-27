# Golden Dataset — UI Regression Reference

This is the reference dataset produced by `scripts/seed-golden-dataset.mjs`. After
running the seeder, the v1 redesign Goals index, Mission Control, and Strategic
Overview should render the states described below. Use this document as the
acceptance test when reviewing changes to the goals/plans surfaces.

## How to seed

```bash
# 1. Get an API token from /app/settings (or POST /auth/login + read response)
export USER_API_TOKEN=<token>
export API_URL=http://localhost:3000

# 2. Run the seeder
cd agent-planner
node scripts/seed-golden-dataset.mjs        # idempotent; reuses existing
node scripts/seed-golden-dataset.mjs --reset # delete + reseed (destructive)
```

## Dataset summary

- **9 goals** for the seeded user (matches the screen-goals-list.jsx mock)
  - 4 Outcomes, 2 Metrics, 1 Constraint, 2 Principles
  - 7 active, 1 achieved, 1 paused, 0 abandoned
  - 1 sub-goal pair: `Cut p95 latency` and `Achieve 30+ day pilot retention` parented to `Ship Atlas v2.0`
- **6 plans**, varied statuses (active / completed / draft)
- **38 nodes** total across plans, mixing `completed / in_progress / blocked / not_started`
- **9 evaluations** spread across the three quality bands (≥80 emerald, 60–79 amber, <60 red)
- **38 achievers** linking nodes to goals so `/goals/:id/progress` returns real stats

## Per-goal expected state on the Goals index

Sort: Attention. Status filter: Active.

| Goal | Type | Attention pill | Quality | Plans | Progress | Status |
|---|---|---|---|---|---|---|
| Achieve 30+ day pilot retention | Metric ▲ | **No plan** (amber) | 60 (amber) | 0 (red) | `NO PLAN` placeholder | Active |
| AI Transformation for Construction SaaS | Outcome ◉ | **At risk** (red) when ageDays>14 + pct<25 | — (no eval) | 1 | `LOADING…` then real % | Active |
| Launch MVP by Q2 | Outcome ◉ | **Stale** (amber) — older than 5d | — (no eval) | 3 | real % from achievers | Active |
| Decisions over 4h must be visible to humans | Principle ◆ | none | 88 (emerald) | 2 | `STANDING RULE` | Active |
| Read-replica reads only; never write to followers | Principle ◆ | none | 65 (amber) | 4 | `STANDING RULE` | Active |
| Stay under $40k/mo infra spend | Constraint ◐ | none | 91 (emerald) | 1 | ~75% from 4 nodes (3 done, 1 doing) | Active |
| Onboard 3 enterprise pilots by April | Outcome ◉ | none initially; **At risk** if pct<25 + age>14 | 58 (red) | 1 | 0% from 6 nodes (all not started except 1 doing) | Active |
| Cut p95 query latency below 120ms | Metric ▲ (sub-goal of Atlas) | none | 72 (amber) | 1 | ~13% from 8 nodes | Active |
| Ship Atlas v2.0 to design-partner cohort | Outcome ◉ | none | 84 (emerald) | 1 | ~50% from 12 nodes (6 done, 4 doing, 1 blocked, 1 todo) | Active |

Status filter: All — additionally surfaces:

| Goal | Type | Attention pill | Quality | Plans | Progress | Status |
|---|---|---|---|---|---|---|
| Open-source the SDK by H2 | Outcome ◉ | **Paused {N}d** (slate) | 41 (red) | 1 | ~33% from 3 nodes | Paused |
| Auth & SSO foundation in production | Outcome ◉ | **Done · {date}** (emerald) | 96 (emerald) | 1 | 100% from 5 nodes | Achieved |

## Header expected state

- Kicker: `◆ GOALS`
- Title: `9 active goals, 3 need a look` (need-attention count = goals matching `noplan` ∪ `stale` ∪ `you`).
- Filter pills counts: All 11, Active 9, Achieved 1, Paused 1, Abandoned 0.
- Type filter pills counts: All 11, Outcome 4, Metric 2, Constraint 1, Principle 2.

## Visual states the dataset exercises

| Surface element | Triggered by |
|---|---|
| Type swatch (◉ amber / ▲ emerald / ◐ red / ◆ violet) | Each of 4 goal types present |
| Status spine (amber active / emerald achieved / slate paused) | All 3 spine colors visible |
| Lineage rail (depth-based connecting lines) | The Atlas → latency / retention pair |
| Quality color bands (emerald ≥80 / amber 60–79 / red <60) | Scores 41 / 58 / 60 / 65 / 72 / 84 / 88 / 91 / 96 |
| Plans-count red flag | Goal with 0 plans (Achieve 30+ day pilot retention) |
| Segmented progress (green/amber/red) | Atlas plan: 6 done, 4 in-progress, 1 blocked, 1 not-started |
| `STANDING RULE` placeholder | Two principle goals |
| `NO PLAN` placeholder | Goal with no linked plan |
| `LOADING…` placeholder | First render before per-row useGoalProgress resolves |
| Attention pill `At risk` | Active + linked + completionPct < 25 + age > 14 days |
| Attention pill `No plan` | Active non-principle with 0 links |
| Attention pill `Stale` | Active + updatedAt > 5 days ago |
| Attention pill `Paused {N}d` | Status = paused |
| Attention pill `Done · {date}` | Status = achieved |
| `BDI density (10d)` spark — populated | Goals with evaluations (proxy: evaluation count buckets per day) |
| `NO SIGNAL` empty spark | Goals with 0 evaluations |
| Status dot pulse halo | Active rows |
| Status dot no halo | Paused / achieved rows |

## Cross-surface expectations

- **Mission Control** (`/app`):
  - GOALS counter: 9 active
  - PLANS counter: ≥10 active (4 pre-existing + 6 seeded — adjust if you reset first)
  - Coherence dial: render any non-zero value
  - "In motion" goals list: Atlas v2.0 visible at top
- **Strategic Overview** (`/app/strategy`):
  - Attention spectrum bar: STALE / NEEDS INPUT buckets non-zero, IN MOTION majority
  - Next-up section may be empty (no agent-suggested next actions seeded)
- **Plans Index** (`/app/plans`):
  - 11+ plans (4 pre-existing + 6 seeded). Atlas, latency, cost, auth, sdk, pilots all visible
  - Stale chips on plans whose updatedAt > 5d (rare in fresh seed)
- **Public Plan / Explore**: not exercised by this seed.

## Known issues this dataset uncovered

1. **`/goals/tree` originally did not return `links` or `evaluations`** — UI showed
   `0 plans` and `— quality` everywhere. Fixed in `agent-planner/src/db/dal/goals.dal.mjs`
   by bulk-loading both into the tree response. Required to make the Goals index
   render anything other than empty cells.
2. **`POST /goals/:id/evaluations` requires `evaluatedBy: <userId>`** but the field
   is undocumented at the route level. Calls without it fail with `400 evaluatedBy
   is required`. The seeder always passes the authenticated user's id; document this
   in `01-screen-specs.md` if a Quality flow is added.
3. **`POST /goals/:id/links` ≠ progress** — linking a plan to a goal does NOT make
   that plan's nodes count toward `/goals/:id/progress`. Progress requires
   `POST /goals/:id/achievers` per individual node. The seeder calls both. The
   goals-list spec should clarify whether "plans" count and "progress" come from
   the same edge or different edges.
4. **API response shape inconsistency**: `/goals` and `/goals/tree` return `{ goals
   | tree: [...] }`; `/plans` returns a bare array. Consumers must handle both. Worth
   normalizing.
5. **The "At risk" attention pill is computed inside `<GoalRidge>` from per-row
   `useGoalProgress`**, so it can't influence the headline `X need a look` count
   or the `Sort: Attention` order. To fix: either return progress percent in the
   `/goals/tree` payload (alongside links/evaluations) or move at-risk derivation
   to the backend.
6. **The `BDI density (10d)` spark** uses `evaluations[].evaluatedAt` count
   buckets per day as a proxy. True BDI activity (belief/desire/intention deltas
   per day) requires Graphiti episode counts joined per goal — not yet wired.

## Knowledge views expected state

After seeding, the seeder also adds 10 Graphiti episodes scoped to plans (skipped silently if Graphiti is offline). Each episode is `episode_links`-linked to a matching task so Coverage rolls up correctly.

| Surface | Expected |
|---|---|
| `/app/knowledge/timeline` | All 10 episodes grouped under `Today · Monday, Apr 27` (or whatever date). Each row: timestamp, episode title, violet `agentplanner knowledge entry` source pill, content body. Sorted newest-first. `Graphiti · live` status dot emerald. |
| `/app/knowledge/coverage` | Overall gauge ~`19% gap` (`7 of 36 active tasks have ≥1 episode linked`). Per-plan breakdown shows non-zero on Atlas (`17%`), p95 latency (`29%`), Pilot onboarding (`50% partial`); zero on Frontend UI / Backend API / DevOps / SDK / AI Transformation. |
| `/app/knowledge/graph` | Search box, `0 entities · 0 facts` until query. Search `p95 latency` → `~10 entities · ~18 facts` graph with rounded-pill nodes + edges. Click a node (e.g. `Q3`) → right Entity Inspector populates: name, summary, recent-facts list. |

Bugs found while wiring this:

- **Frontend Knowledge Graph page mis-unwrapped mutation results** (`KnowledgeGraphV1.tsx`). The mutation hooks already return `{entities: [...]}` / `{facts: [...]}`, but the page read `er.value.entities.nodes` / `fr.value.results.facts` (the raw bridge shape). Always rendered empty. Fixed by reading `er.value.entities` / `fr.value.facts`.
- **`POST /knowledge/episodes` field naming**: the route stores `metadata.plan_id` but Coverage rolls up via `episode_links`, not metadata. Episodes added with only `metadata.plan_id` do NOT count for Coverage. The seeder always also calls `POST /plans/:id/nodes/:nodeId/episode-links` with `episode_id`. **The link route uses `episode_id`, not `episode_uuid`** — undocumented.
- **`GET /knowledge/episodes` double-nested response**: returns `{episodes: {message, episodes: [...]}, group_id}`. Frontend hooks already normalize this; external integrators must too.

## Validation checklist for code review

After running the seeder, open `localhost:3001/app/goals` and verify:

- [ ] Header shows `9 active goals, 3 need a look`
- [ ] Status pills show counts `All 11 / Active 9 / Achieved 1 / Paused 1 / Abandoned 0`
- [ ] Type pills show `Outcome 4 / Metric 2 / Constraint 1 / Principle 2`
- [ ] At least one row has `At risk` red pill
- [ ] At least one row has `Stale` amber pill
- [ ] At least one row has `No plan` amber pill
- [ ] Switching to `All` filter reveals `Paused 95d` slate pill and `Done · {date}` emerald pill
- [ ] `Standing rule` placeholder appears for both principle rows
- [ ] Progress bar segments render in emerald/amber/red proportions on Atlas row
- [ ] Quality scores show three colour bands (emerald/amber/red) across the list
- [ ] Sub-goal lineage rail renders when Atlas + sub-goals are adjacent (sort: Updated)

If any item fails, the regression is real — investigate.
