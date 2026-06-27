# Meta-analysis findings — bugs / inconsistencies / DX gaps

> Running log captured while dogfooding the AgentPlanner MCP and working through
> the codebase. Each item is a candidate for a later fix, not necessarily fixed
> here. Severity: 🔴 bug · 🟡 inconsistency · 🔵 DX/papercut.
> Started 2026-06-27 during the canonical-derivations-layer work.

## Backend — derived metrics (being fixed by plan efd0c0a2)

- 🔴 **Plan progress denominator is wrong on every server endpoint.**
  `plan.service.js` computes plan `progress` over ALL nodes (incl. `root` +
  `phase`), so a plan with all tasks done but phases `not_started` never reaches
  100% (e.g. 15/21 = 71%). Canonical denominator is `task`+`milestone` only
  (goalRollup + workspace rollup + UI agree). Sites: lines 42, 56, 308, 333, 367.
- 🟡 **`progress` and `stats.percentage` disagree within one `listPlans` row.**
  `calculatePlanProgress` (denominator = all nodes) and `computePlanStats`
  (denominator = all non-root, incl. phases) use different denominators, so the
  same plan object carries two different completion numbers.
- 🟡 **Five duplicate plan-progress formulas** in `plan.service.js`
  (`calculatePlanProgress`, `computePlanStats`, inline in `getPlanSummary`,
  `getPlanProgress`, `listPublicPlans`). No single source of truth → guaranteed
  drift on any future edit.
- 🟡 **Container (phase/root) roll-up status exists only client-side**
  (`PlanTree.helpers.ts:effectivePhaseStatus`). The server never marks a phase
  completed when all its work is done, so any non-UI consumer (MCP, exports,
  share cards) sees phases stuck at `not_started`.

## MCP / tool DX

- 🔵 **`plan_analysis` 500s on a short plan ref.** Passing `efd0c0a2` (short id)
  into `plan_analysis` failed with a raw SQL error (`WHERE plans.id = $1` against a
  UUID column) instead of resolving the short ref or returning a clean 400. Other
  tools (e.g. `list_plans`) accept/return short refs. `claim_next_task` and
  `task_context` resolve fine. Inconsistent ref handling across tools.
  → Either resolve short refs everywhere or return a friendly "use the full UUID"
  error rather than leaking the SQL.

## Backend — other

- 🔵 **`listPublicPlans` `sortBy: 'completion'` is a no-op.** The sort block does
  `alphabetical`, else (if not `'completion'`) sort by date — so passing
  `completion` silently falls through to NO sort (insertion order). Either
  implement completion sort (now trivial: `rollup.progress_pct`) or drop the
  option. `src/domains/plan/services/plan.service.js` ~line 340.
- 🔵 **New `rollup` field is undocumented in the OpenAPI Plan schema.** Plan
  list/get/progress now return `rollup`; `docs/openapi*.json` Plan schema should
  describe it so the v1 contract is complete. (Follow-up; not blocking.)

## Backend — workspace rollup (next derivations gap)

- 🔴 **Workspace HEALTH has no server rollup; it's recomputed client-side.**
  `workspaces.dal.mjs` emits `progressPct` but NOT health (its comment claims a
  "progress/health rollup" — inaccurate). So the Workspaces list rolls health up
  client-side from each workspace's goals (`Workspaces.tsx:healthByWorkspace`),
  while `WorkspaceDetail.tsx` shows literally "Workspace-level health rollup is
  server-side TBD" — list and detail can disagree on the same workspace. FIX:
  add health to the workspace rollup (same classification the goals use, rolled
  up across the workspace's active goals), expose it, and have both surfaces read
  it. This is the workspace analogue of the plan-rollup fix.
- 🟢 **Confirmed canonical (no residual recompute):** Mission Control and the
  Goals list/detail read `goal.health` + `execution_pct` from the goal dashboard
  rollup; GoalsV2 progress reads `goal._dash.linked_plan_progress` (same
  dashboard source as health, so no drift); workspace PROGRESS reads
  `w.progressPct` from the server. Segmented-bar widths are presentation ratios
  over server counts, not metric recomputes — fine.

## Frontend — minor

- 🔵 **Dead `calculatePlanProgress` in `planUtils.ts`** computed progress over ALL
  nodes (the 68-vs-100 denominator bug), zero callers. Removed during Phase 4 —
  noting so it isn't re-added. Live-compute now goes through `src/selectors`.
- 🔵 **Duplicated blueprint structure counts.** `BlueprintDetail.tsx` and
  `PublicBlueprint.tsx` each inline `nodes.filter(n => n.node_type === 'task')`
  / `'phase'` for their "N phases · M tasks" labels. Presentation-only (not a
  drifting metric) but a candidate for a shared `blueprintCounts` selector.
- 🔵 **UI tests must run via `npm test` (react-scripts), not `npx jest`.** Raw
  jest can't parse `import type` (no CRA babel preset) and fails with a confusing
  SyntaxError. Worth a one-line note in the UI CLAUDE.md/README.

<!-- Append new findings below as they surface. -->
