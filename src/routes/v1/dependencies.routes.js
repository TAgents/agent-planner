/**
 * v1 — Dependencies. Creation goes through the cross-plan handler (which
 * handles intra-plan edges too — both nodes are access-checked); deletion
 * resolves the owning plan from the edge's source node.
 */
const express = require('express');
const router = express.Router();
const { checkPlanAccess } = require('../../middleware/planAccess.middleware');
const domains = require('../../domains');
const dal = require('../../db/dal.cjs');
const { forwardTo, e } = require('./forward');

const dependencyRoutes = domains.dependency.routes.dependencyRoutes;
const crossPlanDepsRoutes = domains.dependency.routes.crossPlanDepsRoutes;

/**
 * @swagger
 * /v1/dependencies:
 *   post:
 *     summary: Create a dependency edge between two nodes (intra- or cross-plan)
 *     tags: [v1]
 *     security: [{ bearerAuth: [] }, { apiKey: [] }]
 *     responses:
 *       201: { description: Dependency created }
 *       409: { description: Edge would create a cycle }
 */
router.post('/dependencies', forwardTo(crossPlanDepsRoutes, () => '/cross-plan'));

/**
 * @swagger
 * /v1/dependencies/{id}:
 *   delete:
 *     summary: Remove a dependency edge
 *     tags: [v1]
 *     security: [{ bearerAuth: [] }, { apiKey: [] }]
 *     responses:
 *       200: { description: Dependency removed }
 *       404: { description: Dependency not found }
 */
router.delete(
  '/dependencies/:id',
  async (req, res, next) => {
    try {
      const dep = await dal.dependenciesDal.findById(req.params.id);
      if (!dep) return res.status(404).json({ error: 'Dependency not found', code: 'not_found' });
      const sourceNode = await dal.nodesDal.findById(dep.sourceNodeId);
      // No access is reported as 404 too, so callers can't distinguish
      // "doesn't exist" from "exists but not yours" (existence oracle).
      if (!sourceNode || !(await checkPlanAccess(sourceNode.planId, req.user.id))) {
        return res.status(404).json({ error: 'Dependency not found', code: 'not_found' });
      }
      req.resolvedPlanId = sourceNode.planId;
      next();
    } catch (err) {
      next(err);
    }
  },
  forwardTo(dependencyRoutes, (req) => `/${e(req.resolvedPlanId)}/dependencies/${e(req.params.id)}`)
);

module.exports = router;
