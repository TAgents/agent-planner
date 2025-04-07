# Planning System API: Technical Design Document

## Known Issues and Solutions

### UI and API Integration

1. **Plan Creation and Listing Issue**
   - **Problem**: When creating plans or listing plans in the UI, users may encounter a "Request failed with status code 400" error with the message "new row violates row-level security policy for table plans."
   - **Root Cause**: Supabase Row Level Security (RLS) policies require auth.uid() to be properly set for the database operations.
   - **Solution**:
     - The system now uses Supabase's built-in authentication system instead of custom JWTs
     - Authentication tokens come directly from Supabase Auth
     - The frontend stores a Supabase session instead of a custom token
     - The backend properly passes the user's session token to Supabase to ensure auth.uid() is set correctly
   - **Best Practice**: Ensure the Supabase session token is properly stored after login and included in all API requests.

2. **API Response Format Inconsistency**
   - **Problem**: The API endpoints return inconsistent response formats - some return direct arrays/objects, while the UI expects paginated responses with `data`, `total`, etc. properties.
   - **Root Cause**: The backend API was developed without standardized response formats.
   - **Solution**: 
     - The UI has been updated to handle both formats (direct arrays/objects and paginated responses)
     - For a more maintainable solution, consider standardizing all API responses to follow the same structure
   - **Best Practice**: When extending the API, follow a consistent response format for all endpoints.


## System Overview

The Planning System API facilitates collaborative planning between humans and AI agents through a unified interface. The system stores plan data in a Supabase database and provides a REST API for accessing and manipulating plans. A key focus is enabling seamless collaboration between humans and LLM agents, without creating artificial distinctions between them in the system architecture.

## Core Concepts

- **Plans**: Hierarchical structures with a root definition and branching phases/tasks
- **Users**: Human users or AI agents who own or collaborate on plans
- **Access Control**: Permissions system to manage who can view or edit plans
- **Contextual Richness**: Detailed context to enable effective agent-human collaboration
- **Artifacts**: Resources, code, documentation, and other outputs related to plan execution

## Implementation Status

The project is currently in Phase 1, with core functionality implemented. The following components are complete:

- ✅ Database schema with Supabase integration
- ✅ User authentication and API token management
- ✅ Basic CRUD operations for plans and nodes
- ✅ Plan collaboration system
- ✅ Node hierarchy with parent-child relationships
- ✅ Comments and activity logging for nodes
- ✅ API documentation with Swagger/OpenAPI

## Database Schema

### Tables

#### 1. `users`
```
id: uuid (primary key)
email: text (unique)
created_at: timestamp
updated_at: timestamp
name: text
```

#### 2. `plans`
```
id: uuid (primary key)
title: text
description: text
owner_id: uuid (foreign key to users.id)
created_at: timestamp
updated_at: timestamp
status: text (enum: 'draft', 'active', 'completed', 'archived')
metadata: jsonb (for flexible extension)
```

#### 3. `plan_nodes` (Enhanced for agent collaboration)
```
id: uuid (primary key)
plan_id: uuid (foreign key to plans.id)
parent_id: uuid (foreign key to plan_nodes.id, null for root nodes)
node_type: text (enum: 'root', 'phase', 'task', 'milestone')
title: text
description: text
status: text (enum: 'not_started', 'in_progress', 'completed', 'blocked')
order_index: integer (for ordering siblings)
due_date: timestamp (nullable)
created_at: timestamp
updated_at: timestamp
context: text (longer, more detailed information for agents)
agent_instructions: text (nullable, specific instructions for agents)
acceptance_criteria: text (nullable, clear criteria for completion)
metadata: jsonb (for flexible extension)
```

#### 4. `plan_collaborators`
```
id: uuid (primary key)
plan_id: uuid (foreign key to plans.id)
user_id: uuid (foreign key to users.id)
role: text (enum: 'viewer', 'editor', 'admin')
created_at: timestamp
```

#### 5. `plan_comments` (Enhanced for agent-human interaction)
```
id: uuid (primary key)
plan_node_id: uuid (foreign key to plan_nodes.id)
user_id: uuid (foreign key to users.id)
content: text
created_at: timestamp
updated_at: timestamp
comment_type: text (enum: 'human', 'agent', 'system')
```

#### 6. `api_keys`
```
id: uuid (primary key)
user_id: uuid (foreign key to users.id)
name: text
key_hash: text
created_at: timestamp
expires_at: timestamp (nullable)
scopes: text[] (array of permission scopes)
```

#### 7. `plan_node_labels` (New: for categorization)
```
id: uuid (primary key)
plan_node_id: uuid (foreign key to plan_nodes.id)
label: text
```

#### 8. `plan_node_artifacts` (New: for storing outputs and references)
```
id: uuid (primary key)
plan_node_id: uuid (foreign key to plan_nodes.id)
name: text
content_type: text
url: text (could be a file reference, git commit, etc.)
created_at: timestamp
created_by: uuid (foreign key to users.id)
metadata: jsonb
```

#### 9. `plan_node_logs` (New: for tracking agent activity)
```
id: uuid (primary key)
plan_node_id: uuid (foreign key to plan_nodes.id)
user_id: uuid (foreign key to users.id)
content: text
log_type: text (enum: 'progress', 'reasoning', 'challenge', 'decision')
created_at: timestamp
```

## API Endpoints

All endpoints below have been implemented with full functionality in Phase 1.

### Authentication

- `POST /auth/register` - Register a new user
- `POST /auth/login` - Login and get authentication token
- `POST /auth/token` - Create an API token with specific scopes
- `DELETE /auth/token/:id` - Revoke an API token

### Plans

- `GET /plans` - List all plans accessible to the user
- `POST /plans` - Create a new plan
- `GET /plans/:id` - Get a specific plan with its root node
- `PUT /plans/:id` - Update a plan's properties
- `DELETE /plans/:id` - Delete a plan (or archive it)
- `GET /plans/:id/collaborators` - List collaborators on a plan
- `POST /plans/:id/collaborators` - Add a collaborator to a plan
- `DELETE /plans/:id/collaborators/:userId` - Remove a collaborator from a plan
- `GET /plans/:id/context` - Get a compiled context of the entire plan suitable for agents

### Plan Nodes

- `GET /plans/:id/nodes` - Get all nodes for a plan (tree structure)
- `GET /plans/:id/nodes/:nodeId` - Get a specific node
- `POST /plans/:id/nodes` - Create a new node in a plan
- `PUT /plans/:id/nodes/:nodeId` - Update a node
- `DELETE /plans/:id/nodes/:nodeId` - Delete a node
- `POST /plans/:id/nodes/:nodeId/comments` - Add a comment to a node
- `GET /plans/:id/nodes/:nodeId/comments` - Get comments for a node
- `GET /plans/:id/nodes/:nodeId/context` - Get detailed context for a specific node
- `GET /plans/:id/nodes/:nodeId/ancestry` - Get the path from root to this node with context

### Node Operations

- `PUT /plans/:id/nodes/:nodeId/status` - Update the status of a node
- `POST /plans/:id/nodes/:nodeId/move` - Move a node to a different parent or position
- `POST /plans/:id/nodes/:nodeId/log` - Add a progress log entry (for tracking agent activity)
- `GET /plans/:id/nodes/:nodeId/logs` - Get activity logs for a node

### Artifact Management

- `POST /plans/:id/nodes/:nodeId/artifacts` - Add an artifact to a node
- `GET /plans/:id/nodes/:nodeId/artifacts` - List artifacts for a node
- `GET /plans/:id/artifacts` - List all artifacts across the plan

## Design Principles for Agent-Human Integration

### 1. Contextual Richness

Agents require rich context to operate effectively. Each node maintains:
- Clear objectives
- Background information
- Constraints and requirements
- Related resources
- Priority and importance
- Historical context (previous attempts, decisions)

### 2. Clear Instructions

For each actionable node:
- Explicit instructions on what needs to be done
- Clear acceptance criteria
- Examples if applicable
- Common pitfalls to avoid
- Reference materials 

### 3. Progress Tracking

Agents can:
- Report incremental progress
- Log their reasoning and decision process
- Record challenges encountered
- Document resources used or created

### 4. Consistent Data Format

- All data is structured consistently
- Fields have clear semantic meaning
- Metadata follows consistent patterns
- Text fields use a consistent format (Markdown preferred)

## API Design Principles

1. **RESTful Design**
   - Consistent URI patterns
   - Appropriate HTTP methods
   - Proper status codes

2. **Authentication & Authorization**
   - JWT-based authentication
   - Scope-based permissions model
   - Fine-grained access control
   - Same authentication mechanism for both humans and agents

3. **Response Format**
   - Consistent JSON structure
   - Error handling with appropriate status codes and messages
   - Pagination for list endpoints
   - Endpoints provide comprehensive context in a single request when possible

4. **Versioning**
   - API versioning to support evolution
   - Backward compatibility

## Example Use Cases

1. **Context-Aware Code Generation**
   An LLM agent can fetch the full context of a task, including its parent phases, related artifacts, and acceptance criteria, then generate code that meets all requirements.

2. **Collaborative Problem Solving**
   Multiple agents can work on different aspects of a plan, logging their progress and findings, which other agents and humans can build upon.

3. **Review and Validation**
   An agent can check completed work against acceptance criteria, suggesting improvements or approving the work.

4. **Documentation Generation**
   Agents can generate documentation by pulling context from the plan structure, ensuring alignment with the original objectives.

5. **Progress Monitoring**
   Humans can monitor agent progress through detailed logs and progress updates, stepping in when necessary.

## Development Phases

### Phase 1: Core Implementation ✅ (COMPLETED)
- ✅ Set up Supabase database with schema
- ✅ Implement user authentication
- ✅ Build basic CRUD operations for plans and nodes
- ✅ Set up API documentation
- ✅ Implement plan collaboration management
- ✅ Create node hierarchical structure
- ✅ Add comment and activity logging functionality

### Phase 2: Agent-Human Collaboration Enhancement ✅ (COMPLETED)
- ✅ Implement rich context fields and endpoints
- ✅ Add artifact management
- ✅ Enhance progress tracking and logging functionality
- ✅ Add status updates and activity feeds
- ✅ Implement advanced filtering and searching capabilities

### Phase 3: Advanced Features (FUTURE)
- Implement collaborative workflows
- Add more sophisticated plan analysis tools
- Implement agent-specific prompts and tools
- Add real-time updates via WebSockets
- Implement advanced analytics and reporting

## Current Technical Stack

- **Backend**: Node.js with Express
- **Database**: Supabase (PostgreSQL)
- **Authentication**: JWT with Supabase Auth integration
- **Documentation**: OpenAPI/Swagger

## Security Considerations

- All data transmitted via HTTPS
- Supabase Auth for secure authentication
- API tokens with scoped permissions
- Row-level security in Supabase
  - Supabase Auth ensures auth.uid() is properly set for RLS policies
  - Access to plans and nodes is restricted to owners and collaborators only
- Audit logging for sensitive operations
- Rate limiting to prevent abuse
- Clear attribution of actions (human vs agent)

This implementation provides a solid foundation for a collaborative planning system that treats humans and AI agents as equal participants. The hierarchical structure of plans and rich contextual information allows for complex planning scenarios while maintaining a clear organizational structure.

## Integration with MCP

The Planning System API is designed to work with the separate [Planning System MCP Server](https://github.com/talkingagents/agent-planner-mcp) project, which provides a Model Context Protocol interface for AI agents to interact with the planning system.
