# BUGS

Tracker for bugs and rough edges in agent-planner-api that aren't yet captured as plans or PRs. Add new entries to the top.

## Open

### `claimsDal.claim` throws DB error on conflict instead of returning null

- **Reported:** 2026-06-09
- **Reporter:** Surfaced while writing `tests/e2e/agent-loop-fail-closed.test.js` against local stack
- **Severity:** Medium — claim collisions become opaque 500s instead of the documented 409 `claim_collision`

**Symptom:** `POST /agent/work-sessions` returns 500 (with a `pg` insert error in logs) when the selected task already has an active claim. Expected behaviour is 409 with `code: 'claim_collision'` and the existing claim in `details.existing_claim`.

**Repro:** Claim a task once. Without releasing or completing it, call `POST /agent/work-sessions {plan_id}` again — `chooseTask`'s `resume_in_progress` rung returns the same task, `startWorkSession` calls `dal.claimsDal.claim(...)`, and the DB-level uniqueness/exclusion constraint throws.

**Root cause:** `agentLoop.service.js:306–310` contract:

```js
const claim = await dal.claimsDal.claim(taskId, taskPlanId, actorAgentId, user.id, ttl, []);
if (!claim) {
  const existing = await dal.claimsDal.getActiveClaim(taskId);
  throw new AgentLoopError('Task is already claimed', 409, 'claim_collision', { existing_claim: snakeClaim(existing) });
}
```

The service expects `claim()` to return `null` on conflict so the explicit 409 branch can run. But `src/db/dal/claims.dal.mjs:33` lets the drizzle insert error bubble unhandled, so the route's generic error handler returns 500.

**Where to look first:**
- `agent-planner/src/db/dal/claims.dal.mjs` — `claim()` function; needs to catch the unique-constraint-violation case and return null, mirroring the contract the caller already encodes
- `agent-planner/src/domains/agent/agentLoop.service.js:307` — caller expects null

**Workaround in tests:** pass `fresh: true` to skip the `resume_in_progress` rung when the same task is already claimed.

---

### `workflows.test.js` e2e auth: stale token field access

- **Reported:** 2026-06-09
- **Reporter:** Surfaced while running `tests/e2e/agent-loop-fail-closed.test.js`
- **Severity:** Low — but the test was silently unrun (`jest.config.js` excluded `tests/e2e/`) so the breakage was invisible

**Symptom:** Line 44 of `tests/e2e/workflows.test.js` reads `token = res.data.access_token || res.data.token;`. The `/auth/register` response shape moved at some point to `{user, session: {access_token, refresh_token, expires_at}}` (see `auth.controller.v2.js:86–94`), so both fallbacks are `undefined`. Every subsequent `auth()` call would 401.

**Fix:** `res.data.session?.access_token || res.data.access_token || res.data.token`. Same fix applied in `tests/e2e/agent-loop-fail-closed.test.js`.

**Note:** This bug coexisted with a config-level breakage — `jest.config.js`'s `projects` array had no `e2e` entry, so `tests/e2e/**` was never matched and the script `npm run test:workflows` silently exited with no tests found. Adding an `e2e` project to `projects` (done as part of the fail-closed test landing) makes both files discoverable; the token-shape fix to `workflows.test.js` is still needed.

---

### Resume-in-progress is not dependency-aware

- **Reported:** 2026-06-09
- **Reporter:** Surfaced while writing `tests/e2e/agent-loop-fail-closed.test.js`
- **Severity:** Low — edge case; may be intentional design
- **Status:** Open for design discussion, not yet triaged as a bug

**Observation:** The first rung of `chooseTask` (`agentLoop.service.js:229–236`) returns the first `in_progress` task in scope without consulting the dep graph. If a downstream task is `in_progress` while its upstream gets re-opened (status reverted to `not_started`), the next `POST /agent/work-sessions` will still resume the downstream — bypassing the fail-closed contract the same function enforces in its `chooseTask` selection rungs.

**Why it might be intentional:** Resume = "continue work you already started," not "select the next ready task." Once committed to a task, the agent likely shouldn't be re-routed just because someone edited the upstream state.

**Why it might be a bug:** If "all selection paths must be dep-aware" is the contract (which the `Closed` entry above asserts), this is a third path that violates it. Specifically: an agent loop calling `claim_next_task` indefinitely on a downstream task whose upstream got re-opened will keep resuming the downstream forever, never realising the dep graph changed.

**Decision needed before fix:** is resume dep-aware or not? If yes, add the same `blocked_on_dep` check to the resume rung. If no, document explicitly so future-us doesn't treat the next "fail-closed gap" as a regression.

---

### `queue_decision` MCP tool unusable — every call returns 400 "Validation failed"

- **Reported:** 2026-06-02
- **Reporter:** Claude Code session (verified against both local stack and hosted instance)
- **Severity:** Medium — feature is fully non-functional through MCP; agents silently fall back to the `add_learning` workaround the tool was meant to replace

**Repro:** Any `queue_decision` call against either environment fails — including the minimum payload the MCP tool schema permits. No `options`, no `urgency`, no `recommendation`:

```
queue_decision({
  title: "x",
  context: "x",
  plan_id: "<any valid plan id>",
  smallest_input_needed: "approve|defer"
})
→ Failed to queue decision: Validation failed
```

API log line is generic — `[API] Validation failed for request body` — with no per-field detail.

**Root cause (three independent mismatches between the MCP bridge body and the API Zod schema):**

The bridge in `agent-planner-mcp/src/tools/bdi/intentions.js` (`queueDecisionHandler`, ~L90–139) builds:

```js
const body = {
  title, context,
  options: options || [],
  recommendation: recommendation || null,   // (1) not in API schema → .strict() rejects
  urgency: urgency || 'normal',              // (2) not in API enum → rejects
  metadata: { smallest_input_needed, ... },
};
```

The API schema `createDecisionRequest` in `agent-planner/src/validation/schemas/decision.schemas.js` (~L48–57) is `.strict()` and only accepts `node_id, title, context, options, urgency, expires_at, requested_by_agent_name, metadata`, with `urgency ∈ {blocking, can_continue, informational}` and each option shaped as `{ option, pros, cons, recommendation:boolean }`.

1. **`recommendation` (top-level string)** — no such field in API; `.strict()` rejects.
2. **`urgency` enum mismatch** — MCP exposes `low|normal|high` (default `'normal'`), API expects `blocking|can_continue|informational`. No MCP value is valid against API.
3. **`options[i]` shape mismatch** — MCP `{ label, description }`, API `{ option, pros, cons, recommendation }`. Any non-empty `options` array fails. An empty array passes #3 but #1 and #2 still trigger.

Any one of the three is sufficient to cause the 400.

**Secondary bug (debuggability):** The validate middleware returns `{ error: 'Validation failed' }` with no Zod issue details. This is why the bridge's error wrapper has only the generic string to surface, and why the bug has gone unnoticed in production. Worth fixing independently.

**Workaround:** Use `add_learning` with `entry_type=decision` and a `"DECISION NEEDED:"` title prefix — the exact pre-`queue_decision` pattern the tool's own description string says it replaces.

**Proposed fix (bridge-side, single file):**

In `agent-planner-mcp/src/tools/bdi/intentions.js`:
1. Map `urgency` MCP → API: `low → informational`, `normal → can_continue`, `high → blocking`.
2. Move `recommendation` (string) into `metadata` rather than top-level.
3. Translate `options[i]` from `{label, description}` to API's `{option, pros, cons, recommendation}` shape (or revise product intent — currently `description` is promised to agents but never reaches the DB even when the call succeeds).

Also patch `agent-planner` validate middleware to surface `error.issues` on 400.

**Where to look first:**
- `agent-planner-mcp/src/tools/bdi/intentions.js` — `queueDecisionDefinition` (~L22–88) and `queueDecisionHandler` (~L90–139)
- `agent-planner/src/validation/schemas/decision.schemas.js` — `createDecisionRequest` and `decisionOption` (~L18–57)
- `agent-planner/src/controllers/decision.controller.js` — `createDecisionRequest` (~L78–122); confirms the controller silently ignores fields outside the destructured set, so the bridge could safely move `recommendation` to metadata without any controller change

---

### `quick_log` MCP tool returns 400 where `add_log` succeeds with equivalent payload

- **Reported:** 2026-04-25
- **Reporter:** Claude Code session (during ap CLI BDI integration on agent-planner-mcp branch `feat/ap-cli-v1-core-loop`)
- **Severity:** Low — workaround available

**Repro:** Call `quick_log` via MCP with a valid `plan_id`, `task_id`, `log_type: "progress"`, and a `message` string. Server responds 400.

```
quick_log({
  plan_id: "d1d3fba5-8d92-40e9-861f-f2ca4cea65be",
  task_id: "638eb366-4ea1-4534-979e-6911c24bde03",
  log_type: "progress",
  message: "..."
})
→ Error: Request failed with status code 400
```

The same data sent through `add_log` (with `node_id` instead of `task_id` and `content` instead of `message`) succeeds and creates the log entry — see entry `6e1d95eb-eda5-4082-8252-0f0e71a134d8` on the dogfood task.

**Suspected cause:** Field-name mismatch between the `quick_log` MCP wrapper and the underlying log endpoint, OR the `progress` log_type is not accepted by the route `quick_log` calls. Reproduced twice with different message lengths — content size is not the trigger.

**Workaround:** Use `add_log` directly. Same effect, same `log_type` enum.

**Where to look first:**
- `agent-planner-mcp/src/tools.js` — the `quick_log` handler and how it shapes the request
- `agent-planner/src/routes/*.routes.js` and `*.controller.v2.js` — the log endpoint validation (likely Zod schema in `validation/`)
- Compare with how `add_log` formats its payload to the same backend

---

## Closed

### `claim_next_task` silently degraded to dependency-blind task selection

- **Reported:** 2026-06-08
- **Reporter:** Feynman analysis, surfaced during a playtest of an implementing agent that kept picking tasks out of dependency order
- **Severity:** High — agents bypassed the dependency graph, picking blocked work as if it were ready
- **Closed:** 2026-06-08 — fail-closed contract enforced at both client and server layers

**Symptom:** Agents working a plan with explicit `blocks` / `requires` edges would still claim downstream tasks before their upstream tasks completed. The task tree said "research → plan → implement," but the agent would jump straight to implement.

**Root cause — two independent fallback paths, both dependency-blind:**

1. **Server side** — `agent-planner/src/domains/agent/agentLoop.service.js`, function `chooseTask`. When `suggestNextTasks` returned empty (because every remaining task was blocked on an incomplete dep), the function fell back to `dal.nodesDal.listByPlanIds({status: 'not_started'})` — a plain DAL query that doesn't know about edges. It returned the first not_started task with `source: 'my_tasks_fallback'`, which is exactly the wrong answer.

2. **Client side** — `agent-planner-mcp/src/tools/bdi/intentions.js`, `claim_next_task` legacy fallback path. Three independent issues:
   - The legacy suggest call hit `/plans/${plan_id}/suggest-next-tasks` — a URL that does not exist on the backend (real endpoint is `GET /context/suggest?plan_id=...`). The 404 was caught with `} catch {}` and silently swallowed.
   - The resume step had `if (plan_id) tasks.filter((t) => t.plan_id === plan_id);` — the filter result was never assigned, so it was a no-op. Caused cross-plan leak: a request scoped to plan A could resume an in-progress task on plan B.
   - When the (broken) suggest call swallowed its 404, the path degraded to a `my_tasks_fallback` rung — `getMyTasks` → first not_started — again dep-blind.

So the dependency engine (`suggestNextTasks`) itself was correct; both the server and client wrappers around it had escape hatches that bypassed it on any failure.

**Fix:**

- **Server (`agentLoop.service.js`):** removed the dep-blind fallback. `chooseTask` now distinguishes two failure modes and throws an `AgentLoopError(404, 'not_found')` with `details.reason` of either `'blocked_on_dep'` (not_started tasks exist but all dep-blocked) or `'no_work_in_scope'` (no actionable tasks at all). The `reason` surfaces in the controller response via the existing `error.details` spread.
- **Client (`intentions.js`):**
  - Fixed the unassigned `.filter` in the resume step (`tasks = tasks.filter(...)`).
  - Changed the legacy suggest URL from `/plans/:id/suggest-next-tasks` to the real `/context/suggest?plan_id=...&limit=1`.
  - Removed the `my_tasks_fallback` rung entirely. The handler now returns `errorResponse('not_found', 'No dependency-ready task in scope')` when neither the primary `/agent/work-sessions` facade nor the dep-aware suggest returns a candidate.

**Tests:**

The fail-closed contract is now enforced by two suites that were written-but-skipped during the diagnosis and flipped live as part of the fix:

- `agent-planner/tests/unit/services/agentLoop.failClosed.test.js` — asserts `chooseTask` rejects with `code: 'not_found'` and a message matching `/blocked|dep/i` when every remaining task is dep-blocked.
- `agent-planner-mcp/__tests__/bdi-intentions-claim-scope.test.js` — asserts no cross-plan leak in the resume step, and no silent dep-blind fallback when both `/agent/work-sessions` and `/context/suggest` are unavailable.

Existing `contextEngine.suggestNextTasks.test.js` already covered the engine itself (blocks/requires/RPI ordering, active-claim exclusion).

**Where to look first if it regresses:**
- `agent-planner/src/domains/agent/agentLoop.service.js` — `chooseTask`; ensure no new dep-blind rung gets reintroduced.
- `agent-planner-mcp/src/tools/bdi/intentions.js` — `claimNextTaskHandler`; legacy fallback must use `/context/suggest` and must not fall back to `getMyTasks` on failure.

---
