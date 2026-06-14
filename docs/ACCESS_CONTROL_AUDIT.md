# Access-Control Audit (2026-06)

Commercial gate #1 from the architecture review: *"one pass making access checks
mandatory, with a test that fails on unprotected routes."* This documents the
audit of every mounted HTTP route's authorization, the gaps found and fixed, and
the guardrail added.

## Model

- **`authenticate`** (`middleware/auth.middleware.js`) proves **identity** — sets
  `req.user` (id, organizationId, organizations[]). Not resource access.
- **`checkPlanAccess(planId, userId, roles)`** / **`requirePlanAccess(roles)`**
  (`middleware/planAccess.middleware.js`) prove access to a specific **plan**.
- **`requireGoalAccess(req, res)`** (`routes/v2/goals.routes.js`, re-exported via
  the goal domain barrel) — org members for org goals, owner for personal goals.
- **Org scoping** — workspace/blueprint/org routes verify membership via
  `organizationsDal.getMembership`.
- **Graphiti group_id scoping** — knowledge reads derive `group_id` from
  `req.user`'s org (`graphitiBridge.getGroupId`), so a caller can only ever query
  their own org's graph. This is the isolation mechanism for search/entities/
  contradictions/coverage; episode mutations additionally use `checkPlanAccess`.

## Finding: protection is real but enforced at two layers

Every authenticated route enforces resource access, but **inconsistently**:

- **Org / workspace / blueprint / goal routes** check access **explicitly** in the
  route handler (`requireGoalAccess`, `getMembership`, `userOwnsOrCanRead`).
- **`/plans/:id/**` routes** (node CRUD, logs, claims, decisions, dependencies,
  context, reasoning, activity, collaboration) check access **implicitly** — the
  handler delegates to a service/controller that calls `checkPlanAccess` /
  `plansDal.userHasAccess` with the right per-operation roles (reads: any access;
  writes: owner/admin/editor). Verified present in: `node.service.js`,
  `decision.controller.js`, `claims.controller.v2.js`, `dependency.controller.v2.js`,
  `context.routes.js`, `node-views.routes.js`, `reasoning.routes.js`,
  `cross-plan-deps.routes.js`.

The implicit pattern is consistent and correct today, but its safety depends on
every service remembering the check. That residual risk is accepted for now (a
60-route explicit-middleware rewrite would be high-churn and would duplicate the
services' role-aware checks); the guardrail test below narrows the blast radius.

## Gaps found and FIXED

1. **`POST /goals/:id/links`** — had no `requireGoalAccess`. Any authenticated
   user could link any plan/task to any goal and trigger the `achieves` cascade.
   **Fixed:** `requireGoalAccess` added.
2. **`DELETE /goals/:id/links/:linkId`** — no access check at all, and
   `removeLink(linkId)` ignored `:id`, so any authenticated user could delete any
   goal's link by id (IDOR). **Fixed:** `requireGoalAccess` + the link must belong
   to the goal in the path.

Both fixed in `routes/v2/goals.routes.js` with regression tests in
`goals.routes.test.js` (403 for non-owner, 404 for foreign link, happy path).

## Reviewed and OK (no change)

- All `/plans/:id/**` families — implicit checks verified present.
- `/organizations`, `/workspaces`, `/blueprints` — explicit membership/ownership.
- `/knowledge/**` — group_id org-scoping + checkPlanAccess on mutations.
- `/dashboard`, `/activity`, `/search`, `/stats` — scoped to the caller's
  accessible plans (or aggregate-only for `/stats`).
- Public by design: `/auth/{register,login,refresh,oauth,*/callback}`,
  `/plans/public/**`, `/blueprints/public/**`, `/invites/info/:token`, `/stats`,
  `/health`.

## Guardrail

`tests/integration/route-auth-coverage.test.js` boots the full app router, walks
`app._router.stack`, and asserts every registered route either applies
`authenticate` or is in the explicit PUBLIC allowlist. A new route with no auth
and not on the allowlist fails CI — implementing the review's "test that fails on
unprotected routes." It catches the highest-severity regression (a route with no
identity check at all); resource-level checks remain covered by per-family
runtime tests (`routes-safety-net.test.js`, `v1-routes.test.js`,
`goals.routes.test.js`).

## Deferred follow-up

- Promote the implicit `/plans/:id/**` checks to explicit `requirePlanAccess`
  router-level middleware for defense-in-depth (large, low-urgency; tracked here).
