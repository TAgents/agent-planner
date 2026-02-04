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

// Removed: /download artifact endpoint (Phase 0 simplification)

/**
 * @swagger
 * /placeholder:
 *   get:
 *     deprecated: true
 *     summary: Placeholder (artifacts removed)
 *     tags: [Deprecated]
 *     responses:
 *       410:
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
