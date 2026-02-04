/**
 * Zod validation schemas for Decision Requests
 */

const { z } = require('zod');

// Urgency levels
const urgency = z.enum(['blocking', 'can_continue', 'informational'], {
  errorMap: () => ({ message: 'Urgency must be one of: blocking, can_continue, informational' })
});

// Decision status
const status = z.enum(['pending', 'decided', 'expired', 'cancelled'], {
  errorMap: () => ({ message: 'Status must be one of: pending, decided, expired, cancelled' })
});

// Option structure for decision requests
const decisionOption = z.object({
  option: z.string().min(1).max(500).describe('The option being proposed'),
  pros: z.array(z.string().max(500)).optional().describe('Advantages of this option'),
  cons: z.array(z.string().max(500)).optional().describe('Disadvantages of this option'),
  recommendation: z.boolean().optional().describe('Whether this is the recommended option')
}).strict();

// UUID validation
const uuid = z.string().uuid();

// Plan ID param
const planIdParam = z.object({
  id: uuid.describe('Plan UUID')
});

// Decision request ID param
const decisionIdParam = z.object({
  id: uuid.describe('Plan UUID'),
  decisionId: uuid.describe('Decision request UUID')
});

// Metadata with size limit (max 10KB when stringified)
const metadataWithSizeLimit = z.record(z.any()).optional()
  .refine(
    (val) => !val || JSON.stringify(val).length <= 10240,
    { message: 'Metadata must be less than 10KB' }
  )
  .describe('Additional metadata (max 10KB)');

// Create decision request
const createDecisionRequest = z.object({
  node_id: uuid.optional().describe('Optional node UUID this decision relates to'),
  title: z.string().min(1).max(200).describe('Brief title for the decision'),
  context: z.string().min(1).max(5000).describe('Full context explaining what needs to be decided'),
  options: z.array(decisionOption).max(10).optional().describe('Structured options with pros/cons'),
  urgency: urgency.optional().default('can_continue').describe('How urgent is this decision'),
  expires_at: z.string().datetime().optional().describe('Optional expiration timestamp'),
  requested_by_agent_name: z.string().max(100).optional().describe('Name of the agent requesting'),
  metadata: metadataWithSizeLimit
}).strict();

// Update decision request (for adding more context)
const updateDecisionRequest = z.object({
  title: z.string().min(1).max(200).optional(),
  context: z.string().min(1).max(5000).optional(),
  options: z.array(decisionOption).max(10).optional(),
  urgency: urgency.optional(),
  expires_at: z.string().datetime().optional().nullable(),
  metadata: z.record(z.any()).optional()
}).strict();

// Resolve decision request
const resolveDecisionRequest = z.object({
  decision: z.string().min(1).max(2000).describe('The decision made'),
  rationale: z.string().max(5000).optional().describe('Explanation for the decision')
}).strict();

// Cancel decision request
const cancelDecisionRequest = z.object({
  reason: z.string().max(500).optional().describe('Reason for cancellation')
}).strict();

// Query params for listing
const listDecisionRequests = z.object({
  status: status.optional().describe('Filter by status'),
  urgency: urgency.optional().describe('Filter by urgency'),
  node_id: uuid.optional().describe('Filter by node'),
  limit: z.coerce.number().int().min(1).max(100).optional().default(50),
  offset: z.coerce.number().int().min(0).optional().default(0)
}).strict();

module.exports = {
  planIdParam,
  decisionIdParam,
  createDecisionRequest,
  updateDecisionRequest,
  resolveDecisionRequest,
  cancelDecisionRequest,
  listDecisionRequests,
  // Re-export for direct use
  urgency,
  status,
  decisionOption
};
