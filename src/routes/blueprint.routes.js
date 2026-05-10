/**
 * Blueprint Routes — v2
 *
 * Blueprints are dehydrated, reusable shapes that fork into Workspaces or
 * Plans. v1 supports plan-scope only (a single plan and its tree).
 * Workspace-scope follow-up. See docs/WORKSPACE_BLUEPRINT_SKETCH.md.
 */

const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth.middleware');
const { blueprintsDal, plansDal, workspacesDal, organizationsDal } = require('../db/dal.cjs');
const logger = require('../utils/logger');

// ─── Helpers ─────────────────────────────────────────────────────

async function userOwnsOrCanRead(blueprint, userId) {
  if (!blueprint) return false;
  if (blueprint.ownerId === userId) return true;
  if (['public', 'unlisted'].includes(blueprint.visibility)) return true;
  return false;
}

// ─── List blueprints visible to the user ─────────────────────────
/**
 * @swagger
 * /blueprints:
 *   get:
 *     summary: List blueprints owned by the user, plus public/unlisted
 *     tags: [Blueprints]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: scope
 *         schema: { type: string, enum: [plan, workspace] }
 *       - in: query
 *         name: visibility
 *         schema: { type: string, enum: [private, public, unlisted] }
 *       - in: query
 *         name: owner_only
 *         schema: { type: boolean, default: false }
 *     responses:
 *       200: { description: List of blueprints }
 */
router.get('/', authenticate, async (req, res) => {
  try {
    const items = await blueprintsDal.listForUser(req.user.id, {
      scope: req.query.scope,
      visibility: req.query.visibility,
      ownerOnly: req.query.owner_only === 'true',
    });
    return res.json({ blueprints: items });
  } catch (error) {
    await logger.error('List blueprints error:', error);
    return res.status(500).json({ error: 'Failed to list blueprints' });
  }
});

// ─── Get a single blueprint ──────────────────────────────────────
router.get('/:id', authenticate, async (req, res) => {
  try {
    const bp = await blueprintsDal.findById(req.params.id);
    if (!bp) return res.status(404).json({ error: 'Blueprint not found' });
    if (!(await userOwnsOrCanRead(bp, req.user.id))) {
      return res.status(403).json({ error: 'Access denied' });
    }
    return res.json(bp);
  } catch (error) {
    await logger.error('Get blueprint error:', error);
    return res.status(500).json({ error: 'Failed to get blueprint' });
  }
});

// ─── Create a blueprint from raw payload ─────────────────────────
/**
 * @swagger
 * /blueprints:
 *   post:
 *     summary: Create a blueprint from a payload (advanced; usually use save_as endpoints)
 *     tags: [Blueprints]
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [title, scope, payload]
 *             properties:
 *               title: { type: string }
 *               description: { type: string }
 *               scope: { type: string, enum: [plan, workspace] }
 *               visibility: { type: string, enum: [private, public, unlisted] }
 *               payload: { type: object }
 *               tags: { type: array, items: { type: string } }
 *               organization_id: { type: string, format: uuid }
 *     responses:
 *       201: { description: Blueprint created }
 *       400: { description: Validation error }
 */
router.post('/', authenticate, async (req, res) => {
  try {
    const { title, description, scope, visibility, payload, tags, organization_id: organizationId } = req.body ?? {};
    if (!title) return res.status(400).json({ error: 'title is required' });
    if (!['plan', 'workspace'].includes(scope)) {
      return res.status(400).json({ error: 'scope must be "plan" or "workspace"' });
    }
    if (!payload || typeof payload !== 'object') {
      return res.status(400).json({ error: 'payload is required and must be an object' });
    }

    const bp = await blueprintsDal.create({
      ownerId: req.user.id,
      organizationId: organizationId ?? null,
      title,
      description,
      scope,
      visibility: visibility || 'private',
      payload,
      tags: Array.isArray(tags) ? tags : [],
    });
    return res.status(201).json(bp);
  } catch (error) {
    await logger.error('Create blueprint error:', error);
    return res.status(500).json({ error: 'Failed to create blueprint' });
  }
});

// ─── Update blueprint metadata (title, description, visibility, tags) ─
router.patch('/:id', authenticate, async (req, res) => {
  try {
    const bp = await blueprintsDal.findById(req.params.id);
    if (!bp) return res.status(404).json({ error: 'Blueprint not found' });
    if (bp.ownerId !== req.user.id) return res.status(403).json({ error: 'Only the owner can update a blueprint' });

    const allowed = {};
    for (const k of ['title', 'description', 'visibility', 'tags']) {
      if (k in req.body) allowed[k] = req.body[k];
    }
    if (Object.keys(allowed).length === 0) {
      return res.status(400).json({ error: 'No updatable fields provided' });
    }
    const updated = await blueprintsDal.update(bp.id, allowed);
    return res.json(updated);
  } catch (error) {
    await logger.error('Update blueprint error:', error);
    return res.status(500).json({ error: 'Failed to update blueprint' });
  }
});

// ─── Delete a blueprint ──────────────────────────────────────────
router.delete('/:id', authenticate, async (req, res) => {
  try {
    const bp = await blueprintsDal.findById(req.params.id);
    if (!bp) return res.status(404).json({ error: 'Blueprint not found' });
    if (bp.ownerId !== req.user.id) return res.status(403).json({ error: 'Only the owner can delete a blueprint' });
    await blueprintsDal.delete(bp.id);
    return res.status(204).send();
  } catch (error) {
    await logger.error('Delete blueprint error:', error);
    return res.status(500).json({ error: 'Failed to delete blueprint' });
  }
});

// ─── Fork a plan-scope blueprint into a workspace ────────────────
/**
 * @swagger
 * /blueprints/{id}/fork:
 *   post:
 *     summary: Fork a plan-scope blueprint into a target workspace
 *     tags: [Blueprints]
 *     security: [{ bearerAuth: [] }]
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
 *             required: [workspace_id]
 *             properties:
 *               workspace_id: { type: string, format: uuid }
 *               title: { type: string, description: 'Optional override for the new plan title' }
 *     responses:
 *       201: { description: New plan created from blueprint }
 *       400: { description: Validation error }
 *       403: { description: Access denied to blueprint or workspace }
 *       404: { description: Blueprint or workspace not found }
 */
router.post('/:id/fork', authenticate, async (req, res) => {
  try {
    const bp = await blueprintsDal.findById(req.params.id);
    if (!bp) return res.status(404).json({ error: 'Blueprint not found' });
    if (!(await userOwnsOrCanRead(bp, req.user.id))) {
      return res.status(403).json({ error: 'Access denied' });
    }

    if (bp.scope !== 'plan') {
      return res.status(400).json({ error: 'Only plan-scope blueprints can be forked in v1' });
    }

    const { workspace_id: workspaceId, title } = req.body ?? {};
    if (!workspaceId) return res.status(400).json({ error: 'workspace_id is required' });

    const ws = await workspacesDal.findById(workspaceId);
    if (!ws) return res.status(404).json({ error: 'Target workspace not found' });

    const membership = await organizationsDal.getMembership(ws.organizationId, req.user.id);
    if (!membership) return res.status(403).json({ error: 'Access denied to target workspace' });

    const newPlan = await blueprintsDal.forkPlanScope({
      blueprintId: bp.id,
      workspaceId: ws.id,
      ownerId: req.user.id,
      title,
    });
    return res.status(201).json(newPlan);
  } catch (error) {
    await logger.error('Fork blueprint error:', error);
    return res.status(500).json({ error: 'Failed to fork blueprint' });
  }
});

// ─── List plans forked from a blueprint ──────────────────────────
/**
 * @swagger
 * /blueprints/{id}/forks:
 *   get:
 *     summary: List plans forked from this blueprint, with workspace decoration
 *     tags: [Blueprints]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 50 }
 *     responses:
 *       200: { description: Array of plan rows decorated with their workspace }
 *       403: { description: Access denied }
 *       404: { description: Blueprint not found }
 */
router.get('/:id/forks', authenticate, async (req, res) => {
  try {
    const bp = await blueprintsDal.findById(req.params.id);
    if (!bp) return res.status(404).json({ error: 'Blueprint not found' });
    if (!(await userOwnsOrCanRead(bp, req.user.id))) {
      return res.status(403).json({ error: 'Access denied' });
    }
    const limit = Math.max(1, Math.min(200, parseInt(req.query.limit, 10) || 50));
    const rows = await blueprintsDal.listForks(bp.id, { limit });
    return res.json({ forks: rows });
  } catch (error) {
    await logger.error('List blueprint forks error:', error);
    return res.status(500).json({ error: 'Failed to list forks' });
  }
});

// ─── Save a plan as a new blueprint ──────────────────────────────
/**
 * @swagger
 * /plans/{planId}/save_as_blueprint is the symmetric route — implemented
 * here under /blueprints/from_plan to avoid polluting the plans router.
 */
router.post('/from_plan/:planId', authenticate, async (req, res) => {
  try {
    const { planId } = req.params;
    const access = await plansDal.userHasAccess(planId, req.user.id);
    if (!access?.hasAccess) return res.status(403).json({ error: 'Access denied to plan' });

    const { title, description, visibility, tags } = req.body ?? {};
    const bp = await blueprintsDal.savePlanAsBlueprint({
      planId,
      ownerId: req.user.id,
      title,
      description,
      visibility: visibility || 'private',
      tags: Array.isArray(tags) ? tags : [],
    });
    return res.status(201).json(bp);
  } catch (error) {
    await logger.error('Save plan as blueprint error:', error);
    return res.status(500).json({ error: 'Failed to save plan as blueprint' });
  }
});

module.exports = router;
