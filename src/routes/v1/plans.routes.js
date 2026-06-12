/**
 * v1 — Plans & nodes. Aliases onto plan/node/dependency/decision routes,
 * plus two composed facades:
 *   - GET  /v1/plans/:id/analysis (mirrors the MCP `plan_analysis` tool)
 *   - POST /v1/plans/:id/share    (mirrors the MCP `share_plan` tool)
 */
const express = require('express');
const router = express.Router();
const { authenticate } = require('../../middleware/auth.middleware');
const domains = require('../../domains');
const v1Facades = require('../../services/v1Facades');
const { forwardTo, sendFacadeError, e, UUID } = require('./forward');

const planRoutes = domains.plan.routes.planRoutes;
const nodeRoutes = domains.node.routes.nodeRoutes;
const dependencyRoutes = domains.dependency.routes.dependencyRoutes;
const decisionRoutes = domains.decision.routes.decisionRoutes;

/**
 * @swagger
 * /v1/plans:
 *   get:
 *     summary: List plans accessible to the authenticated user
 *     tags: [v1]
 *     security: [{ bearerAuth: [] }, { apiKey: [] }]
 *     responses:
 *       200: { description: Plan list }
 *   post:
 *     summary: Create a plan
 *     tags: [v1]
 *     security: [{ bearerAuth: [] }, { apiKey: [] }]
 *     responses:
 *       201: { description: Plan created }
 */
router.get('/plans', forwardTo(planRoutes, () => '/'));
router.post('/plans', forwardTo(planRoutes, () => '/'));

/**
 * @swagger
 * /v1/plans/{id}:
 *   get:
 *     summary: Get a plan
 *     tags: [v1]
 *     security: [{ bearerAuth: [] }, { apiKey: [] }]
 *     responses:
 *       200: { description: Plan }
 *   patch:
 *     summary: Update a plan
 *     tags: [v1]
 *     security: [{ bearerAuth: [] }, { apiKey: [] }]
 *     responses:
 *       200: { description: Updated plan }
 *   delete:
 *     summary: Delete a plan
 *     tags: [v1]
 *     security: [{ bearerAuth: [] }, { apiKey: [] }]
 *     responses:
 *       200: { description: Plan deleted }
 */
router.get(`/plans/:id${UUID}`, forwardTo(planRoutes, (req) => `/${e(req.params.id)}`));
router.patch(`/plans/:id${UUID}`, forwardTo(planRoutes, (req) => `/${e(req.params.id)}`, { method: 'PUT' }));
router.delete(`/plans/:id${UUID}`, forwardTo(planRoutes, (req) => `/${e(req.params.id)}`));

/**
 * @swagger
 * /v1/plans/{id}/fork:
 *   post:
 *     summary: Fork a plan
 *     tags: [v1]
 *     security: [{ bearerAuth: [] }, { apiKey: [] }]
 *     responses:
 *       201: { description: Forked plan }
 */
router.post(`/plans/:id${UUID}/fork`, forwardTo(planRoutes, (req) => `/${e(req.params.id)}/fork`));

/**
 * @swagger
 * /v1/plans/{id}/analysis:
 *   get:
 *     summary: Bundled plan analysis — critical path, bottlenecks, RPI chains, coherence issues
 *     description: Composed facade mirroring the MCP `plan_analysis` tool. Partial backend failures are surfaced in meta.failures.
 *     tags: [v1]
 *     security: [{ bearerAuth: [] }, { apiKey: [] }]
 *     responses:
 *       200: { description: Composed plan analysis }
 *       403: { description: No access to this plan }
 */
router.get(`/plans/:id${UUID}/analysis`, authenticate, async (req, res) => {
  try {
    res.json(await v1Facades.planAnalysis(req.params.id, req.user));
  } catch (err) {
    sendFacadeError(res, err);
  }
});

/**
 * @swagger
 * /v1/plans/{id}/share:
 *   post:
 *     summary: Atomically change visibility and add/remove collaborators
 *     description: Composed facade mirroring the MCP `share_plan` tool. Steps apply independently; per-step results are reported in applied_changes/failures.
 *     tags: [v1]
 *     security: [{ bearerAuth: [] }, { apiKey: [] }]
 *     responses:
 *       200: { description: Applied changes and per-step failures }
 */
router.post(`/plans/:id${UUID}/share`, authenticate, async (req, res) => {
  try {
    res.json(await v1Facades.sharePlan(req.user, req.params.id, req.body || {}));
  } catch (err) {
    sendFacadeError(res, err);
  }
});

/**
 * @swagger
 * /v1/plans/{id}/collaborators:
 *   get:
 *     summary: List plan collaborators
 *     tags: [v1]
 *     security: [{ bearerAuth: [] }, { apiKey: [] }]
 *     responses:
 *       200: { description: Collaborator list }
 */
router.get(`/plans/:id${UUID}/collaborators`, forwardTo(planRoutes, (req) => `/${e(req.params.id)}/collaborators`));

/**
 * @swagger
 * /v1/plans/{id}/decisions:
 *   post:
 *     summary: Queue a decision for human review
 *     tags: [v1]
 *     security: [{ bearerAuth: [] }, { apiKey: [] }]
 *     responses:
 *       201: { description: Decision queued }
 */
router.post(`/plans/:id${UUID}/decisions`, forwardTo(decisionRoutes, (req) => `/${e(req.params.id)}/decisions`));

/**
 * @swagger
 * /v1/plans/{id}/nodes:
 *   get:
 *     summary: List plan nodes (tree)
 *     tags: [v1]
 *     security: [{ bearerAuth: [] }, { apiKey: [] }]
 *     responses:
 *       200: { description: Node tree }
 *   post:
 *     summary: Create a node
 *     tags: [v1]
 *     security: [{ bearerAuth: [] }, { apiKey: [] }]
 *     responses:
 *       201: { description: Node created }
 */
router.get(`/plans/:id${UUID}/nodes`, forwardTo(nodeRoutes, (req) => `/${e(req.params.id)}/nodes`));
router.post(`/plans/:id${UUID}/nodes`, forwardTo(nodeRoutes, (req) => `/${e(req.params.id)}/nodes`));

/**
 * @swagger
 * /v1/plans/{id}/nodes/{nodeId}:
 *   get:
 *     summary: Get a node
 *     tags: [v1]
 *     security: [{ bearerAuth: [] }, { apiKey: [] }]
 *     responses:
 *       200: { description: Node }
 *   patch:
 *     summary: Update a node
 *     tags: [v1]
 *     security: [{ bearerAuth: [] }, { apiKey: [] }]
 *     responses:
 *       200: { description: Updated node }
 *   delete:
 *     summary: Delete a node
 *     tags: [v1]
 *     security: [{ bearerAuth: [] }, { apiKey: [] }]
 *     responses:
 *       200: { description: Node deleted }
 */
router.get(`/plans/:id${UUID}/nodes/:nodeId${UUID}`, forwardTo(nodeRoutes, (req) => `/${e(req.params.id)}/nodes/${e(req.params.nodeId)}`));
router.patch(`/plans/:id${UUID}/nodes/:nodeId${UUID}`, forwardTo(nodeRoutes, (req) => `/${e(req.params.id)}/nodes/${e(req.params.nodeId)}`, { method: 'PUT' }));
router.delete(`/plans/:id${UUID}/nodes/:nodeId${UUID}`, forwardTo(nodeRoutes, (req) => `/${e(req.params.id)}/nodes/${e(req.params.nodeId)}`));

/**
 * @swagger
 * /v1/plans/{id}/nodes/{nodeId}/move:
 *   post:
 *     summary: Move a node (new parent and/or order)
 *     tags: [v1]
 *     security: [{ bearerAuth: [] }, { apiKey: [] }]
 *     responses:
 *       200: { description: Node moved }
 */
router.post(`/plans/:id${UUID}/nodes/:nodeId${UUID}/move`, forwardTo(nodeRoutes, (req) => `/${e(req.params.id)}/nodes/${e(req.params.nodeId)}/move`));

/**
 * @swagger
 * /v1/plans/{id}/nodes/{nodeId}/dependencies:
 *   get:
 *     summary: List a node's dependencies (upstream + downstream)
 *     tags: [v1]
 *     security: [{ bearerAuth: [] }, { apiKey: [] }]
 *     responses:
 *       200: { description: Dependency edges for the node }
 */
router.get(
  `/plans/:id${UUID}/nodes/:nodeId${UUID}/dependencies`,
  forwardTo(dependencyRoutes, (req) => `/${e(req.params.id)}/nodes/${e(req.params.nodeId)}/dependencies`)
);

module.exports = router;
