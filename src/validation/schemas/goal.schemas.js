/**
 * Validation schemas for Goal endpoints
 */

const { z } = require('zod');
const { uuid, optionalUuid, nonEmptyString, optionalString } = require('./common');

const goalType = z.enum(['outcome', 'constraint', 'metric', 'principle'], {
  errorMap: () => ({ message: 'type must be one of: outcome, constraint, metric, principle' })
});

const goalKind = z.enum(['desire', 'intention'], {
  errorMap: () => ({ message: 'goalType must be one of: desire, intention' })
});

const goalStatus = z.enum(['draft', 'active', 'achieved', 'paused', 'abandoned', 'archived'], {
  errorMap: () => ({ message: 'status must be one of: draft, active, achieved, paused, abandoned, archived' })
});

// success_criteria is jsonb — array of strings/objects (preferred) or legacy object form
const successCriteria = z.union([
  z.array(z.union([z.string().min(1), z.record(z.string(), z.unknown())])),
  z.record(z.string(), z.unknown()),
  z.null()
]).optional();

const createGoal = z.object({
  title: nonEmptyString(255).describe('Goal title'),
  description: optionalString(10000),
  type: goalType.optional().default('outcome'),
  goalType: goalKind.optional().default('desire'),
  status: goalStatus.optional().default('active'),
  successCriteria: successCriteria,
  priority: z.number().int().min(0).max(10).optional().default(0),
  parentGoalId: optionalUuid,
  organizationId: optionalUuid,
}).strict();

const updateGoal = z.object({
  title: nonEmptyString(255).optional(),
  description: optionalString(10000).nullable(),
  type: goalType.optional(),
  goalType: goalKind.optional(),
  status: goalStatus.optional(),
  successCriteria: successCriteria,
  priority: z.number().int().min(0).max(10).optional(),
  parentGoalId: optionalUuid,
}).strict();

const goalIdParam = z.object({
  id: uuid
});

module.exports = {
  goalType,
  goalKind,
  goalStatus,
  createGoal,
  updateGoal,
  goalIdParam,
};
