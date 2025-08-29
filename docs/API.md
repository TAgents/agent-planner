# Agent Planner API

Version: 1.0.0

A collaborative planning system for humans and AI agents

## Base URL

- Current environment: http://localhost:3000
- Local development: http://localhost:3000
- Production: https://api.agent-planner.com

## Authentication

This API supports two authentication methods:
- **Bearer Token**: Include JWT token in Authorization header
- **API Key**: Include API key in Authorization header (format: ApiKey <token>)

## Endpoints


### Activity

#### GET /activity/feed
Get activity feed for the current user across all accessible plans

#### GET /activity/plans/{id}/activity
Get all activity logs for a plan

#### GET /activity/plans/{id}/timeline
Get a chronological timeline of significant events for a plan

#### GET /activity/plans/{id}/nodes/{nodeId}/activity
Get recent activity for a specific node

#### POST /activity/plans/{id}/nodes/{nodeId}/detailed-log
Add a detailed activity log entry with metadata and tags


### Artifacts

#### POST /plans/{id}/nodes/{nodeId}/artifacts
Add an artifact to a node

#### GET /plans/{id}/nodes/{nodeId}/artifacts
List artifacts for a node

#### GET /plans/{id}/nodes/{nodeId}/artifacts/{artifactId}
Get a specific artifact

#### PUT /plans/{id}/nodes/{nodeId}/artifacts/{artifactId}
Update an artifact

#### DELETE /plans/{id}/nodes/{nodeId}/artifacts/{artifactId}
Delete an artifact

#### GET /plans/{id}/artifacts
List all artifacts across the plan

#### GET /api/artifacts/download
Download an artifact file

#### GET /download
Download an artifact file


### Authentication

#### POST /auth/register
Register a new user

#### POST /auth/login
Login and get authentication token

#### POST /auth/logout
Logout user

#### POST /auth/forgot-password
Request password reset email

#### POST /auth/reset-password
Reset password with token

#### POST /auth/verify-email
Verify email with token

#### POST /auth/resend-verification
Resend verification email

#### GET /auth/profile
Get current user profile

#### PUT /auth/profile
Update user profile

#### POST /auth/change-password
Change user password

#### GET /auth/token
List all API tokens for the current user

#### POST /auth/token
Create an API token with specific scopes

#### DELETE /auth/token/{id}
Revoke an API token


### Collaboration

#### GET /plans/{id}/active-users
Get currently active users in a plan

#### POST /plans/{id}/presence
Update user presence in a plan

#### GET /plans/{id}/nodes/{nodeId}/active-users
Get active and typing users for a specific node


### Debug

#### GET /debug/tokens
Debug endpoint to view all tokens for current user including revoked ones


### Nodes

#### GET /plans/{id}/nodes
Get all nodes for a plan (tree structure)

#### POST /plans/{id}/nodes
Create a new node in a plan

#### GET /plans/{id}/nodes/{nodeId}
Get a specific node

#### PUT /plans/{id}/nodes/{nodeId}
Update a node

#### DELETE /plans/{id}/nodes/{nodeId}
Delete a node

#### POST /plans/{id}/nodes/{nodeId}/comments
Add a comment to a node

#### GET /plans/{id}/nodes/{nodeId}/comments
Get comments for a node

#### GET /plans/{id}/nodes/{nodeId}/context
Get detailed context for a specific node

#### GET /plans/{id}/nodes/{nodeId}/ancestry
Get the path from root to this node with context

#### PUT /plans/{id}/nodes/{nodeId}/status
Update the status of a node

#### POST /plans/{id}/nodes/{nodeId}/move
Move a node to a different parent or position

#### POST /plans/{id}/nodes/{nodeId}/log
Add a progress log entry (for tracking agent activity)

#### GET /plans/{id}/nodes/{nodeId}/logs
Get activity logs for a node

#### GET /plans/{id}/nodes/{nodeId}/assignments
Get all user assignments for a node

#### POST /plans/{id}/nodes/{nodeId}/assign
Assign a user to a node

#### DELETE /plans/{id}/nodes/{nodeId}/unassign
Unassign a user from a node

#### GET /plans/{id}/nodes/{nodeId}/activities
Get all activities for a node (logs, status changes, assignments, files)


### Plans

#### GET /plans/{id}/available-users
Get all users available for assignment (plan collaborators)

#### GET /plans
List all plans accessible to the user

#### POST /plans
Create a new plan

#### GET /plans/{id}
Get a specific plan with its root node

#### PUT /plans/{id}
Update a plan's properties

#### DELETE /plans/{id}
Delete a plan (or archive it)

#### GET /plans/{id}/collaborators
List collaborators on a plan

#### POST /plans/{id}/collaborators
Add a collaborator to a plan

#### DELETE /plans/{id}/collaborators/{userId}
Remove a collaborator from a plan

#### GET /plans/{id}/context
Get a compiled context of the entire plan suitable for agents

#### GET /plans/{id}/progress
Get progress statistics for a plan


### Search

#### GET /search
Global search across all accessible resources

#### GET /plans/{id}/nodes/search
Search for nodes in a specific plan with filtering

#### GET /artifacts/search
Search for artifacts across all accessible plans

#### GET /search/plan/{plan_id}
Search within a plan using the database search function


### Upload

#### POST /upload/avatar
Upload user avatar

#### DELETE /upload/avatar
Delete user avatar


### Users

#### GET /users
List all users

#### GET /users/search
Search users by name or email


### System

#### GET /
API root endpoint

#### GET /health
Health check endpoint

Used by monitoring services and orchestration platforms (e.g., Cloud Run) to verify the service is running

#### GET /api-docs
Interactive API documentation

Swagger UI interface for exploring and testing the API

#### GET /api-docs-json
OpenAPI specification in JSON format

