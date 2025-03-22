const express = require('express');
const router = express.Router();
const artifactController = require('../controllers/artifact.controller');
const { authenticate } = require('../middleware/auth.middleware');

/**
 * @swagger
 * tags:
 *   name: Artifacts
 *   description: Artifact management endpoints
 */

/**
 * @swagger
 * components:
 *   schemas:
 *     Artifact:
 *       type: object
 *       properties:
 *         id:
 *           type: string
 *           format: uuid
 *         plan_node_id:
 *           type: string
 *           format: uuid
 *         name:
 *           type: string
 *         content_type:
 *           type: string
 *         url:
 *           type: string
 *         created_at:
 *           type: string
 *           format: date-time
 *         created_by:
 *           type: string
 *           format: uuid
 *         metadata:
 *           type: object
 */

/**
 * @swagger
 * /plans/{id}/nodes/{nodeId}/artifacts:
 *   post:
 *     summary: Add an artifact to a node
 *     tags: [Artifacts]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: The plan ID
 *       - in: path
 *         name: nodeId
 *         required: true
 *         schema:
 *           type: string
 *         description: The node ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - name
 *               - content_type
 *               - url
 *             properties:
 *               name:
 *                 type: string
 *                 description: Name of the artifact
 *               content_type:
 *                 type: string
 *                 description: MIME type or content type of the artifact
 *               url:
 *                 type: string
 *                 description: URL or reference to the artifact content
 *               metadata:
 *                 type: object
 *                 description: Additional metadata for the artifact
 *     responses:
 *       201:
 *         description: Artifact added successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Artifact'
 *       400:
 *         description: Invalid input
 *       401:
 *         description: Authentication required
 *       403:
 *         description: Access denied
 *       404:
 *         description: Node not found
 */
router.post('/:id/nodes/:nodeId/artifacts', authenticate, artifactController.addArtifact);

/**
 * @swagger
 * /plans/{id}/nodes/{nodeId}/artifacts:
 *   get:
 *     summary: List artifacts for a node
 *     tags: [Artifacts]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: The plan ID
 *       - in: path
 *         name: nodeId
 *         required: true
 *         schema:
 *           type: string
 *         description: The node ID
 *     responses:
 *       200:
 *         description: List of artifacts for the node
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/Artifact'
 *       401:
 *         description: Authentication required
 *       403:
 *         description: Access denied
 *       404:
 *         description: Node not found
 */
router.get('/:id/nodes/:nodeId/artifacts', authenticate, artifactController.getNodeArtifacts);

/**
 * @swagger
 * /plans/{id}/nodes/{nodeId}/artifacts/{artifactId}:
 *   get:
 *     summary: Get a specific artifact
 *     tags: [Artifacts]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: The plan ID
 *       - in: path
 *         name: nodeId
 *         required: true
 *         schema:
 *           type: string
 *         description: The node ID
 *       - in: path
 *         name: artifactId
 *         required: true
 *         schema:
 *           type: string
 *         description: The artifact ID
 *     responses:
 *       200:
 *         description: Artifact details
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Artifact'
 *       401:
 *         description: Authentication required
 *       403:
 *         description: Access denied
 *       404:
 *         description: Artifact not found
 */
router.get('/:id/nodes/:nodeId/artifacts/:artifactId', authenticate, artifactController.getArtifact);

/**
 * @swagger
 * /plans/{id}/nodes/{nodeId}/artifacts/{artifactId}:
 *   put:
 *     summary: Update an artifact
 *     tags: [Artifacts]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: The plan ID
 *       - in: path
 *         name: nodeId
 *         required: true
 *         schema:
 *           type: string
 *         description: The node ID
 *       - in: path
 *         name: artifactId
 *         required: true
 *         schema:
 *           type: string
 *         description: The artifact ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *                 description: Name of the artifact
 *               content_type:
 *                 type: string
 *                 description: MIME type or content type of the artifact
 *               url:
 *                 type: string
 *                 description: URL or reference to the artifact content
 *               metadata:
 *                 type: object
 *                 description: Additional metadata for the artifact
 *     responses:
 *       200:
 *         description: Artifact updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Artifact'
 *       400:
 *         description: Invalid input
 *       401:
 *         description: Authentication required
 *       403:
 *         description: Access denied
 *       404:
 *         description: Artifact not found
 */
router.put('/:id/nodes/:nodeId/artifacts/:artifactId', authenticate, artifactController.updateArtifact);

/**
 * @swagger
 * /plans/{id}/nodes/{nodeId}/artifacts/{artifactId}:
 *   delete:
 *     summary: Delete an artifact
 *     tags: [Artifacts]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: The plan ID
 *       - in: path
 *         name: nodeId
 *         required: true
 *         schema:
 *           type: string
 *         description: The node ID
 *       - in: path
 *         name: artifactId
 *         required: true
 *         schema:
 *           type: string
 *         description: The artifact ID
 *     responses:
 *       204:
 *         description: Artifact deleted successfully
 *       401:
 *         description: Authentication required
 *       403:
 *         description: Access denied
 *       404:
 *         description: Artifact not found
 */
router.delete('/:id/nodes/:nodeId/artifacts/:artifactId', authenticate, artifactController.deleteArtifact);

/**
 * @swagger
 * /plans/{id}/artifacts:
 *   get:
 *     summary: List all artifacts across the plan
 *     tags: [Artifacts]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: The plan ID
 *     responses:
 *       200:
 *         description: List of all artifacts in the plan
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/Artifact'
 *       401:
 *         description: Authentication required
 *       403:
 *         description: Access denied
 *       404:
 *         description: Plan not found
 */
router.get('/:id/artifacts', authenticate, artifactController.getPlanArtifacts);

module.exports = router;
