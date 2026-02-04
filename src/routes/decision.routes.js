/**
 * Decision Request Routes
 * 
 * Endpoints for managing decision requests - enabling agents to request
 * human decisions with structured options.
 */

const express = require('express');
const router = express.Router();
const decisionController = require('../controllers/decision.controller');
const { authenticate } = require('../middleware/auth.middleware');
const { validate, schemas } = require('../validation');

/**
 * @swagger
 * components:
 *   schemas:
 *     DecisionOption:
 *       type: object
 *       properties:
 *         option:
 *           type: string
 *           description: The option being proposed
 *         pros:
 *           type: array
 *           items:
 *             type: string
 *           description: Advantages of this option
 *         cons:
 *           type: array
 *           items:
 *             type: string
 *           description: Disadvantages of this option
 *         recommendation:
 *           type: boolean
 *           description: Whether this is the recommended option
 *     DecisionRequest:
 *       type: object
 *       properties:
 *         id:
 *           type: string
 *           format: uuid
 *         plan_id:
 *           type: string
 *           format: uuid
 *         node_id:
 *           type: string
 *           format: uuid
 *           nullable: true
 *         title:
 *           type: string
 *         context:
 *           type: string
 *         options:
 *           type: array
 *           items:
 *             $ref: '#/components/schemas/DecisionOption'
 *         urgency:
 *           type: string
 *           enum: [blocking, can_continue, informational]
 *         status:
 *           type: string
 *           enum: [pending, decided, expired, cancelled]
 *         decision:
 *           type: string
 *           nullable: true
 *         rationale:
 *           type: string
 *           nullable: true
 *         created_at:
 *           type: string
 *           format: date-time
 *         decided_at:
 *           type: string
 *           format: date-time
 *           nullable: true
 */

/**
 * @swagger
 * /plans/{id}/decisions:
 *   get:
 *     summary: List decision requests for a plan
 *     tags: [Decisions]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Plan UUID
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [pending, decided, expired, cancelled]
 *         description: Filter by status
 *       - in: query
 *         name: urgency
 *         schema:
 *           type: string
 *           enum: [blocking, can_continue, informational]
 *         description: Filter by urgency
 *       - in: query
 *         name: node_id
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Filter by node
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 50
 *       - in: query
 *         name: offset
 *         schema:
 *           type: integer
 *           default: 0
 *     responses:
 *       200:
 *         description: List of decision requests
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/DecisionRequest'
 */
router.get('/:id/decisions',
  authenticate,
  ...validate({ params: schemas.decision.planIdParam, query: schemas.decision.listDecisionRequests }),
  decisionController.listDecisionRequests
);

/**
 * @swagger
 * /plans/{id}/decisions/pending-count:
 *   get:
 *     summary: Get count of pending decisions for a plan
 *     tags: [Decisions]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Pending count
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 pending_count:
 *                   type: integer
 */
router.get('/:id/decisions/pending-count',
  authenticate,
  ...validate({ params: schemas.decision.planIdParam }),
  decisionController.getPendingDecisionCount
);

/**
 * @swagger
 * /plans/{id}/decisions/{decisionId}:
 *   get:
 *     summary: Get a single decision request
 *     tags: [Decisions]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *       - in: path
 *         name: decisionId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Decision request details
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/DecisionRequest'
 */
router.get('/:id/decisions/:decisionId',
  authenticate,
  ...validate({ params: schemas.decision.decisionIdParam }),
  decisionController.getDecisionRequest
);

/**
 * @swagger
 * /plans/{id}/decisions:
 *   post:
 *     summary: Create a new decision request
 *     tags: [Decisions]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - title
 *               - context
 *             properties:
 *               node_id:
 *                 type: string
 *                 format: uuid
 *                 description: Optional node this decision relates to
 *               title:
 *                 type: string
 *                 maxLength: 200
 *                 description: Brief title for the decision
 *               context:
 *                 type: string
 *                 maxLength: 5000
 *                 description: Full context explaining what needs to be decided
 *               options:
 *                 type: array
 *                 items:
 *                   $ref: '#/components/schemas/DecisionOption'
 *                 description: Structured options with pros/cons
 *               urgency:
 *                 type: string
 *                 enum: [blocking, can_continue, informational]
 *                 default: can_continue
 *               expires_at:
 *                 type: string
 *                 format: date-time
 *                 description: Optional expiration timestamp
 *               requested_by_agent_name:
 *                 type: string
 *                 maxLength: 100
 *                 description: Name of the agent requesting
 *     responses:
 *       201:
 *         description: Decision request created
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/DecisionRequest'
 */
router.post('/:id/decisions',
  authenticate,
  ...validate({ params: schemas.decision.planIdParam, body: schemas.decision.createDecisionRequest }),
  decisionController.createDecisionRequest
);

/**
 * @swagger
 * /plans/{id}/decisions/{decisionId}:
 *   put:
 *     summary: Update a decision request (before resolution)
 *     tags: [Decisions]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *       - in: path
 *         name: decisionId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               title:
 *                 type: string
 *               context:
 *                 type: string
 *               options:
 *                 type: array
 *                 items:
 *                   $ref: '#/components/schemas/DecisionOption'
 *               urgency:
 *                 type: string
 *                 enum: [blocking, can_continue, informational]
 *     responses:
 *       200:
 *         description: Updated decision request
 */
router.put('/:id/decisions/:decisionId',
  authenticate,
  ...validate({ params: schemas.decision.decisionIdParam, body: schemas.decision.updateDecisionRequest }),
  decisionController.updateDecisionRequest
);

/**
 * @swagger
 * /plans/{id}/decisions/{decisionId}/resolve:
 *   post:
 *     summary: Resolve a decision request
 *     tags: [Decisions]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *       - in: path
 *         name: decisionId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - decision
 *             properties:
 *               decision:
 *                 type: string
 *                 maxLength: 2000
 *                 description: The decision made
 *               rationale:
 *                 type: string
 *                 maxLength: 5000
 *                 description: Explanation for the decision
 *     responses:
 *       200:
 *         description: Decision resolved
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/DecisionRequest'
 */
router.post('/:id/decisions/:decisionId/resolve',
  authenticate,
  ...validate({ params: schemas.decision.decisionIdParam, body: schemas.decision.resolveDecisionRequest }),
  decisionController.resolveDecisionRequest
);

/**
 * @swagger
 * /plans/{id}/decisions/{decisionId}/cancel:
 *   post:
 *     summary: Cancel a decision request
 *     tags: [Decisions]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *       - in: path
 *         name: decisionId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               reason:
 *                 type: string
 *                 maxLength: 500
 *     responses:
 *       200:
 *         description: Decision cancelled
 */
router.post('/:id/decisions/:decisionId/cancel',
  authenticate,
  ...validate({ params: schemas.decision.decisionIdParam, body: schemas.decision.cancelDecisionRequest }),
  decisionController.cancelDecisionRequest
);

/**
 * @swagger
 * /plans/{id}/decisions/{decisionId}:
 *   delete:
 *     summary: Delete a decision request (plan owners only)
 *     tags: [Decisions]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *       - in: path
 *         name: decisionId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       204:
 *         description: Decision request deleted
 */
router.delete('/:id/decisions/:decisionId',
  authenticate,
  ...validate({ params: schemas.decision.decisionIdParam }),
  decisionController.deleteDecisionRequest
);

module.exports = router;
