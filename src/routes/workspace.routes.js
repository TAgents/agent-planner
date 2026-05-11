/**
 * Workspace Routes — v2
 *
 * Workspaces are folders under an Organization that own goals + plans.
 * Pure container — no semantic behavior beyond grouping. See
 * docs/WORKSPACE_BLUEPRINT_SKETCH.md for the design.
 */

const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth.middleware');
const { workspacesDal, organizationsDal } = require('../db/dal.cjs');
const logger = require('../utils/logger');

// ─── Helpers ─────────────────────────────────────────────────────

async function requireOrgAccess(orgId, userId) {
  const membership = await organizationsDal.getMembership(orgId, userId);
  return membership ?? null;
}

async function requireWorkspaceAccess(workspaceId, userId) {
  const ws = await workspacesDal.findById(workspaceId);
  if (!ws) return { ws: null, membership: null };
  const membership = await organizationsDal.getMembership(ws.organizationId, userId);
  return { ws, membership };
}

// ─── List workspaces in an organization ──────────────────────────
/**
 * @swagger
 * /workspaces:
 *   get:
 *     summary: List workspaces in an organization
 *     tags: [Workspaces]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: organization_id
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - in: query
 *         name: include_archived
 *         schema: { type: boolean, default: false }
 *     responses:
 *       200: { description: List of workspaces }
 */
router.get('/', authenticate, async (req, res) => {
  try {
    const orgId = req.query.organization_id;
    if (!orgId) return res.status(400).json({ error: 'organization_id is required' });

    const membership = await requireOrgAccess(orgId, req.user.id);
    if (!membership) return res.status(403).json({ error: 'Access denied' });

    const includeArchived = req.query.include_archived === 'true';
    const items = await workspacesDal.listForOrganization(orgId, { includeArchived });
    return res.json({ workspaces: items });
  } catch (error) {
    await logger.error('List workspaces error:', error);
    return res.status(500).json({ error: 'Failed to list workspaces' });
  }
});

// ─── Get a single workspace ──────────────────────────────────────
/**
 * @swagger
 * /workspaces/{id}:
 *   get:
 *     summary: Get workspace details (with goal + plan counts)
 *     tags: [Workspaces]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Workspace details }
 *       404: { description: Not found }
 */
router.get('/:id', authenticate, async (req, res) => {
  try {
    const { ws, membership } = await requireWorkspaceAccess(req.params.id, req.user.id);
    if (!ws) return res.status(404).json({ error: 'Workspace not found' });
    if (!membership) return res.status(403).json({ error: 'Access denied' });

    const counts = await workspacesDal.getCounts(ws.id);
    return res.json({ ...ws, ...counts, role: membership.role });
  } catch (error) {
    await logger.error('Get workspace error:', error);
    return res.status(500).json({ error: 'Failed to get workspace' });
  }
});

// ─── Create a workspace ──────────────────────────────────────────
/**
 * @swagger
 * /workspaces:
 *   post:
 *     summary: Create a workspace
 *     tags: [Workspaces]
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [organization_id, title]
 *             properties:
 *               organization_id: { type: string, format: uuid }
 *               title: { type: string }
 *               slug: { type: string, description: 'Optional. Generated from title if absent.' }
 *               description: { type: string }
 *               icon: { type: string }
 *               is_default: { type: boolean }
 *     responses:
 *       201: { description: Workspace created }
 */
router.post('/', authenticate, async (req, res) => {
  try {
    const { organization_id: organizationId, title, slug, description, icon, is_default } = req.body ?? {};

    if (!organizationId) return res.status(400).json({ error: 'organization_id is required' });
    if (!title || typeof title !== 'string') return res.status(400).json({ error: 'title is required' });

    const membership = await requireOrgAccess(organizationId, req.user.id);
    if (!membership) return res.status(403).json({ error: 'Access denied' });

    // Only one default workspace per org. If is_default=true requested, ensure no other is default.
    if (is_default === true) {
      const existing = await workspacesDal.findDefault(organizationId);
      if (existing) {
        return res.status(409).json({ error: 'Organization already has a default workspace', defaultWorkspaceId: existing.id });
      }
    }

    const ws = await workspacesDal.create({
      organizationId,
      ownerId: req.user.id,
      title,
      slug,
      description,
      icon,
      isDefault: is_default === true,
    });
    return res.status(201).json(ws);
  } catch (error) {
    await logger.error('Create workspace error:', error);
    return res.status(500).json({ error: 'Failed to create workspace' });
  }
});

// ─── Update a workspace ──────────────────────────────────────────
/**
 * @swagger
 * /workspaces/{id}:
 *   patch:
 *     summary: Update workspace title, description, icon, or slug
 *     tags: [Workspaces]
 *     security: [{ bearerAuth: [] }]
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
 *               title: { type: string }
 *               description: { type: string }
 *               icon: { type: string }
 *               slug: { type: string }
 *               metadata: { type: object }
 *     responses:
 *       200: { description: Workspace updated }
 */
router.patch('/:id', authenticate, async (req, res) => {
  try {
    const { ws, membership } = await requireWorkspaceAccess(req.params.id, req.user.id);
    if (!ws) return res.status(404).json({ error: 'Workspace not found' });
    if (!membership) return res.status(403).json({ error: 'Access denied' });

    const allowed = {};
    for (const k of ['title', 'description', 'icon', 'metadata']) {
      if (k in req.body) allowed[k] = req.body[k];
    }

    if (typeof req.body?.slug === 'string') {
      const newSlug = await workspacesDal.uniqueSlug(ws.organizationId, req.body.slug);
      // Allow keeping existing slug
      if (newSlug !== ws.slug) allowed.slug = newSlug;
    }

    if (Object.keys(allowed).length === 0) {
      return res.status(400).json({ error: 'No updatable fields provided' });
    }

    const updated = await workspacesDal.update(ws.id, allowed);
    return res.json(updated);
  } catch (error) {
    await logger.error('Update workspace error:', error);
    return res.status(500).json({ error: 'Failed to update workspace' });
  }
});

// ─── Archive (soft-delete) ───────────────────────────────────────
/**
 * @swagger
 * /workspaces/{id}/archive:
 *   post:
 *     summary: Archive a workspace (soft-delete; recoverable via /restore)
 *     tags: [Workspaces]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Archived }
 */
router.post('/:id/archive', authenticate, async (req, res) => {
  try {
    const { ws, membership } = await requireWorkspaceAccess(req.params.id, req.user.id);
    if (!ws) return res.status(404).json({ error: 'Workspace not found' });
    if (!membership) return res.status(403).json({ error: 'Access denied' });

    if (ws.isDefault) {
      return res.status(409).json({ error: 'Cannot archive the default workspace' });
    }

    const updated = await workspacesDal.archive(ws.id);
    return res.json(updated);
  } catch (error) {
    await logger.error('Archive workspace error:', error);
    return res.status(500).json({ error: 'Failed to archive workspace' });
  }
});

// ─── Restore (un-archive) ────────────────────────────────────────
router.post('/:id/restore', authenticate, async (req, res) => {
  try {
    const { ws, membership } = await requireWorkspaceAccess(req.params.id, req.user.id);
    if (!ws) return res.status(404).json({ error: 'Workspace not found' });
    if (!membership) return res.status(403).json({ error: 'Access denied' });

    const updated = await workspacesDal.unarchive(ws.id);
    return res.json(updated);
  } catch (error) {
    await logger.error('Restore workspace error:', error);
    return res.status(500).json({ error: 'Failed to restore workspace' });
  }
});

// ─── Hard delete ─────────────────────────────────────────────────
/**
 * @swagger
 * /workspaces/{id}:
 *   delete:
 *     summary: Hard-delete a workspace. Goals/plans inside have their workspace_id set to NULL.
 *     tags: [Workspaces]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       204: { description: Deleted }
 */
router.delete('/:id', authenticate, async (req, res) => {
  try {
    const { ws, membership } = await requireWorkspaceAccess(req.params.id, req.user.id);
    if (!ws) return res.status(404).json({ error: 'Workspace not found' });
    if (!membership || !['owner', 'admin'].includes(membership.role)) {
      return res.status(403).json({ error: 'Only org owners or admins can delete workspaces' });
    }
    if (ws.isDefault) {
      return res.status(409).json({ error: 'Cannot delete the default workspace' });
    }

    await workspacesDal.delete(ws.id);
    return res.status(204).send();
  } catch (error) {
    await logger.error('Delete workspace error:', error);
    return res.status(500).json({ error: 'Failed to delete workspace' });
  }
});

module.exports = router;
