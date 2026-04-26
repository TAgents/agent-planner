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

/**
 * @swagger
 * /coherence/summary:
 *   get:
 *     summary: Workspace-wide BDI coherence score (Phase 4 starter formula)
 *     description: |
 *       Composes a 0..1 coherence score from already-available signals
 *       so the BDI Coherence Dial can wire up before a more rigorous
 *       definition lands. The response always includes the raw signal
 *       counts so a future spec session can re-tune weights without
 *       changing the API contract.
 *
 *       Starter formula (subject to change in future iterations):
 *         start = 1.0
 *         minus 0.10 per pending decision   (capped at -0.30)
 *         minus 0.05 per stale plan         (capped at -0.30)
 *         minus 0.50 × blocked-task ratio
 *         minus 0.30 × unlinked-task ratio  (proxy: stale_plans / total_plans)
 *       clamped to [0, 1].
 */
router.get('/summary', authenticate, async (req, res, next) => {
  try {
    const userId = req.user.id;
    const organizationId = req.user.organizationId;

    const { plansDal, nodesDal, decisionsDal } = dal;
    const planResult = await plansDal.listForUser(userId, { organizationId });
    const allPlans = [
      ...(planResult.owned || []),
      ...(planResult.shared || []),
      ...(planResult.organization || []),
    ];
    const activePlans = allPlans.filter(
      (p) => p.status === 'active' || p.status === 'draft',
    );

    // Pending decisions across all accessible plans
    let pendingDecisions = 0;
    for (const p of activePlans) {
      try { pendingDecisions += await decisionsDal.countPending(p.id); } catch {}
    }

    // Stale plans (have updated since last coherence check)
    const stalePlans = activePlans.filter((p) => {
      if (!p.coherenceCheckedAt) return true;
      return new Date(p.updatedAt) > new Date(p.coherenceCheckedAt);
    });

    // Active task counts + blocked
    let totalActiveTasks = 0;
    let blockedTasks = 0;
    for (const p of activePlans) {
      try {
        const total = await nodesDal.countByPlan(p.id, { nodeType: 'task' });
        const blocked = await nodesDal.countByPlan(p.id, { nodeType: 'task', status: 'blocked' });
        totalActiveTasks += total;
        blockedTasks += blocked;
      } catch {}
    }

    const blockedRatio = totalActiveTasks > 0 ? blockedTasks / totalActiveTasks : 0;
    const stalePlanRatio = activePlans.length > 0 ? stalePlans.length / activePlans.length : 0;

    const decisionsPenalty = Math.min(0.3, pendingDecisions * 0.1);
    const stalenessPenalty = Math.min(0.3, stalePlans.length * 0.05);
    const blockedPenalty = blockedRatio * 0.5;
    const unlinkedPenalty = stalePlanRatio * 0.3;

    const score = Math.max(0, Math.min(1,
      1 - decisionsPenalty - stalenessPenalty - blockedPenalty - unlinkedPenalty,
    ));

    res.json({
      score: Number(score.toFixed(3)),
      signals: {
        pending_decisions: pendingDecisions,
        stale_plans: stalePlans.length,
        total_active_plans: activePlans.length,
        blocked_tasks: blockedTasks,
        total_active_tasks: totalActiveTasks,
        stale_plan_ratio: Number(stalePlanRatio.toFixed(3)),
        blocked_task_ratio: Number(blockedRatio.toFixed(3)),
      },
      penalties: {
        decisions: Number(decisionsPenalty.toFixed(3)),
        staleness: Number(stalenessPenalty.toFixed(3)),
        blocked: Number(blockedPenalty.toFixed(3)),
        unlinked: Number(unlinkedPenalty.toFixed(3)),
      },
      formula_version: 'v0.1-starter',
      computed_at: new Date().toISOString(),
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
