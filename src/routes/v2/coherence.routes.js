/**
 * Coherence Routes — BDI Belief-Intention Coherence (Phase 2)
 *
 * Plan-scoped endpoints for querying coherence issues.
 * Uses mergeParams to access :id (planId) from parent router.
 */
const express = require('express');
const router = express.Router({ mergeParams: true });
const { authenticate } = require('../../middleware/auth.middleware.v2');
const dal = require('../../db/dal.cjs');
const { evaluatePlanQuality } = require('../../services/planQualityEvaluator');

const checkPlanAccess = async (planId, userId) => {
  const { hasAccess } = await dal.plansDal.userHasAccess(planId, userId);
  return hasAccess;
};

/**
 * @swagger
 * /plans/{id}/coherence:
 *   get:
 *     summary: Get coherence issues for a plan
 *     description: Returns all tasks in the plan that have stale or contradicted beliefs, with the episodes that triggered each flag. Part of the BDI Architecture coherence engine.
 *     tags: [Plans]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: The plan ID
 *     responses:
 *       200:
 *         description: Coherence issues for the plan
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 issues:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       node_id:
 *                         type: string
 *                         format: uuid
 *                       title:
 *                         type: string
 *                       status:
 *                         type: string
 *                       node_type:
 *                         type: string
 *                       coherence_status:
 *                         type: string
 *                         enum: [stale_beliefs, contradiction_detected]
 *                       triggering_episodes:
 *                         type: array
 *                         items:
 *                           type: object
 *                           properties:
 *                             episode_id:
 *                               type: string
 *                             link_type:
 *                               type: string
 *                             linked_at:
 *                               type: string
 *                               format: date-time
 *                 count:
 *                   type: integer
 *                 plan_id:
 *                   type: string
 *                   format: uuid
 *       403:
 *         description: Access denied
 */
router.get('/:id/coherence', authenticate, async (req, res, next) => {
  try {
    const { id: planId } = req.params;
    const userId = req.user.id;

    if (!(await checkPlanAccess(planId, userId))) {
      return res.status(403).json({ error: 'You do not have access to this plan' });
    }

    // Get all nodes with non-coherent status
    const flaggedNodes = await dal.nodesDal.listByPlan(planId, {
      coherenceStatus: 'stale_beliefs,contradiction_detected',
    });

    // For each flagged node, get the triggering episodes
    const issues = await Promise.all(
      flaggedNodes.map(async (node) => {
        const links = await dal.episodeLinksDal.listByNode(node.id);
        return {
          node_id: node.id,
          title: node.title,
          status: node.status,
          node_type: node.nodeType,
          coherence_status: node.coherenceStatus,
          triggering_episodes: links.map(l => ({
            episode_id: l.episodeId,
            link_type: l.linkType,
            linked_at: l.createdAt,
          })),
        };
      })
    );

    res.json({ issues, count: issues.length, plan_id: planId });
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /plans/{id}/coherence/check:
 *   post:
 *     summary: Run a coherence check on a plan
 *     description: Evaluates plan quality using heuristics (coverage, specificity, ordering, completeness), updates the quality score, and stamps coherence_checked_at. One-shot assessment — not a running loop.
 *     tags: [Plans]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               goal_id:
 *                 type: string
 *                 format: uuid
 *                 description: Optional goal to evaluate coverage against
 *     responses:
 *       200:
 *         description: Quality assessment with sub-score breakdown
 */
router.post('/:id/coherence/check', authenticate, async (req, res, next) => {
  try {
    const { id: planId } = req.params;
    const userId = req.user.id;
    const { goal_id } = req.body || {};

    if (!(await checkPlanAccess(planId, userId))) {
      return res.status(403).json({ error: 'You do not have access to this plan' });
    }

    // Run heuristic quality evaluation
    const quality = await evaluatePlanQuality(planId, goal_id || null, {
      orgId: req.user.organizationId,
      userId: req.user.id,
    });

    // Stamp coherence_checked_at
    await dal.plansDal.update(planId, { coherenceCheckedAt: new Date() });

    // Get coherence issues count
    const flaggedNodes = await dal.nodesDal.listByPlan(planId, {
      coherenceStatus: 'stale_beliefs,contradiction_detected',
    });

    res.json({
      plan_id: planId,
      quality,
      coherence_issues_count: flaggedNodes.length,
      checked_at: new Date().toISOString(),
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
