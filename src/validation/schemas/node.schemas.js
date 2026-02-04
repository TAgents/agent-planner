/**
 * Validation schemas for Node endpoints
 */

const { z } = require('zod');
const { uuid, optionalUuid, nonEmptyString, optionalString, positiveInt, dateString, metadata, booleanQuery } = require('./common');

// Node type enum
const nodeType = z.enum(['root', 'phase', 'task', 'milestone'], {
  errorMap: () => ({ message: 'Node type must be one of: root, phase, task, milestone' })
});

// Node status enum
const nodeStatus = z.enum(['not_started', 'in_progress', 'completed', 'blocked', 'cancelled'], {
  errorMap: () => ({ message: 'Status must be one of: not_started, in_progress, completed, blocked, cancelled' })
});

// Log type enum
const logType = z.enum(['comment', 'progress', 'reasoning', 'decision', 'blocker', 'resolution'], {
  errorMap: () => ({ message: 'Log type must be one of: comment, progress, reasoning, decision, blocker, resolution' })
});

/**
 * Create node request body
 */
const createNode = z.object({
  parent_id: optionalUuid.describe('Parent node ID (defaults to root node if not provided)'),
  node_type: nodeType.describe('Type of node'),
  title: nonEmptyString(255).describe('Node title'),
  description: optionalString(10000).describe('Node description (include acceptance criteria here)'),
  status: nodeStatus.optional().default('not_started'),
  order_index: positiveInt.optional().describe('Position among siblings'),
  due_date: dateString.describe('Due date in ISO 8601 format'),
  context: optionalString(50000).describe('Additional context for the node'),
  agent_instructions: optionalString(50000).describe('Instructions for AI agents'),
  metadata: metadata
}).strict();

/**
 * Update node request body
 */
const updateNode = z.object({
  node_type: nodeType.optional(),
  title: nonEmptyString(255).optional(),
  description: optionalString(10000),
  status: nodeStatus.optional(),
  order_index: positiveInt.optional(),
  due_date: dateString,
  context: optionalString(50000),
  agent_instructions: optionalString(50000),
  metadata: metadata
}).strict();

/**
 * Move node request body
 */
const moveNode = z.object({
  parent_id: uuid.describe('New parent node ID'),
  order_index: positiveInt.optional().describe('New position among siblings')
}).strict();

/**
 * Batch update nodes request body
 */
const batchUpdateNodes = z.object({
  updates: z.array(
    z.object({
      id: uuid,
      status: nodeStatus.optional(),
      title: nonEmptyString(255).optional(),
      description: optionalString(10000),
      order_index: positiveInt.optional()
    })
  ).min(1, 'At least one update is required').max(100, 'Cannot update more than 100 nodes at once')
}).strict();

// Actor type enum
const actorType = z.enum(['human', 'agent'], {
  errorMap: () => ({ message: 'Actor type must be one of: human, agent' })
});

/**
 * Add log entry request body
 */
const addLog = z.object({
  content: nonEmptyString(50000).describe('Log content'),
  log_type: logType.optional().default('comment'),
  actor_type: actorType.optional().describe('Whether this action was by a human or agent')
}).strict();

/**
 * Get logs query parameters
 */
const getLogsQuery = z.object({
  log_type: logType.optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(50),
  offset: z.coerce.number().int().min(0).optional().default(0)
});

/**
 * Plan and node ID path parameters
 */
const planNodeParams = z.object({
  id: uuid.describe('Plan ID'),
  nodeId: uuid.describe('Node ID')
});

/**
 * Plan ID only parameter
 */
const planIdParam = z.object({
  id: uuid.describe('Plan ID')
});

/**
 * Get nodes query parameters
 */
const getNodesQuery = z.object({
  include_details: booleanQuery
});

module.exports = {
  nodeType,
  nodeStatus,
  logType,
  createNode,
  updateNode,
  moveNode,
  batchUpdateNodes,
  addLog,
  getLogsQuery,
  planNodeParams,
  planIdParam,
  getNodesQuery
};
