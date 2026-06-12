/**
 * /v1 — the public, versioned API surface (~70 routes).
 *
 * Everything here is an alias or a thin facade over the internal routes;
 * no business logic lives in this directory. The internal (unversioned)
 * routes remain mounted for the UI and are free to change; /v1 is the
 * contract we commit to. See docs/API_V1_CONSOLIDATION_PLAN.md and
 * docs/API_SURFACE.md for the design and the endpoint classification.
 *
 * Route groups:
 *   auth          — register/login/refresh, /me profile + API tokens
 *   orgs          — organizations, members, workspaces
 *   goals         — CRUD, promote, dashboard, composed goal state
 *   plans         — plans + nodes CRUD, fork, move, analysis, share
 *   work          — briefing, claim-next, task context/update/claim
 *   decisions     — pending queue, resolve, cancel
 *   dependencies  — create/remove edges, node dependency reads
 *   knowledge     — episodes, status, composed knowledge search
 *   blueprints    — list/get/delete, from-plan snapshot, fork
 *   misc          — global search, invite acceptance
 */
const express = require('express');
const router = express.Router();

router.use(require('./auth.routes'));
router.use(require('./orgs.routes'));
router.use(require('./goals.routes'));
router.use(require('./plans.routes'));
router.use(require('./work.routes'));
router.use(require('./decisions.routes'));
router.use(require('./dependencies.routes'));
router.use(require('./knowledge.routes'));
router.use(require('./blueprints.routes'));
router.use(require('./misc.routes'));

module.exports = router;
