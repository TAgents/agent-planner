/**
 * Coherence Pending Routes — Org-level staleness query
 *
 * Returns plans and goals that have changed since their last coherence check.
 * Mounted at /coherence (not /plans) since it's org-scoped.
 */
const express = require('express');
const router = express.Router();
const { authenticate } = require('../../middleware/auth.middleware.v2');
const dal = require('../../db/dal.cjs');

/**
 * @swagger
 * /coherence/pending:
 *   get:
 *     summary: Get pending coherence checks
 *     description: Returns all plans and goals that have changed since their last coherence check. Used by agents to discover what needs attention. Staleness is determined by comparing updated_at to coherence_checked_at.
 *     tags: [Coherence]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Stale plans and goals needing coherence review
 */
router.get('/pending', authenticate, async (req, res, next) => {
  try {
    const userId = req.user.id;
    const organizationId = req.user.organizationId;

    // Get user's plans (via DAL — respects ownership + org membership + collaboration)
    const planResult = await dal.plansDal.listForUser(userId, { organizationId });
    const allPlans = [...(planResult.owned || []), ...(planResult.shared || []), ...(planResult.organization || [])];

    // Filter to stale plans: updated_at > coherence_checked_at (or never checked)
    const stalePlans = allPlans.filter(p => {
      if (p.status === 'archived' || p.status === 'completed') return false;
      if (!p.coherenceCheckedAt) return true; // Never checked
      return new Date(p.updatedAt) > new Date(p.coherenceCheckedAt);
    }).map(p => ({
      id: p.id,
      title: p.title,
      status: p.status,
      quality_score: p.qualityScore,
      updated_at: p.updatedAt,
      coherence_checked_at: p.coherenceCheckedAt,
    }));

    // Get user's goals
    const { goals: allGoals } = await dal.goalsDal.findAll(
      { organizationId, userId },
      { status: 'active' }
    );

    const staleGoals = (allGoals || []).filter(g => {
      if (!g.coherenceCheckedAt) return true;
      return new Date(g.updatedAt) > new Date(g.coherenceCheckedAt);
    }).map(g => ({
      id: g.id,
      title: g.title,
      goal_type: g.goalType,
      updated_at: g.updatedAt,
      coherence_checked_at: g.coherenceCheckedAt,
    }));

    const summary = [];
    if (stalePlans.length > 0) summary.push(`${stalePlans.length} plan${stalePlans.length > 1 ? 's' : ''}`);
    if (staleGoals.length > 0) summary.push(`${staleGoals.length} goal${staleGoals.length > 1 ? 's' : ''}`);

    res.json({
      stale_plans: stalePlans,
      stale_goals: staleGoals,
      summary: summary.length > 0
        ? `${summary.join(' and ')} need${stalePlans.length + staleGoals.length === 1 ? 's' : ''} coherence review`
        : 'Everything is up to date',
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
