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

<!-- Append new findings below as they surface. -->
