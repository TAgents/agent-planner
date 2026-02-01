/**
 * Common validation schemas used across the API
 */

const { z } = require('zod');

// UUID validation (accepts v4 UUIDs)
const uuid = z.string().uuid({ message: 'Invalid UUID format' });

// Optional UUID (can be null or undefined)
const optionalUuid = z.string().uuid().nullable().optional();

// Non-empty string with max length
const nonEmptyString = (maxLength = 1000) =>
  z.string().min(1, 'Field cannot be empty').max(maxLength, `Field cannot exceed ${maxLength} characters`);

// Optional string with max length
const optionalString = (maxLength = 10000) =>
  z.string().max(maxLength, `Field cannot exceed ${maxLength} characters`).optional();

// Positive integer
const positiveInt = z.number().int().min(0);

// Date string (ISO 8601)
const dateString = z.string().datetime({ message: 'Invalid date format. Use ISO 8601 format.' }).optional().nullable();

// Metadata object (flexible JSON)
const metadata = z.record(z.unknown()).optional().default({});

// Pagination parameters
const paginationParams = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(12),
  sort: z.enum(['recent', 'views', 'title']).optional().default('recent')
});

// Boolean query parameter (handles string "true"/"false")
const booleanQuery = z.preprocess(
  (val) => val === 'true' || val === true,
  z.boolean()
).optional();

module.exports = {
  uuid,
  optionalUuid,
  nonEmptyString,
  optionalString,
  positiveInt,
  dateString,
  metadata,
  paginationParams,
  booleanQuery
};
