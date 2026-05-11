# Golden Test Set — Workspace + Blueprint (v1.1)

UI regression runbook for the four screens shipped in v1.1 — Workspaces Index, Workspace Detail, Blueprints Index, Blueprint Detail — plus the cross-flow surfaces (Mission Control workspaces strip, Plan tree breadcrumb, Goal detail workspace chip) and the underlying API.

Each scenario is a self-contained checklist a coding agent (Claude Code via Chrome MCP) can run end-to-end against a freshly seeded dev stack. The expected results are precise enough to grade pass/fail.

---

## Setup

```bash
# 1. Bring up local stack on a feature branch
cd agent-planner
docker compose -f docker-compose.local.yml up -d
# wait for api healthy
docker exec agent-planner-postgres-1 psql -U agentplanner -d agentplanner -c "SELECT 1" >/dev/null

# 2. Apply 0019 if not already in schema_migrations
docker exec agent-planner-api-1 node scripts/run-migrations.mjs

# 3. Backfill the Default workspace per org
docker exec -e DATABASE_URL=postgres://agentplanner:localdevpassword@postgres:5432/agentplanner \
  agent-planner-api-1 node scripts/backfill-default-workspace.mjs

# 4. Seed the golden dataset for a real user (export their API token first)
export USER_API_TOKEN=<JWT or API key>
export API_URL=http://localhost:3000
node scripts/seed-workspace-blueprint-dataset.mjs
# OR --reset to nuke the seeded rows before re-seeding
```

The seed creates (assuming the user belongs to ≥1 org):

| Resource | Title | Notes |
|---|---|---|
| Workspace | `Default` | auto-created by backfill; isDefault=true |
| Workspace | `Growth Engine — Q3` | user-created, live |
| Workspace | `Old Initiative` | user-created, **archived** |
| Plan | `Q3 Launch Plan` | inside Growth Engine, 10 tasks, status=active |
| Plan | `Weekly Research Brief — Pricing` | inside Growth Engine, 5 tasks, status=draft |
| Blueprint | `Product Launch v3` | plan-scope, scope=plan, unlisted, 12 nodes |
| Blueprint | `Weekly Research Brief` | plan-scope, scope=plan, private, 7 nodes |
| Forked plan | `Q3 Launch — execution` | from Product Launch v3 → Growth Engine |
| Forked plan | `Sample Launch run-through` | from Product Launch v3 → Default |
| Forked plan | `Weekly research — week 1` | from Weekly Research Brief → Growth Engine |

After seeding, **Product Launch v3** has `forkCount = 2` and Mission Control should surface 3 recent forks.

---

## How to run a scenario (Chrome MCP)

For each scenario below, the agent should:

1. Set the active page to the URL listed in **Preconditions**.
2. Take a fresh `take_snapshot` (a11y tree) — *don't* navigate by uid from a stale snapshot.
3. Execute each step. Use `click` / `fill` against uids from the most recent snapshot.
4. After each step that mutates state, call `wait_for` on a string expected by the next assertion to avoid race conditions.
5. Assert the **Expected** checklist. Each line must be observable in the snapshot (or in `list_console_messages` for the no-error assertion).

A scenario passes only if every line of **Expected** holds. Report `PASS`/`FAIL` per scenario, with a screenshot at the failing step.

---

## W — Workspaces

### W1: Workspaces Index renders all live rows with non-zero counts

**Preconditions:** Logged in; seed dataset applied.

**Steps:**
1. Navigate to `/app/workspaces`.

**Expected:**
- Tab bar shows `All ≥2`, `Healthy ≥2`, `Archived ≥1`.
- Row `Default`: badge `DEFAULT`, `GOAL` column shows `≥1 goals` (backfill assigned them), `PLANS` column shows `1 plan` (the Sample Launch run-through fork).
- Row `Growth Engine — Q3`: `GOAL` column shows `0 goals` (or count, no `— LINK A GOAL` text), `PLANS` shows `3 plans` (Q3 Launch + Research Brief + Q3 Launch — execution fork).
- Row `Old Initiative` is **not visible** under `All` (live filter).
- No console errors or warnings.

### W2: Archived filter reveals the wound-down workspace

**Preconditions:** On `/app/workspaces`.

**Steps:**
1. Click the `Archived` filter tab.

**Expected:**
- Row `Old Initiative` is now visible; live workspaces are hidden.
- The row still routes — clicking it navigates to `/app/workspaces/<id>`.

### W3: Create Workspace happy path

**Preconditions:** On `/app/workspaces`, modal closed.

**Steps:**
1. Click `Create Workspace` button.
2. Wait for heading `Create a workspace`.
3. Fill `Title` with `Test Scenario W3 ${ts}` (use a fresh timestamp suffix to keep idempotency).
4. Click `Create`.

**Expected:**
- URL changes to `/app/workspaces/<new-uuid>`.
- Breadcrumb reads `Workspaces › Test Scenario W3 ${ts}`.
- Summary strip shows `GOALS=0`, `PLANS=0`, `FORKED FROM = blank start`.
- Provenance panel shows `SLUG = test-scenario-w3-…`.

### W4: Create Workspace validates required title

**Preconditions:** Modal open, title field empty.

**Steps:**
1. Observe the `Create` button.

**Expected:**
- `Create` button is disabled (button has `disabled` attribute).
- No request fires.

### W5: Workspace Detail surfaces all live panels for the Default workspace

**Preconditions:** Navigate to the Default workspace detail page (route via `/app/workspaces/<id>`).

**Expected:**
- Breadcrumb: `Workspaces › Default`.
- Kicker: `WORKSPACE · LIVE` (with `DEFAULT` badge if `isDefault`).
- Summary strip: `HEALTH=Healthy (PROPOSED chip)`, `GOALS=<n>`, `PLANS=1`, `FORKED FROM = blank start`.
- Goals panel lists each backfilled goal as a clickable row.
- Plans panel lists `Sample Launch run-through` with status `draft`.
- People panel mentions org-membership inheritance and shows the owner id prefix.
- Provenance panel shows `CREATED`, `UPDATED`, `SLUG = default`, `FORKED FROM = —`.

### W6: Activity timeline appears when workspace has plans

**Preconditions:** Workspace Detail for `Growth Engine — Q3`.

**Expected:**
- An `ACTIVITY` panel renders at the bottom of the page.
- For a freshly forked plan with no logs yet, the panel shows the empty-state line `No activity logged yet across the plans in this workspace.` (Don't fail just because the seed produced no log rows — only fail if the panel itself is missing.)

### W7: Cannot delete the Default workspace via API

**Preconditions:** Default workspace's id.

**Steps:**
1. `DELETE /workspaces/<default-id>`.

**Expected:**
- Response is `409`.
- Workspace still exists in the database and in `GET /workspaces`.

---

## B — Blueprints

### B1: Blueprints Index hero stats reflect seeded counts

**Preconditions:** Navigate to `/app/blueprints`.

**Expected:**
- `TOTAL BLUEPRINTS = 2`, sub-line `0 workspace · 2 plan`.
- `TOTAL FORKS = 3` (2 from Product Launch v3 + 1 from Weekly Research Brief).
- `MOST FORKED = Product Launch v3`, sub-line `2× forks`.
- Two cards rendered, each with violet `PLAN · BP` scope chip.
- Tab `All 2`, `Workspace 0`, `Plan 2`.

### B2: Scope tab filters cards correctly

**Preconditions:** On `/app/blueprints`.

**Steps:**
1. Click `Plan` tab.

**Expected:** Same two cards visible.

**Steps (continued):**
2. Click `Workspace` tab.

**Expected:**
- Cards disappear; empty-state copy renders.

### B3: Blueprint Detail renders MetaStrip with correct numbers

**Preconditions:** Click `Product Launch v3` card on the index, or navigate by id.

**Expected:**
- Breadcrumb: `Blueprints › Product Launch v3`.
- Header chip: `PLAN BLUEPRINT · v1 · UNLISTED`.
- Action buttons: `Edit structure`, `Add as Plan →` (because plan-scope).
- MetaStrip cells:
  - `SCOPE = Plan` (sub: `Adds a plan into a workspace`).
  - `FORKS = 2` (sub: `all-time`).
  - `STRUCTURE = <p>p · <t>t` where `<t> ≥ 8`.
  - `VISIBILITY = unlisted`, sub `published <date>`.
  - `LAST UPDATED` is a date string.
- Structure card shows phase rows + a subset of task chips with `+N` overflow.
- Source panel shows `SOURCE PLAN` row with a `View source plan` chip.
- Tags row shows `gtm` and `launch`.

### B4: Fork History panel lists each derived plan

**Preconditions:** On Blueprint Detail for `Product Launch v3`.

**Expected:**
- `FORK HISTORY` panel reads `Plans forked from this blueprint`, count `2`.
- Two rows:
  - `Q3 Launch — execution` + `WS Growth Engine — Q3` chip + relative timestamp.
  - `Sample Launch run-through` + `WS Default` chip + relative timestamp.
- Each row links to `/app/plans/<id>`. The workspace chip links separately to `/app/workspaces/<id>` and does **not** propagate up.

### B5: Fork modal lists all live workspaces

**Preconditions:** On Blueprint Detail for `Product Launch v3`.

**Steps:**
1. Click `Add as Plan →`.

**Expected:**
- Modal header: `Add as plan to a workspace` (because plan-scope).
- `TARGET WORKSPACE` select contains at least `Default (default)` and `Growth Engine — Q3`.
- `Archived` workspaces (`Old Initiative`) must **not** appear in the dropdown.
- `NEW PLAN TITLE` defaults to the blueprint title.
- `Fork` button is enabled iff a workspace is selected.

### B6: Fork modal Cancel discards changes

**Preconditions:** Modal open from B5.

**Steps:**
1. Click `Cancel` (or the overlay outside the modal).

**Expected:**
- Modal closes; URL unchanged; no new plan created.

### B7: Fork creates a new plan in the target workspace

**Preconditions:** Modal open from B5.

**Steps:**
1. Select `Growth Engine — Q3` in the workspace dropdown.
2. Replace title with `Scenario B7 ${ts}`.
3. Click `Fork`.

**Expected:**
- URL changes to `/app/plans/<new-id>` within ≤5s.
- Plan tree breadcrumb reads `Workspaces › Growth Engine — Q3 › Scenario B7 ${ts}`.
- Plan status pill = `DRAFT`.
- Tree contains at least one root + one phase + one task; **every** node's status starts at `not_started`.
- API: `GET /plans/<id>` returns `workspace_id`, `forked_from_blueprint_id`, and a non-null `forked_at`.

### B8: Save Plan as Blueprint via API populates the gallery

**Preconditions:** A plan id you own that is *not* yet a blueprint source.

**Steps:**
1. `POST /blueprints/from_plan/<plan-id>` with body `{ "title": "Scenario B8 ${ts}", "visibility": "private" }`.
2. Reload `/app/blueprints`.

**Expected:**
- Response 201; `scope = plan`; `payload.nodes` length matches plan node count; **no** `status` / `assigned_agent_id` / `quality_score` keys on any payload node (run-state excluded).
- The new card appears in the index with `0× forks`.

---

## X — Cross-flow

### X1: Mission Control shows Active Workspaces card

**Preconditions:** Navigate to `/app`.

**Expected:**
- Section `◇ ACTIVE WORKSPACES` renders after the Goal Constellation.
- At least one tile for `Default` and one for `Growth Engine — Q3`.
- Each tile shows non-zero `<n> goals` / `<n> plans` counts and a relative `upd <time> ago`.
- `VIEW ALL →` link navigates to `/app/workspaces`.

### X2: Mission Control shows Recent Forks

**Preconditions:** On `/app`.

**Expected:**
- Section `◇ RECENT FORKS` renders next to Active Workspaces.
- At least 3 forked plans listed (from the seed).
- Each row: `PL <plan title>` chip + relative `forked <time> ago` + plan status (`DRAFT`/`ACTIVE`).
- Rows link to `/app/plans/<id>`.

### X3: Plan tree breadcrumb shows the parent workspace

**Preconditions:** Navigate to the plan id for `Q3 Launch — execution` (forked, in Growth Engine).

**Expected:**
- Breadcrumb: `Workspaces › Growth Engine — Q3 › Q3 Launch — execution`.
- `Workspaces` and `Growth Engine — Q3` segments are clickable links; final segment is plain text.

### X4: Plan tree breadcrumb falls back for personal plans

**Preconditions:** Find or create a plan owned by the user with no `workspace_id` (any pre-backfill personal plan).

**Expected:**
- Breadcrumb: `Plans › <plan title>`.
- No `Workspaces` segment appears.

### X5: Goal detail shows the workspace breadcrumb and chip

**Preconditions:** Navigate to a backfilled goal whose `workspace_id` is the Default workspace.

**Expected:**
- Breadcrumb row reads `WORKSPACES › DEFAULT › GOALS › <type>` (all-caps from the existing v1 style).
- A `WS Default` ObjectChip appears next to the type/health pills, linking to the workspace.

### X6: Goal detail falls back for personal goals

**Preconditions:** A goal with `workspace_id = NULL` (pre-backfill personal goal, no org).

**Expected:**
- Breadcrumb: `GOALS › <type>`.
- Inline message reads `Personal · no workspace` instead of the workspace chip.

---

## A — API (no Chrome required)

These are HTTP assertions runnable with `curl` or any client. Run them when you can't open a browser, or as smoke checks before the UI scenarios.

| # | Method + Path | Body | Assert |
|---|---|---|---|
| A1 | `POST /workspaces` | `{ organization_id, title: "T${ts}" }` | 201; response includes `slug`, `isDefault=false`, `archivedAt=null` |
| A2 | `GET /workspaces?organization_id=<id>` | — | 200; rows include `goalCount` + `planCount` (integers, not undefined) |
| A3 | `GET /workspaces/<id>` | — | 200; includes `goalCount`, `planCount`, `role` |
| A4 | `POST /workspaces/<id>/archive` then `/restore` | — | both 200; `archivedAt` toggles between timestamp and `null` |
| A5 | `DELETE /workspaces/<defaultId>` | — | 409 |
| A6 | `POST /blueprints/from_plan/<planId>` | `{ title }` | 201; `scope=plan`; `payload.nodes[*]` has no `status`/`assigned_agent_id`/`quality_score` |
| A7 | `POST /blueprints/<id>/fork` | `{ workspace_id, title }` | 201; new plan row; `workspace_id`, `forked_from_blueprint_id`, `forked_at` all populated |
| A8 | `GET /blueprints/<id>/forks` | — | 200; each fork has a `workspace: { id, title, slug }` sub-object |
| A9 | `PATCH /blueprints/<id>` | `{ scope: "workspace" }` | 200 but `scope` remains `plan` (server strips immutable fields) |

---

## Quick-run helpers

Run the full UI suite from a Claude Code prompt:

```text
Run the scenarios in agent-planner/tests/fixtures/workspace-blueprint-golden.md
against http://localhost:3001. Use Chrome MCP. For each scenario, report PASS or
FAIL with a one-line reason. Stop only on infra failures (auth, 5xx), not on
individual scenario fails.
```

Run the API suite via the bash CLI:

```bash
JWT=<token> bash tests/fixtures/run-workspace-blueprint-api.sh
```

(The bash file is left as a thin curl driver; see scenario rows A1–A9 for the
exact payloads.)
