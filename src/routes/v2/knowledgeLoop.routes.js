/**
 * Knowledge Loop Routes — BDI Phase 4
 *
 * Agent-driven iterative plan improvement loop.
 * Backend orchestrates (start/stop/track/converge),
 * agent provides reasoning via iterate endpoint.
 */
const express = require('express');
const router = express.Router({ mergeParams: true });
const { authenticate } = require('../../middleware/auth.middleware.v2');
const { checkPlanAccess } = require('../../middleware/planAccess.middleware');
const dal = require('../../db/dal.cjs');
const { evaluatePlanQuality } = require('../../services/planQualityEvaluator');
const graphitiBridge = require('../../services/graphitiBridge');

const CONVERGENCE_THRESHOLD = 0.02;
const CONVERGENCE_WINDOW = 3;

/**
 * @swagger
 * /plans/{id}/knowledge-loop/start:
 *   post:
 *     summary: Start a knowledge loop on a plan
 *     description: Creates an agent-driven iterative plan improvement loop. The backend tracks iterations and detects convergence while the agent provides reasoning via the iterate endpoint. Returns 409 if a loop is already running.
 *     tags: [Plans]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *         description: The plan ID
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               goal_id:
 *                 type: string
 *                 format: uuid
 *                 description: Optional goal to evaluate plan against
 *               max_iterations:
 *                 type: integer
 *                 default: 10
 *                 description: Maximum iterations before auto-stop (1-50)
 *     responses:
 *       201:
 *         description: Knowledge loop started
 *       409:
 *         description: A loop is already running for this plan
 */
router.post('/:id/knowledge-loop/start', authenticate, async (req, res, next) => {
  try {
    const { id: planId } = req.params;
    const userId = req.user.id;
    const { goal_id, max_iterations = 10 } = req.body;

    if (!(await checkPlanAccess(planId, userId))) {
      return res.status(403).json({ error: 'You do not have access to this plan' });
    }

    // Check for existing running loop
    const existing = await dal.knowledgeLoopDal.findRunningByPlan(planId);
    if (existing) {
      return res.status(409).json({
        error: 'A knowledge loop is already running for this plan',
        loop_id: existing.id,
      });
    }

    // Evaluate initial quality
    const quality = await evaluatePlanQuality(planId, goal_id || null, {
      orgId: req.user.organizationId,
      userId: req.user.id,
    });

    // Create loop run
    const run = await dal.knowledgeLoopDal.create({
      planId,
      goalId: goal_id || null,
      status: 'running',
      maxIterations: Math.min(Math.max(max_iterations, 1), 50),
      qualityBefore: quality.score,
      startedBy: userId,
    });

    res.status(201).json({
      loop_id: run.id,
      plan_id: planId,
      goal_id: goal_id || null,
      status: run.status,
      quality_before: quality.score,
      quality_breakdown: quality,
      max_iterations: run.maxIterations,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /plans/{id}/knowledge-loop/status:
 *   get:
 *     summary: Get knowledge loop status
 *     description: Returns the current or most recent knowledge loop state including iteration history and quality progression. Returns status 'idle' if no loop has been run.
 *     tags: [Plans]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Loop status with iteration history
 */
router.get('/:id/knowledge-loop/status', authenticate, async (req, res, next) => {
  try {
    const { id: planId } = req.params;
    const userId = req.user.id;

    if (!(await checkPlanAccess(planId, userId))) {
      return res.status(403).json({ error: 'You do not have access to this plan' });
    }

    const run = await dal.knowledgeLoopDal.findLatestByPlan(planId);
    if (!run) {
      return res.json({ status: 'idle', plan_id: planId });
    }

    const iterations = run.iterations || [];
    const scores = iterations.map(i => i.quality_score).filter(s => s != null);

    res.json({
      loop_id: run.id,
      plan_id: planId,
      goal_id: run.goalId,
      status: run.status,
      iterations_completed: iterations.length,
      max_iterations: run.maxIterations,
      quality_before: run.qualityBefore,
      quality_after: run.qualityAfter,
      quality_progression: scores,
      started_at: run.startedAt,
      completed_at: run.completedAt,
      iterations,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /plans/{id}/knowledge-loop/iterate:
 *   post:
 *     summary: Record a knowledge loop iteration
 *     description: Agent calls this after each evaluation/improvement cycle to report results. Backend records the iteration, computes quality delta, and checks for convergence (quality improvement < 0.02 over 3 iterations).
 *     tags: [Plans]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [quality_score]
 *             properties:
 *               quality_score:
 *                 type: number
 *                 description: Plan quality score (0.0-1.0) from agent evaluation
 *               rationale:
 *                 type: string
 *                 description: Agent's reasoning for the score and modifications
 *               modifications:
 *                 type: array
 *                 items: { type: string }
 *                 description: List of modifications made in this iteration
 *               episode_id:
 *                 type: string
 *                 description: Graphiti episode ID if a learning was recorded
 *     responses:
 *       200:
 *         description: Iteration recorded with convergence status
 *       400:
 *         description: Missing quality_score
 *       404:
 *         description: No running loop for this plan
 */
router.post('/:id/knowledge-loop/iterate', authenticate, async (req, res, next) => {
  try {
    const { id: planId } = req.params;
    const userId = req.user.id;
    const { quality_score, rationale, modifications = [], episode_id } = req.body;

    if (!(await checkPlanAccess(planId, userId))) {
      return res.status(403).json({ error: 'You do not have access to this plan' });
    }

    if (quality_score === undefined || typeof quality_score !== 'number') {
      return res.status(400).json({ error: 'quality_score is required (number 0.0-1.0)' });
    }

    const run = await dal.knowledgeLoopDal.findRunningByPlan(planId);
    if (!run) {
      return res.status(404).json({ error: 'No running knowledge loop for this plan' });
    }

    const iterations = run.iterations || [];
    const prevScore = iterations.length > 0
      ? iterations[iterations.length - 1].quality_score
      : run.qualityBefore;
    const qualityDelta = quality_score - (prevScore || 0);

    const iteration = {
      iteration: iterations.length + 1,
      quality_score,
      quality_delta: Math.round(qualityDelta * 1000) / 1000,
      modifications,
      rationale: rationale || '',
      episode_id: episode_id || null,
      duration_ms: null,
      timestamp: new Date().toISOString(),
    };

    await dal.knowledgeLoopDal.addIteration(run.id, iteration);

    // Update plan quality score
    try {
      await dal.plansDal.update(planId, {
        qualityScore: quality_score,
        qualityAssessedAt: new Date(),
        qualityRationale: rationale || null,
      });
    } catch { /* non-critical */ }

    // Check convergence
    const allIterations = [...iterations, iteration];
    let converged = false;

    if (allIterations.length >= CONVERGENCE_WINDOW) {
      const recent = allIterations.slice(-CONVERGENCE_WINDOW);
      const maxDelta = Math.max(...recent.map(i => Math.abs(i.quality_delta)));
      if (maxDelta < CONVERGENCE_THRESHOLD) {
        converged = true;
        await dal.knowledgeLoopDal.complete(run.id, 'converged');
      }
    }

    // Check max iterations
    const maxReached = allIterations.length >= run.maxIterations;
    if (maxReached && !converged) {
      await dal.knowledgeLoopDal.complete(run.id, 'stopped');
    }

    res.json({
      iteration: iteration.iteration,
      quality_score,
      quality_delta: iteration.quality_delta,
      converged,
      max_reached: maxReached,
      remaining_iterations: Math.max(0, run.maxIterations - allIterations.length),
      loop_status: converged ? 'converged' : maxReached ? 'stopped' : 'running',
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /plans/{id}/knowledge-loop/context:
 *   get:
 *     summary: Get context for a knowledge loop iteration
 *     description: Returns everything an agent needs for one iteration — plan structure, goal details, current quality score, knowledge graph facts, coherence issues, and previous iteration history.
 *     tags: [Plans]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Full context for agent iteration
 */
router.get('/:id/knowledge-loop/context', authenticate, async (req, res, next) => {
  try {
    const { id: planId } = req.params;
    const userId = req.user.id;

    if (!(await checkPlanAccess(planId, userId))) {
      return res.status(403).json({ error: 'You do not have access to this plan' });
    }

    const run = await dal.knowledgeLoopDal.findRunningByPlan(planId);

    // Plan structure
    const nodes = await dal.nodesDal.listByPlan(planId);
    const tree = dal.nodesDal.buildTree(nodes);

    // Goal details
    let goal = null;
    if (run?.goalId) {
      try {
        goal = await dal.goalsDal.findById(run.goalId);
      } catch { /* goal may have been deleted */ }
    }

    // Current quality
    const plan = await dal.plansDal.findById(planId);

    // Knowledge facts (if Graphiti available)
    let knowledge = [];
    if (graphitiBridge.isAvailable()) {
      try {
        const orgId = req.user.organizationId;
        const query = plan?.title || '';
        knowledge = await graphitiBridge.queryForContext(planId, query, orgId, 20);
      } catch { /* graceful degradation */ }
    }

    // Coherence issues
    const flaggedNodes = await dal.nodesDal.listByPlan(planId, {
      coherenceStatus: 'stale_beliefs,contradiction_detected',
    });
    const coherenceIssues = flaggedNodes.map(n => ({
      node_id: n.id,
      title: n.title,
      coherence_status: n.coherenceStatus,
    }));

    res.json({
      plan: {
        id: planId,
        title: plan?.title,
        description: plan?.description,
        quality_score: plan?.qualityScore,
        quality_rationale: plan?.qualityRationale,
      },
      goal: goal ? {
        id: goal.id,
        title: goal.title,
        type: goal.type,
        goal_type: goal.goalType,
        success_criteria: goal.successCriteria,
      } : null,
      nodes: tree,
      knowledge,
      coherence_issues: coherenceIssues,
      loop: run ? {
        loop_id: run.id,
        status: run.status,
        iterations_completed: (run.iterations || []).length,
        quality_before: run.qualityBefore,
        quality_after: run.qualityAfter,
        previous_iterations: run.iterations || [],
      } : null,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /plans/{id}/knowledge-loop/stop:
 *   post:
 *     summary: Stop a running knowledge loop
 *     description: Manually stops a running knowledge loop. Sets status to 'stopped' and records completion timestamp. Returns 404 if no loop is running.
 *     tags: [Plans]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Loop stopped with final summary
 *       404:
 *         description: No running loop for this plan
 */
router.post('/:id/knowledge-loop/stop', authenticate, async (req, res, next) => {
  try {
    const { id: planId } = req.params;
    const userId = req.user.id;

    if (!(await checkPlanAccess(planId, userId))) {
      return res.status(403).json({ error: 'You do not have access to this plan' });
    }

    const run = await dal.knowledgeLoopDal.findRunningByPlan(planId);
    if (!run) {
      return res.status(404).json({ error: 'No running knowledge loop for this plan' });
    }

    const completed = await dal.knowledgeLoopDal.complete(run.id, 'stopped');
    const iterations = completed.iterations || [];

    res.json({
      loop_id: completed.id,
      status: completed.status,
      iterations_completed: iterations.length,
      quality_before: completed.qualityBefore,
      quality_after: completed.qualityAfter,
      quality_improvement: completed.qualityAfter != null && completed.qualityBefore != null
        ? Math.round((completed.qualityAfter - completed.qualityBefore) * 1000) / 1000
        : null,
      completed_at: completed.completedAt,
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
