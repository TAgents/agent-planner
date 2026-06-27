# Derived-metrics audit & canonical definitions

> Output of Phase 1 of the "Canonical derivations layer" plan
> (`efd0c0a2-a1e4-41e8-a645-c43e089039c7`). This is the reference table the rest
> of the plan consumes. Every derived metric below has exactly ONE canonical
> definition; all surfaces must read it, never recompute.

## The core disease

Derived metrics are computed in multiple places that drift. Symptom this session:
the same plan reads **68%** on the Plans index and **100%** in the plan tree.

Root cause: **denominator disagreement**. Three different denominators are in use:

| # | Denominator | Where |
|---|---|---|
| A | ALL nodes (incl. `root` + `phase`) | `plan.service.js` server formulas |
| B | all non-`root` (incl. `phase`) | `computePlanStats` (`stats.percentage`) |
| **C** | **`task` + `milestone` only** ✅ CANONICAL | goalRollup, workspace rollup, UI `computeStats` |

A plan with every task done but phases still `not_started` reads `15/21 = 71%`
under (A) and `100%` under (C). The Plans index shows the server `progress` field
(A); the plan tree computes (C) client-side. Hence 68 vs 100.

## Canonical definitions (LOCK THESE)

### Plan-level (entity: plan)
- **work nodes** = `node_type IN ('task','milestone')`. Root + phases are
  structure, never counted in progress.
- **progress_pct** = `round(completed_work / total_work * 100)`, `0` when no work.
- **status counts** = per-status counts over work nodes: `done`, `doing`
  (`in_progress`), `blocked`, `plan_ready`, `todo` (everything else).
- **phase/root effective status** = `completed` iff it has ≥1 work descendant and
  ALL are completed (currently only the UI computes this; belongs in the rollup).
- **blocked_pct** = `round(blocked_work / total_work * 100)`.
- **critical_path summary** = longest `blocks` chain through incomplete work
  (`reasoning.getCriticalPath`).

### Goal-level (entity: goal) — ALREADY canonical
- Source: `goalsDal.getDashboardData()` (counts `task`+`milestone` ✅) →
  `goalRollup.service.js`. Fields: `health`, `execution_pct`, `percent_blocked`,
  `attainment_pct`, `linked_plan_count` (distinct non-archived plans),
  `pending_decision_count`, `bottleneck_summary`. Health decided by
  `utils/goalHealth.js`.

### Workspace-level (entity: workspace) — PROGRESS canonical, HEALTH still client-side
- Source: `workspaces.dal.mjs` `listForUser` (counts `task`+`milestone` ✅).
  Fields: `total_nodes`, `completed_nodes`, `progress_pct`.
- ⚠️ **Health is NOT yet a server field.** The Workspaces list recomputes it
  client-side from goals; WorkspaceDetail has none ("server-side TBD"). This is
  the next gap to close (see META_DX_FINDINGS.md) — add workspace health to the
  rollup so list and detail agree.

## Current plan-progress computation sites (ALL must converge on §Plan-level)

| Location | Formula today | Denominator | Verdict |
|---|---|---|---|
| `plan.service.js:42` `calculatePlanProgress` | `completed / nodes.length` | A (all) | ❌ wrong — feeds `progress` on list + get |
| `plan.service.js:56` `computePlanStats` | `done / (non-root)` | B | ❌ wrong — feeds `stats.percentage` on list |
| `plan.service.js:308` `getPlanSummary` | `completed / nodes.length` inline | A | ❌ wrong + duplicate |
| `plan.service.js:333` `getPlanProgress` | `completed / total` | A | ❌ wrong |
| `plan.service.js:367` `listPublicPlans` | `completed / task_count` inline | A | ❌ wrong |
| UI `PlanTree.helpers.ts` `computeStats` | task+milestone only | C | ✅ correct, but client-side |
| UI `PlanTree.helpers.ts` `effectivePhaseStatus` | container roll-up | — | ✅ correct, but client-side; move to server |

**Note:** within a single `listPlans` row, `progress` (A) and `stats.percentage`
(B) can already disagree with each other — independent of the UI.

## Plan: build `planRollup.service.js`

One function `computePlanRollup(planId)` (and a batch variant for the list) that
returns `{ progress_pct, total_work, completed_work, status_counts: {...},
blocked_pct, critical_path, container_status: {nodeId->status} }`. Every plan
endpoint returns it as `rollup`. The five formulas above collapse into one call.
UI `computeStats`/`effectivePhaseStatus` become thin selectors (or are deleted in
favor of reading `plan.rollup`).
