/**
 * Connected apps routes — user-authenticated management of OAuth connector
 * connections (the apps that can act as the user via the MCP connector).
 */
const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth.middleware.v2');
const connectionsController = require('../controllers/connections.controller');

/**
 * @swagger
 * /connections/apps:
 *   get:
 *     summary: List apps connected via the OAuth connector
 *     description: One entry per external app (Claude, ChatGPT, …) that holds an active connection (a non-revoked, unexpired refresh token) and can act on the user's behalf.
 *     tags: [Connections]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Connected apps
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   client_id: { type: string }
 *                   name: { type: string }
 *                   type: { type: string, description: "Display connector type (Claude, ChatGPT, …)" }
 *                   status: { type: string }
 *                   connected_at: { type: string, format: date-time, description: "Stable across refresh-token rotation" }
 *                   expires_at: { type: string, format: date-time }
 *                   scopes: { type: array, items: { type: string } }
 *                   capabilities:
 *                     type: object
 *                     properties:
 *                       summary: { type: string }
 *                       read: { type: array, items: { type: string } }
 *                       write: { type: array, items: { type: string } }
 *       401:
 *         description: Authentication required
 */
router.get('/apps', authenticate, connectionsController.listApps);

/**
 * @swagger
 * /connections/apps/{clientId}:
 *   delete:
 *     summary: Disconnect an app
 *     description: Revokes every active refresh token for the given OAuth client, ending its access within the access-token TTL. Idempotent.
 *     tags: [Connections]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: clientId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       204:
 *         description: Disconnected (or nothing to disconnect)
 *       401:
 *         description: Authentication required
 */
router.delete('/apps/:clientId', authenticate, connectionsController.revokeApp);

module.exports = router;
