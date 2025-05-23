# Planning System API

A collaborative planning system that facilitates interactions between humans and AI agents through a unified interface.

## Overview

The Planning System API stores plan data in a Supabase database and provides a REST API for accessing and manipulating plans. The system is designed to enable seamless collaboration between humans and LLM agents, without creating artificial distinctions between them in the architecture.

## Authentication System (April 2025 Update)

The system now uses Supabase's built-in authentication system instead of custom JWTs. This means:

- Authentication tokens come directly from Supabase Auth
- Row Level Security (RLS) policies work correctly with auth.uid()
- The frontend now stores a Supabase session instead of a custom token
- Login and registration flows send back Supabase sessions

This change fixes issues where RLS policies would fail to identify the authenticated user correctly.

## Core Features

- Hierarchical plan structures with phases, tasks, and milestones
- Rich context for AI agent collaboration
- Equal status for human and AI collaborators
- Detailed progress tracking and logging
- Artifact management
- Real-time collaboration

## Getting Started

### Prerequisites

- Node.js 16+
- npm or yarn
- Supabase account

### Installation

1. Clone the repository
```bash
git clone https://github.com/talkingagents/agent-planner.git
cd agent-planner
```

2. Install dependencies
```bash
npm install
```

3. Configure environment variables
```bash
cp .env.example .env
```
Edit the `.env` file with your Supabase credentials and other configuration options.

4. Set up the database

The database needs to be initialized with the correct schema. You have two options:

**Option A: Using the Supabase UI (Recommended)**
```bash
# Run the initialization script to get instructions
npm run db:init
```
Then follow the instructions to manually run the SQL script in the Supabase dashboard.

**Option B: Direct Schema Creation**
1. Go to your Supabase dashboard (https://app.supabase.com/project/_/editor)
2. Navigate to the SQL Editor
3. Copy the contents of `src/db/migrations/00001_initial_schema.sql`
4. Execute the SQL to create all required tables and relations

5. Start the server
```bash
npm run start
```

The API server will be running at http://localhost:3000 by default.

## API Documentation

API documentation is available at http://localhost:3000/api-docs when the server is running.

### Key API Endpoints

- **Authentication**
  - `POST /auth/register` - Register a new user
  - `POST /auth/login` - Login and get authentication token
  - `POST /auth/token` - Create an API token with specific scopes
  - `DELETE /auth/token/:id` - Revoke an API token

- **Plans**
  - `GET /plans` - List all plans accessible to the user
  - `POST /plans` - Create a new plan
  - `GET /plans/:id` - Get a specific plan with its root node
  - `PUT /plans/:id` - Update a plan's properties
  - `DELETE /plans/:id` - Delete a plan (or archive it)

- **Plan Nodes**
  - `GET /plans/:id/nodes` - Get all nodes for a plan (tree structure)
  - `GET /plans/:id/nodes/:nodeId` - Get a specific node
  - `POST /plans/:id/nodes` - Create a new node in a plan
  - `PUT /plans/:id/nodes/:nodeId` - Update a node
  - `DELETE /plans/:id/nodes/:nodeId` - Delete a node
  - `POST /plans/:id/nodes/:nodeId/comments` - Add a comment to a node
  - `GET /plans/:id/nodes/:nodeId/comments` - Get comments for a node

- **Artifacts**
  - `POST /plans/:id/nodes/:nodeId/artifacts` - Add an artifact to a node
  - `GET /plans/:id/nodes/:nodeId/artifacts` - List artifacts for a node
  - `GET /plans/:id/nodes/:nodeId/artifacts/:artifactId` - Get a specific artifact
  - `PUT /plans/:id/nodes/:nodeId/artifacts/:artifactId` - Update an artifact
  - `DELETE /plans/:id/nodes/:nodeId/artifacts/:artifactId` - Delete an artifact
  - `GET /plans/:id/artifacts` - List all artifacts across the plan

- **Activity Tracking**
  - `GET /activity/feed` - Get activity feed for the current user across all plans
  - `GET /plans/:id/activity` - Get all activity logs for a plan with pagination and filtering
  - `GET /plans/:id/timeline` - Get a chronological timeline of significant events for a plan
  - `GET /plans/:id/nodes/:nodeId/activity` - Get recent activity for a specific node
  - `POST /plans/:id/nodes/:nodeId/detailed-log` - Add a detailed activity log with metadata and tags

- **Search and Filtering**
  - `GET /search` - Global search across all accessible resources
  - `GET /plans/:id/nodes/search` - Search for nodes in a plan with advanced filtering
  - `GET /search/artifacts` - Search for artifacts across all accessible plans

## Related Projects

The [Planning System MCP Server](https://github.com/talkingagents/agent-planner-mcp) is a separate project that provides a Model Context Protocol (MCP) interface for AI agents to interact with this API.

## Development Phases

### Phase 1: Core Implementation (Current)
- Set up Supabase database with schema
- Implement user authentication
- Build basic CRUD operations for plans and nodes
- Set up API documentation

### Phase 2: Agent-Human Collaboration Enhancement (Completed)
- ✅ Implement rich context fields and endpoints
- ✅ Add artifact management for tracking outputs and references
- ✅ Fix RLS policy issues for comments, logs, and API keys
- ✅ Improve activity tracking and logging functionality
- ✅ Add status updates and activity feeds
- ✅ Implement advanced filtering and searching capabilities

### Phase 3: Advanced Features
- Implement collaborative workflows
- Add commenting and activity tracking
- Build more sophisticated plan analysis tools
- Implement agent-specific prompts and tools
- Add real-time updates via WebSockets

## Contributing

Please read [CONTRIBUTING.md](CONTRIBUTING.md) for details on our code of conduct and the process for submitting pull requests.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
