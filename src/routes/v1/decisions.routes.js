/**
 * v1 — Decisions (human-in-the-loop queue). The pending queue aliases the
 * dashboard pending bundle; resolve/cancel are decision-scoped (the owning
 * plan is resolved server-side).
 */
const express = require('express');
const router = express.Router();
const { authenticate } = require('../../middleware/auth.middleware');
const domains = require('../../domains');
const dashboardRoutes = require('../dashboard.routes');
const dal = require('../../db/dal.cjs');
const { forwardTo, e } = require('./forward');

const decisionRoutes = domains.decision.routes.decisionRoutes;

/**
 * Resolve the owning plan for /v1/decisions/:id/* routes.
 *
 * The explicit `authenticate` before this resolver is intentional (despite
 * the forwarded route authenticating again): the resolver hits the DB and
 * its 404 would otherwise leak decision existence to unauthenticated callers.
 */
const resolvePlanFromDecision = async (req, res, next) => {
  try {
    const decision = await dal.decisionsDal.findById(req.params.id);
    if (!decision) return res.status(404).json({ error: 'Decision not found', code: 'not_found' });
    req.resolvedPlanId = decision.planId;
    next();
  } catch (err) {
    next(err);
  }
};

/**
 * @swagger
 * /v1/decisions:
 *   get:
 *     summary: Pending items needing human review across accessible plans
 *     tags: [v1]
 *     security: [{ bearerAuth: [] }, { apiKey: [] }]
 *     responses:
 *       200: { description: Pending decisions, agent requests, and drafts }
 */
router.get('/decisions', forwardTo(dashboardRoutes, () => '/pending'));

/**
 * @swagger
 * /v1/decisions/{id}/resolve:
 *   post:
 *     summary: Resolve a decision (approve/defer/reject, materialize subtasks)
 *     tags: [v1]
 *     security: [{ bearerAuth: [] }, { apiKey: [] }]
 *     responses:
 *       200: { description: Decision resolved }
 *       404: { description: Decision not found }
 */
router.post(
  '/decisions/:id/resolve',
  authenticate,
  resolvePlanFromDecision,
  forwardTo(decisionRoutes, (req) => `/${e(req.resolvedPlanId)}/decisions/${e(req.params.id)}/resolve`)
);

/**
 * @swagger
 * /v1/decisions/{id}/cancel:
 *   post:
 *     summary: Cancel a pending decision
 *     tags: [v1]
 *     security: [{ bearerAuth: [] }, { apiKey: [] }]
 *     responses:
 *       200: { description: Decision cancelled }
 *       404: { description: Decision not found }
 */
router.post(
  '/decisions/:id/cancel',
  authenticate,
  resolvePlanFromDecision,
  forwardTo(decisionRoutes, (req) => `/${e(req.resolvedPlanId)}/decisions/${e(req.params.id)}/cancel`)
);

module.exports = router;
