/**
 * v1 — Blueprints (reusable plan shapes). Aliases onto
 * routes/blueprint.routes.js handlers.
 */
const express = require('express');
const router = express.Router();
const blueprintRoutes = require('../blueprint.routes');
const { forwardTo, e, UUID } = require('./forward');

/**
 * @swagger
 * /v1/blueprints:
 *   get:
 *     summary: List blueprints (own + public)
 *     tags: [v1]
 *     security: [{ bearerAuth: [] }, { apiKey: [] }]
 *     responses:
 *       200: { description: Blueprint list }
 */
router.get('/blueprints', forwardTo(blueprintRoutes, () => '/'));

/**
 * @swagger
 * /v1/blueprints/from-plan/{planId}:
 *   post:
 *     summary: Snapshot a plan as a reusable blueprint
 *     tags: [v1]
 *     security: [{ bearerAuth: [] }, { apiKey: [] }]
 *     responses:
 *       201: { description: Blueprint created }
 */
router.post('/blueprints/from-plan/:planId', forwardTo(blueprintRoutes, (req) => `/from_plan/${e(req.params.planId)}`));

/**
 * @swagger
 * /v1/blueprints/{id}/fork:
 *   post:
 *     summary: Instantiate a blueprint into a workspace as a new plan
 *     tags: [v1]
 *     security: [{ bearerAuth: [] }, { apiKey: [] }]
 *     responses:
 *       201: { description: Plan created from blueprint }
 */
router.post(`/blueprints/:id${UUID}/fork`, forwardTo(blueprintRoutes, (req) => `/${e(req.params.id)}/fork`));

/**
 * @swagger
 * /v1/blueprints/{id}:
 *   get:
 *     summary: Get a blueprint
 *     tags: [v1]
 *     security: [{ bearerAuth: [] }, { apiKey: [] }]
 *     responses:
 *       200: { description: Blueprint }
 *   delete:
 *     summary: Delete a blueprint
 *     tags: [v1]
 *     security: [{ bearerAuth: [] }, { apiKey: [] }]
 *     responses:
 *       200: { description: Blueprint deleted }
 */
router.get(`/blueprints/:id${UUID}`, forwardTo(blueprintRoutes, (req) => `/${e(req.params.id)}`));
router.delete(`/blueprints/:id${UUID}`, forwardTo(blueprintRoutes, (req) => `/${e(req.params.id)}`));

module.exports = router;
