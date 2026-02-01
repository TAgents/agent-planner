/**
 * Validation schemas for Plan endpoints
 */

const { z } = require('zod');
const { uuid, nonEmptyString, optionalString, metadata, paginationParams, booleanQuery } = require('./common');

// Plan status enum
const planStatus = z.enum(['draft', 'active', 'completed', 'archived'], {
  errorMap: () => ({ message: 'Status must be one of: draft, active, completed, archived' })
});

// Plan visibility enum
const planVisibility = z.enum(['private', 'public'], {
  errorMap: () => ({ message: 'Visibility must be either private or public' })
});

/**
 * Create plan request body
 */
const createPlan = z.object({
  title: nonEmptyString(255).describe('Plan title'),
  description: optionalString(5000).describe('Plan description'),
  status: planStatus.optional().default('draft'),
  metadata: metadata
}).strict();

/**
 * Update plan request body
 */
const updatePlan = z.object({
  title: nonEmptyString(255).optional(),
  description: optionalString(5000),
  status: planStatus.optional(),
  metadata: metadata
}).strict();

/**
 * Plan visibility update
 */
const updateVisibility = z.object({
  visibility: planVisibility.optional(),
  is_public: z.boolean().optional(), // Backward compatibility
  github_repo_owner: z.string().max(100).nullable().optional(),
  github_repo_name: z.string().max(100).nullable().optional()
}).refine(
  (data) => data.visibility !== undefined || data.is_public !== undefined,
  { message: 'Either visibility or is_public must be provided' }
);

/**
 * Plan ID path parameter
 */
const planIdParam = z.object({
  id: uuid
});

/**
 * Public plans query parameters
 */
const publicPlansQuery = paginationParams;

/**
 * Delete plan query parameters
 */
const deletePlanQuery = z.object({
  archive: booleanQuery
});

/**
 * Add collaborator request body
 */
const addCollaborator = z.object({
  user_id: uuid,
  role: z.enum(['admin', 'editor', 'viewer'], {
    errorMap: () => ({ message: 'Role must be one of: admin, editor, viewer' })
  })
}).strict();

/**
 * Update collaborator role
 */
const updateCollaboratorRole = z.object({
  role: z.enum(['admin', 'editor', 'viewer'], {
    errorMap: () => ({ message: 'Role must be one of: admin, editor, viewer' })
  })
}).strict();

/**
 * Collaborator ID parameter
 */
const collaboratorIdParam = z.object({
  id: uuid,
  collaboratorId: uuid
});

module.exports = {
  planStatus,
  planVisibility,
  createPlan,
  updatePlan,
  updateVisibility,
  planIdParam,
  publicPlansQuery,
  deletePlanQuery,
  addCollaborator,
  updateCollaboratorRole,
  collaboratorIdParam
};
