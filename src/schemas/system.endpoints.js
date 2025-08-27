/**
 * @swagger
 * tags:
 *   - name: System
 *     description: System and utility endpoints
 */

/**
 * @swagger
 * /:
 *   get:
 *     summary: API root endpoint
 *     tags: [System]
 *     responses:
 *       200:
 *         description: Welcome message and documentation link
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: Welcome to the Planning System API
 *                 documentation:
 *                   type: string
 *                   example: /api-docs
 */

/**
 * @swagger
 * /health:
 *   get:
 *     summary: Health check endpoint
 *     description: Used by monitoring services and orchestration platforms (e.g., Cloud Run) to verify the service is running
 *     tags: [System]
 *     responses:
 *       200:
 *         description: Service is healthy
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   enum: [healthy]
 *                   example: healthy
 *                 timestamp:
 *                   type: string
 *                   format: date-time
 *                   example: 2024-01-15T10:30:00Z
 *                 service:
 *                   type: string
 *                   example: agent-planner-api
 */

/**
 * @swagger
 * /download:
 *   get:
 *     summary: Download an artifact file
 *     tags: [Artifacts]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: path
 *         required: true
 *         schema:
 *           type: string
 *         description: The file path to download
 *         example: uploads/artifacts/document.pdf
 *       - in: query
 *         name: filename
 *         required: false
 *         schema:
 *           type: string
 *         description: The filename to use for the download (defaults to original filename)
 *         example: my-document.pdf
 *     responses:
 *       200:
 *         description: File stream for download
 *         content:
 *           application/octet-stream:
 *             schema:
 *               type: string
 *               format: binary
 *       400:
 *         description: Invalid path or not a file
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               error: Path parameter is required
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       404:
 *         description: File not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               error: File not found
 */

/**
 * @swagger
 * /api-docs:
 *   get:
 *     summary: Interactive API documentation
 *     description: Swagger UI interface for exploring and testing the API
 *     tags: [System]
 *     responses:
 *       200:
 *         description: HTML page with Swagger UI
 *         content:
 *           text/html:
 *             schema:
 *               type: string
 */

/**
 * @swagger
 * /api-docs-json:
 *   get:
 *     summary: OpenAPI specification in JSON format
 *     tags: [System]
 *     responses:
 *       200:
 *         description: OpenAPI 3.0 specification
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               description: OpenAPI 3.0 specification object
 */

// Export empty object to make this a valid module
module.exports = {};
