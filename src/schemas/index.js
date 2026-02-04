/**
 * @swagger
 * components:
 *   schemas:
 *     Plan:
 *       type: object
 *       required:
 *         - title
 *       properties:
 *         id:
 *           type: string
 *           format: uuid
 *           example: "123e4567-e89b-12d3-a456-426614174000"
 *         title:
 *           type: string
 *           example: "Q1 Product Launch"
 *         description:
 *           type: string
 *           example: "Complete product launch plan for Q1"
 *         status:
 *           type: string
 *           enum: [draft, active, completed, archived]
 *           default: draft
 *         owner_id:
 *           type: string
 *           format: uuid
 *         created_at:
 *           type: string
 *           format: date-time
 *         updated_at:
 *           type: string
 *           format: date-time
 *         metadata:
 *           type: object
 *           additionalProperties: true
 *     
 *     Node:
 *       type: object
 *       required:
 *         - title
 *         - node_type
 *       properties:
 *         id:
 *           type: string
 *           format: uuid
 *         plan_id:
 *           type: string
 *           format: uuid
 *         parent_id:
 *           type: string
 *           format: uuid
 *           nullable: true
 *         node_type:
 *           type: string
 *           enum: [root, phase, task, milestone]
 *         title:
 *           type: string
 *         description:
 *           type: string
 *         status:
 *           type: string
 *           enum: [not_started, in_progress, completed, blocked]
 *           default: not_started
 *         order_index:
 *           type: integer
 *         due_date:
 *           type: string
 *           format: date-time
 *           nullable: true
 *         context:
 *           type: string
 *         agent_instructions:
 *           type: string
 *           nullable: true
 *         metadata:
 *           type: object
 *     
 *     Comment:
 *       type: object
 *       properties:
 *         id:
 *           type: string
 *           format: uuid
 *         plan_node_id:
 *           type: string
 *           format: uuid
 *         user_id:
 *           type: string
 *           format: uuid
 *         content:
 *           type: string
 *         created_at:
 *           type: string
 *           format: date-time
 *         updated_at:
 *           type: string
 *           format: date-time
 *         comment_type:
 *           type: string
 *           enum: [human, agent, system]
 *     
 *     LogEntry:
 *       type: object
 *       properties:
 *         id:
 *           type: string
 *           format: uuid
 *         plan_node_id:
 *           type: string
 *           format: uuid
 *         user_id:
 *           type: string
 *           format: uuid
 *         content:
 *           type: string
 *         log_type:
 *           type: string
 *           enum: [progress, reasoning, challenge, decision]
 *         created_at:
 *           type: string
 *           format: date-time
 *         metadata:
 *           type: object
 *         tags:
 *           type: array
 *           items:
 *             type: string
 *     
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
 *     
 *     ApiToken:
 *       type: object
 *       properties:
 *         id:
 *           type: string
 *           format: uuid
 *         user_id:
 *           type: string
 *           format: uuid
 *         name:
 *           type: string
 *         permissions:
 *           type: array
 *           items:
 *             type: string
 *             enum: [read, write, admin]
 *         created_at:
 *           type: string
 *           format: date-time
 *         last_used:
 *           type: string
 *           format: date-time
 *           nullable: true
 *         revoked:
 *           type: boolean
 *           default: false
 *     
 *     User:
 *       type: object
 *       properties:
 *         id:
 *           type: string
 *           format: uuid
 *         email:
 *           type: string
 *           format: email
 *         name:
 *           type: string
 *         organization:
 *           type: string
 *         created_at:
 *           type: string
 *           format: date-time
 *         updated_at:
 *           type: string
 *           format: date-time
 *     
 *     Error:
 *       type: object
 *       properties:
 *         error:
 *           type: string
 *           description: Error message
 *         details:
 *           type: object
 *           description: Additional error details
 *     
 *     PaginatedResponse:
 *       type: object
 *       properties:
 *         data:
 *           type: array
 *           items:
 *             type: object
 *         pagination:
 *           type: object
 *           properties:
 *             page:
 *               type: integer
 *             limit:
 *               type: integer
 *             total:
 *               type: integer
 *             pages:
 *               type: integer
 */

// Export empty object to make this a valid module
module.exports = {};
