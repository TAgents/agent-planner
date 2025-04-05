# Project Tasks

This document outlines identified issues and planned improvements for the agent-planner backend codebase. Items are organized into bugs/inconsistencies that should be addressed for correctness and stability, and improvements/refactoring efforts to enhance maintainability, performance, and features.

## Bugs / Inconsistencies (Priority: High)

These items address potential errors, security vulnerabilities, or inconsistent behavior.

-   [x] **Resolve API Key Hashing Inconsistency:**
    -   [x] Remove JWT-based hashing (`jwt.sign`) for API keys in `src/controllers/auth.controller.js`.
    -   [x] Standardize on `crypto.createHash('sha256')` for hashing API tokens/keys in all relevant controllers and database schemas.
    -   [x] Ensure alignment between `token.controller.js` and the `api_tokens` table schema.
-   [x] **Clarify and Consolidate Database Migrations:**
    -   [x] Resolve the naming conflict and potential overlap between `00003_activity_and_search_updates.sql` and `00003_api_tokens.sql`. Ensure migrations are linear.
    -   [x] Determine if `api_tokens` replaces `api_keys`. Update migrations and controllers accordingly (likely deprecate/remove `api_keys` table and related logic in `auth.controller.js`).
    -   [x] Remove any duplicated schema alterations within migrations (e.g., `metadata`/`tags` on `plan_node_logs`).
-   [ ] **Implement Database Transactions for Atomic Operations:**
    -   [ ] Refactor `plan.controller.js -> createPlan` to use a transaction (e.g., via Supabase RPC) ensuring plan and root node are created atomically.
    -   [ ] Refactor `node.controller.js -> deleteNode` to use a transaction ensuring the node and all its related data (comments, logs, artifacts, children) are deleted atomically.
    -   [ ] Refactor `plan.controller.js -> deletePlan` to use a transaction ensuring the plan and all its associated data are deleted atomically.
-   [ ] **Review and Secure `checkPlanAccess` Logic:**
    -   [ ] Audit all call sites of the `checkPlanAccess` helper function.
    -   [ ] Ensure explicit, appropriate roles (`['owner', 'admin', 'editor']` etc.) are *always* passed when checking access for mutating operations.
    -   [ ] Modify `checkPlanAccess` to have a safer default behavior if `roles` array is empty or consider making the `roles` parameter mandatory for mutating checks.
-   [ ] **Remove Redundant API Routes:**
    -   [ ] Choose a canonical route structure for accessing plan-related resources (e.g., consistently use `/plans/:id/...`).
    -   [ ] Remove duplicate routes identified in `activity.routes.js` (e.g., `/activity/plan/:id/activity`).
-   [ ] **Graceful Handling of Configuration Errors:**
    -   [ ] Modify `src/config/supabase.js` to `throw new Error(...)` instead of `process.exit(1)` if required environment variables are missing.
    -   [ ] Ensure the main application startup logic in `src/index.js` catches and handles these configuration errors gracefully (e.g., log error and exit cleanly).


## Improvements / Refactoring (Priority: Medium/Low)

These items focus on improving code quality, performance, maintainability, and developer experience.

-   [ ] **Implement Robust Input Validation:**
    -   [ ] Introduce a validation library (e.g., `zod`, `joi`, `express-validator`).
    -   [ ] Apply validation rules to request bodies, query parameters, and path parameters in all route handlers (`*.routes.js` or controllers).
-   [ ] **Enhance Centralized Error Handling:**
    -   [ ] Refine the global error handling middleware (`src/index.js`) to provide consistent JSON error responses.
    -   [ ] Differentiate error responses based on error types (e.g., validation errors (400), auth errors (401/403), not found (404), server errors (500)).
-   [ ] **Introduce a Service Layer:**
    -   [ ] Create a `src/services/` directory.
    -   [ ] Refactor controllers to delegate business logic and direct database interactions (Supabase calls) to service modules (e.g., `PlanService`, `NodeService`, `AuthService`).
-   [ ] **Database Performance Optimization:**
    -   [ ] Analyze performance of complex queries (e.g., `globalSearch`, `getUserActivityFeed`, `getPlanTimeline`).
    -   [ ] Consider creating Supabase RPC functions (PL/pgSQL) to perform heavy lifting (joins, aggregations, searches) within the database for these complex queries.
    -   [ ] Review existing database indexes and add/modify indexes as needed based on query performance analysis (`EXPLAIN ANALYZE`).
-   [ ] **Implement Comprehensive Testing:**
    -   [ ] Write unit tests for utility functions (`src/utils/`) and service layer functions (mocking database interactions).
    -   [ ] Write integration tests for key API endpoints, setting up and tearing down test data in a dedicated test Supabase project or schema.
-   [ ] **Centralize Configuration and Constants:**
    -   [ ] Create a dedicated configuration module/file (e.g., `src/config/constants.js`).
    -   [ ] Move hardcoded values like pagination defaults, allowed roles, statuses, node types, log types, etc., to this central location.
-   [ ] **Improve Logging:**
    -   [ ] Update `src/utils/logger.js` to support structured logging (output JSON format).
    -   [ ] Implement distinct log levels (e.g., `debug`, `info`, `warn`, `error`) and allow configuration via environment variables.
    -   [ ] Investigate log rotation strategies if log files are expected to grow significantly.
-   [ ] **Security Hardening:**
    -   [ ] Implement rate limiting on sensitive endpoints, particularly `/auth/login` and `/auth/register`.
    -   [ ] Conduct a thorough review of all Row Level Security (RLS) policies in the SQL migration files for correctness and completeness.
    -   [ ] Verify that all potentially sensitive information is correctly redacted in debug logs (`debug.middleware.js`).
-   [ ] **Dependency Management Strategy:**
    -   [ ] Establish a regular process (e.g., quarterly) for reviewing outdated dependencies (`npm outdated`).
    -   [ ] Plan and execute updates for dependencies, especially those with security vulnerabilities.
-   [ ] **Code Style and Documentation:**
    -   [ ] Ensure consistent code style (consider using Prettier and ESLint).
    -   [ ] Improve inline code comments (JSDoc) for complex functions and modules.
    -   [ ] Update Swagger documentation (`*.routes.js`) to accurately reflect any API changes made.