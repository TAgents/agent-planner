/**
 * v1 — Work loop, the agent-first heart. Aliases onto the agent-loop
 * facade (domains/agent), the progressive context engine, and the claims
 * endpoints, plus the atomic POST /v1/tasks/:nodeId/update facade
 * (mirrors the MCP `update_task` tool).
 *
 * /v1/tasks/* routes are node-scoped: the owning plan is resolved
 * server-side so agents don't need to carry plan ids around.
 */
const express = require('express');
const router = express.Router();
const { authenticate } = require('../../middleware/auth.middleware');
const { checkPlanAccess } = require('../../middleware/planAccess.middleware');
const domains = require('../../domains');
const contextRoutes = require('../context.routes');
const dal = require('../../db/dal.cjs');
const v1Facades = require('../../services/v1Facades');
const { forwardTo, sendFacadeError, e, UUID } = require('./forward');

const agentLoopRoutes = domains.agent.routes.agentLoopRoutes;
const nodeRoutes = domains.node.routes.nodeRoutes;

/**
 * Resolve the owning plan for /v1/tasks/:nodeId/* routes.
 *
 * Routes using this resolver carry an explicit `authenticate` BEFORE it even
 * though the forwarded internal route authenticates again — the resolver hits
 * the DB and its 404 would otherwise leak task existence to unauthenticated
 * callers. The double token verification is accepted overhead.
 */
const resolvePlanFromNode = async (req, res, next) => {
  try {
    const node = await dal.nodesDal.findById(req.params.nodeId);
    // No access is reported as 404 too, so callers can't distinguish
    // "doesn't exist" from "exists but not yours" (existence oracle).
    if (!node || !(await checkPlanAccess(node.planId, req.user.id))) {
      return res.status(404).json({ error: 'Task not found', code: 'not_found' });
    }
    req.resolvedPlanId = node.planId;
    next();
  } catch (err) {
    next(err);
  }
};

/**
 * @swagger
 * /v1/briefing:
 *   get:
 *     summary: Bundled mission-control state — goal health, pending decisions, active claims, recent activity, top recommendation
 *     tags: [v1]
 *     security: [{ bearerAuth: [] }, { apiKey: [] }]
 *     responses:
 *       200: { description: Agent briefing }
 */
router.get('/briefing', forwardTo(agentLoopRoutes, () => '/briefing'));

/**
 * @swagger
 * /v1/tasks/claim-next:
 *   post:
 *     summary: Pick the next task in scope, claim it, and return its context in one call
 *     description: Alias of the agent-loop work-session start. Accepts plan_id/goal_id scope, ttl_minutes, depth, dry_run, fresh.
 *     tags: [v1]
 *     security: [{ bearerAuth: [] }, { apiKey: [] }]
 *     responses:
 *       201: { description: "Work session started (session_id, task, claim, context)" }
 *       409: { description: Task is already claimed }
 */
router.post('/tasks/claim-next', forwardTo(agentLoopRoutes, () => '/work-sessions'));

/**
 * @swagger
 * /v1/tasks/{nodeId}/context:
 *   get:
 *     summary: Progressive task context (depth 1-4, token-budgeted)
 *     tags: [v1]
 *     security: [{ bearerAuth: [] }, { apiKey: [] }]
 *     parameters:
 *       - in: query
 *         name: depth
 *         schema: { type: integer, minimum: 1, maximum: 4 }
 *       - in: query
 *         name: token_budget
 *         schema: { type: integer }
 *     responses:
 *       200: { description: Assembled context }
 */
router.get(
  `/tasks/:nodeId${UUID}/context`,
  forwardTo(contextRoutes, (req) => `/progressive?node_id=${e(req.params.nodeId)}`)
);

/**
 * @swagger
 * /v1/tasks/{nodeId}/update:
 *   post:
 *     summary: Atomic task state transition — status + log + claim release + learning in one call
 *     description: Composed facade mirroring the MCP `update_task` tool. Steps apply independently; per-step results are reported in applied/failures. Claim release defaults to automatic when status is completed or blocked.
 *     tags: [v1]
 *     security: [{ bearerAuth: [] }, { apiKey: [] }]
 *     responses:
 *       200: { description: Applied steps and per-step failures }
 *       404: { description: Task not found }
 */
router.post(`/tasks/:nodeId${UUID}/update`, authenticate, async (req, res) => {
  try {
    res.json(await v1Facades.updateTask(req.user, req.params.nodeId, req.body || {}));
  } catch (err) {
    sendFacadeError(res, err);
  }
});

/**
 * @swagger
 * /v1/tasks/{nodeId}/claim:
 *   post:
 *     summary: Explicitly claim a task (lease-based lock)
 *     tags: [v1]
 *     security: [{ bearerAuth: [] }, { apiKey: [] }]
 *     responses:
 *       201: { description: Claim created }
 *       409: { description: Task is already claimed }
 *   delete:
 *     summary: Release a task claim
 *     tags: [v1]
 *     security: [{ bearerAuth: [] }, { apiKey: [] }]
 *     responses:
 *       200: { description: Claim released }
 */
router.post(
  `/tasks/:nodeId${UUID}/claim`,
  authenticate,
  resolvePlanFromNode,
  forwardTo(nodeRoutes, (req) => `/${e(req.resolvedPlanId)}/nodes/${e(req.params.nodeId)}/claim`)
);
router.delete(
  `/tasks/:nodeId${UUID}/claim`,
  authenticate,
  resolvePlanFromNode,
  forwardTo(nodeRoutes, (req) => `/${e(req.resolvedPlanId)}/nodes/${e(req.params.nodeId)}/claim`)
);

module.exports = router;
