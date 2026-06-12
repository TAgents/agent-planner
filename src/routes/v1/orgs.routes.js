/**
 * v1 — Organizations & workspaces. Aliases onto routes/organization.routes.js
 * and routes/workspace.routes.js handlers.
 */
const express = require('express');
const router = express.Router();
const domains = require('../../domains');
const workspaceRoutes = require('../workspace.routes');
const { forwardTo, e } = require('./forward');

const organizationRoutes = domains.collaboration.routes.organizationRoutes;

/**
 * @swagger
 * /v1/orgs:
 *   get:
 *     summary: List organizations for the authenticated user
 *     tags: [v1]
 *     security: [{ bearerAuth: [] }, { apiKey: [] }]
 *     responses:
 *       200: { description: Organization list }
 *   post:
 *     summary: Create an organization
 *     tags: [v1]
 *     security: [{ bearerAuth: [] }, { apiKey: [] }]
 *     responses:
 *       201: { description: Organization created }
 */
router.get('/orgs', forwardTo(organizationRoutes, () => '/'));
router.post('/orgs', forwardTo(organizationRoutes, () => '/'));

/**
 * @swagger
 * /v1/orgs/{id}:
 *   get:
 *     summary: Get an organization
 *     tags: [v1]
 *     security: [{ bearerAuth: [] }, { apiKey: [] }]
 *     responses:
 *       200: { description: Organization }
 *   patch:
 *     summary: Update an organization
 *     tags: [v1]
 *     security: [{ bearerAuth: [] }, { apiKey: [] }]
 *     responses:
 *       200: { description: Updated organization }
 *   delete:
 *     summary: Delete an organization
 *     tags: [v1]
 *     security: [{ bearerAuth: [] }, { apiKey: [] }]
 *     responses:
 *       200: { description: Organization deleted }
 */
router.get('/orgs/:id', forwardTo(organizationRoutes, (req) => `/${e(req.params.id)}`));
router.patch('/orgs/:id', forwardTo(organizationRoutes, (req) => `/${e(req.params.id)}`, { method: 'PUT' }));
router.delete('/orgs/:id', forwardTo(organizationRoutes, (req) => `/${e(req.params.id)}`));

/**
 * @swagger
 * /v1/orgs/{id}/members:
 *   get:
 *     summary: List organization members
 *     tags: [v1]
 *     security: [{ bearerAuth: [] }, { apiKey: [] }]
 *     responses:
 *       200: { description: Member list }
 *   post:
 *     summary: Add an organization member
 *     tags: [v1]
 *     security: [{ bearerAuth: [] }, { apiKey: [] }]
 *     responses:
 *       201: { description: Member added }
 */
router.get('/orgs/:id/members', forwardTo(organizationRoutes, (req) => `/${e(req.params.id)}/members`));
router.post('/orgs/:id/members', forwardTo(organizationRoutes, (req) => `/${e(req.params.id)}/members`));

/**
 * @swagger
 * /v1/orgs/{id}/members/{userId}:
 *   patch:
 *     summary: Update a member's role
 *     tags: [v1]
 *     security: [{ bearerAuth: [] }, { apiKey: [] }]
 *     responses:
 *       200: { description: Role updated }
 *   delete:
 *     summary: Remove a member from the organization
 *     tags: [v1]
 *     security: [{ bearerAuth: [] }, { apiKey: [] }]
 *     responses:
 *       200: { description: Member removed }
 */
router.patch(
  '/orgs/:id/members/:userId',
  forwardTo(organizationRoutes, (req) => `/${e(req.params.id)}/members/${e(req.params.userId)}/role`, { method: 'PUT' })
);
router.delete(
  '/orgs/:id/members/:userId',
  forwardTo(organizationRoutes, (req) => `/${e(req.params.id)}/members/${e(req.params.userId)}`)
);

/**
 * @swagger
 * /v1/workspaces:
 *   get:
 *     summary: List workspaces in an organization
 *     tags: [v1]
 *     security: [{ bearerAuth: [] }, { apiKey: [] }]
 *     responses:
 *       200: { description: Workspace list }
 *   post:
 *     summary: Create a workspace
 *     tags: [v1]
 *     security: [{ bearerAuth: [] }, { apiKey: [] }]
 *     responses:
 *       201: { description: Workspace created }
 */
router.get('/workspaces', forwardTo(workspaceRoutes, () => '/'));
router.post('/workspaces', forwardTo(workspaceRoutes, () => '/'));

/**
 * @swagger
 * /v1/workspaces/{id}:
 *   get:
 *     summary: Get a workspace
 *     tags: [v1]
 *     security: [{ bearerAuth: [] }, { apiKey: [] }]
 *     responses:
 *       200: { description: Workspace }
 *   patch:
 *     summary: Update a workspace (set `archived` true/false to archive or restore)
 *     tags: [v1]
 *     security: [{ bearerAuth: [] }, { apiKey: [] }]
 *     responses:
 *       200: { description: Updated workspace }
 *   delete:
 *     summary: Delete a workspace
 *     tags: [v1]
 *     security: [{ bearerAuth: [] }, { apiKey: [] }]
 *     responses:
 *       200: { description: Workspace deleted }
 */
router.get('/workspaces/:id', forwardTo(workspaceRoutes, (req) => `/${e(req.params.id)}`));
// archive/restore are folded into PATCH via the `archived` boolean; any other
// body fields go to the plain PATCH handler.
router.patch('/workspaces/:id', (req, res, next) => {
  if (req.body && typeof req.body.archived === 'boolean') {
    req.method = 'POST';
    req.url = `/${e(req.params.id)}/${req.body.archived ? 'archive' : 'restore'}`;
    return workspaceRoutes(req, res, next);
  }
  req.url = `/${e(req.params.id)}`;
  workspaceRoutes(req, res, next);
});
router.delete('/workspaces/:id', forwardTo(workspaceRoutes, (req) => `/${e(req.params.id)}`));

module.exports = router;
