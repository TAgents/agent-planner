# AgentPlanner API v2.0

A collaborative planning system for humans and AI agents. Features dependency graph with cycle detection, progressive context engine with token budgeting, RPI (Research/Plan/Implement) task chains, and reasoning services for automated scheduling and impact analysis.

## Overview

AgentPlanner stores plans as hierarchical trees of nodes (phases, tasks, milestones) in PostgreSQL, connected by a dependency graph. AI agents access plans through the MCP protocol or REST API, and receive exactly the right amount of context via the progressive context engine. The system is designed for seamless human-AI collaboration without architectural distinctions between them.

## Core Features

- **Hierarchical plans** with phases, tasks, milestones, and flexible tree structure
- **Dependency graph** with cycle detection, upstream/downstream traversal, impact analysis, and critical path
- **Progressive context engine** with 4-layer depth and token budgeting for efficient agent context loading
- **RPI chains** (Research/Plan/Implement) with automatic dependency wiring and research output compaction
- **Reasoning services** for status propagation, bottleneck detection, topological scheduling, and decomposition alerts
- **Real-time collaboration** via WebSocket with presence tracking and plan change broadcasts
- **MCP integration** for AI agents via stdio or HTTP/SSE transport
- **Knowledge stores** for capturing decisions, learnings, and constraints
- **Secure authentication** with JWT and API tokens

## Getting Started

### Prerequisites

- Node.js 16+ 
- npm or yarn
- Supabase account

### Installation

1. **Clone the repository**
```bash
git clone https://github.com/talkingagents/agent-planner.git
cd agent-planner
```

2. **Install dependencies**
```bash
npm install
```

3. **Configure environment variables**
```bash
cp .env.example .env
```
Edit the `.env` file with your Supabase credentials:
- `SUPABASE_URL` - Your Supabase project URL (API URL, not database URL)
- `SUPABASE_ANON_KEY` - Your Supabase anonymous key
- `SUPABASE_SERVICE_KEY` - Your Supabase service role key
- `DATABASE_URL` - PostgreSQL connection string (required for migrations)
- `JWT_SECRET` - Secret for JWT token generation

**For local Supabase:**
```env
SUPABASE_URL=http://127.0.0.1:54321
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres
```

**For hosted Supabase:**
```env
SUPABASE_URL=https://your-project.supabase.co
DATABASE_URL=postgresql://postgres:[password]@db.your-project.supabase.co:5432/postgres
```

4. **Set up the database**

Initialize the database schema by running migrations:

```bash
npm run db:init
```

This will:
- Apply all database migrations automatically
- Create the admin user (`admin@example.com` / `password123`) if no users exist
- Track which migrations have been applied

5. **Start the server**
```bash
# Development mode with hot reload
npm run dev

# Production mode
npm start
```

The API server will be running at http://localhost:3000

## 📚 API Documentation

### Interactive Documentation
When the server is running, comprehensive API documentation is available at:
- **Swagger UI**: http://localhost:3000/api-docs - Interactive API explorer with try-it-out functionality
- **OpenAPI Spec**: http://localhost:3000/api-docs-json - Raw OpenAPI specification

### Generating Documentation

The API documentation is automatically generated from code annotations:

```bash
# Generate documentation in multiple formats (JSON, YAML, Markdown)
npm run docs:generate

# Validate that all endpoints are properly documented
npm run docs:validate

# Generate and validate in one command
npm run docs:all
```

Generated documentation files are saved in the `docs/` directory:
- `docs/openapi.json` - OpenAPI 3.0 specification
- `docs/openapi.yaml` - YAML version of the specification  
- `docs/API.md` - Markdown documentation

### Authentication

The API supports two authentication methods:

1. **Bearer Token (Supabase JWT)**
```bash
Authorization: Bearer <supabase_jwt_token>
```

2. **API Key**
```bash
Authorization: ApiKey <api_token>
```

## Development

### Available Scripts

```bash
npm run dev              # Start development server with nodemon
npm run start            # Start production server
npm run test             # Run test suite
npm run lint             # Run ESLint
npm run db:init          # Initialize database schema
npm run docs:generate    # Generate API documentation
npm run docs:validate    # Validate API documentation
npm run docs:all         # Generate and validate documentation
```

### Project Structure

```
agent-planner/
├── src/
│   ├── index.js              # Express app, middleware, route mounting, WebSocket init
│   ├── config/
│   │   └── swagger.js        # OpenAPI/Swagger configuration (v2.0)
│   ├── controllers/          # Request handling (v2 current, v1 legacy)
│   ├── routes/               # Express routers with Swagger JSDoc annotations
│   │   ├── dependency.routes.js   # Dependency graph endpoints
│   │   ├── reasoning.routes.js    # Bottleneck, RPI chains, scheduling
│   │   ├── context.routes.js      # Progressive context + suggest + compact
│   │   └── ...
│   ├── services/             # Business logic services
│   │   ├── contextEngine.js  # Progressive context assembly (4 layers)
│   │   ├── compaction.js     # Research output compaction
│   │   ├── reasoning.js      # Status propagation, bottlenecks, scheduling
│   │   ├── messageBus.js     # PostgreSQL LISTEN/NOTIFY event bus
│   │   └── ...
│   ├── db/
│   │   ├── schema/*.mjs      # Drizzle ORM table definitions
│   │   ├── dal/*.mjs         # Data Access Layer modules (18 files)
│   │   ├── dal.cjs           # CJS/ESM bridge proxy
│   │   └── sql/*.sql         # Migration files
│   ├── middleware/            # Auth, rate limiting, debug
│   ├── adapters/              # Notification adapters (Slack, Webhook, Console)
│   └── websocket/             # Real-time collaboration
├── docs/                      # Documentation (API.md, ARCHITECTURE.md, etc.)
├── scripts/                   # Migration runner, doc generation
└── tests/                     # Jest + Supertest test suites
```

### Adding New Endpoints

When adding new API endpoints:

1. Create the route with full Swagger annotations:
```javascript
/**
 * @swagger
 * /your-endpoint:
 *   get:
 *     summary: Brief description
 *     tags: [Category]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Success response
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/YourSchema'
 */
router.get('/your-endpoint', authenticate, controller.method);
```

2. Regenerate documentation:
```bash
npm run docs:all
```

## Database Schema

The system uses PostgreSQL 17 (with pgvector) via Drizzle ORM. Main tables:

- `users` - User accounts
- `plans` - Plan definitions (visibility: private/public/unlisted)
- `plan_nodes` - Hierarchical plan structure (node_type, status, task_mode, agent_instructions)
- `node_dependencies` - Dependency edges (blocks/requires/relates_to) with cycle detection
- `plan_collaborators` - User access to plans with roles (owner/admin/editor/viewer)
- `plan_node_logs` - Activity logs (progress/reasoning/challenge/decision/comment)
- `plan_comments` - Comments on nodes
- `api_tokens` - API tokens (SHA-256 hashed)
- `node_assignments` - User assignments to nodes
- `decisions` - Decision requests and resolutions
- `knowledge_entries` - Knowledge store with vector embeddings
- `goals` - Goals and goal-plan links
- `organizations` - Multi-tenant organizations
- `user_presence` - Real-time presence tracking
- `audit_logs` - Activity audit trail
- `schema_migrations` - Migration tracking

### Database Migrations

The system uses an incremental migration system:
- Migration files in `src/db/sql/` with numeric prefixes (e.g., `00001_*.sql`)
- `schema_migrations` table tracks which migrations have been applied
- Only new migrations execute when running `npm run db:init`
- Each migration runs in a transaction (all-or-nothing)
- Requires `DATABASE_URL` environment variable for direct PostgreSQL access

**Running Migrations:**
```bash
npm run db:init  # Applies new migrations + creates admin user if needed
```

**Note:** Safe to run multiple times - already-applied migrations are skipped.

## Authentication System

The system uses Supabase's built-in authentication:
- Authentication tokens come directly from Supabase Auth
- Row Level Security (RLS) policies work with auth.uid()
- The frontend stores a Supabase session
- Login/registration return Supabase sessions
- API tokens provide programmatic access with scoped permissions

### Email Handling

All authentication emails are handled automatically by Supabase:
- **Verification emails** - Sent automatically on registration
- **Password reset emails** - Sent via `resetPasswordForEmail()`
- **Magic link emails** - If configured in Supabase dashboard

**Local Development:**
- Emails are captured by Mailpit at http://127.0.0.1:54324
- No SMTP configuration needed

**Production:**
- Configure email templates: Supabase Dashboard → Authentication → Email Templates
- (Optional) Add custom SMTP settings if you want to use your own email provider
- Default: Supabase uses their own email service

## Documentation

### Architecture & Design

- **[Architecture & Design](docs/ARCHITECTURE.md)** - Comprehensive guide to the API architecture, dependency graph, progressive context engine, RPI chains, and reasoning services

### Integration Guides

- **[Agent Integration](docs/AGENT_INTEGRATION.md)** - How AI agents integrate with AgentPlanner (MCP, REST, Slack)
- **[Slack Integration](docs/SLACK_INTEGRATION.md)** - Real-time notifications via Slack
- **[API Reference](docs/API.md)** - Complete REST API endpoint reference (v2.0)
- **[Rate Limiting](docs/RATE_LIMITING.md)** - API rate limits and best practices

### For AI Agents

AgentPlanner supports three integration methods:

1. **MCP Tools** (recommended) - Model Context Protocol with 40+ tools for plans, dependencies, context, and analysis
2. **REST API** - Direct HTTP calls for agents that don't support MCP
3. **Slack** - Receive real-time notifications in Slack channels

Key features for agents:
- **Progressive Context** - `get_task_context` with depth 1-4 and token budgeting
- **Dependency-aware Scheduling** - `suggest_next_tasks` finds ready tasks where all blockers are completed
- **RPI Chains** - `create_rpi_chain` decomposes complex tasks into Research/Plan/Implement with automatic dependency wiring
- **Impact Analysis** - `analyze_impact` shows what happens if a task is delayed, blocked, or removed
- **Research Compaction** - Completed research outputs are auto-compacted for downstream context efficiency

## Related Projects

- **[Planning System MCP Server](https://github.com/talkingagents/agent-planner-mcp)** - Model Context Protocol interface for AI agents
- **[Agent Planner UI](https://github.com/talkingagents/agent-planner-ui)** - Web interface for the planning system

## Deployment

### Google Cloud Run

The API is configured for deployment on Google Cloud Run:

```bash
# Deploy to Cloud Run
./deploy.sh

# The service includes:
# - Automatic scaling
# - HTTPS endpoints
# - Environment variable configuration
# - Supabase integration
```

## Contributing

Please read [CONTRIBUTING.md](CONTRIBUTING.md) for details on our code of conduct and the process for submitting pull requests.

## Troubleshooting

### Common Issues

1. **"Row violates RLS policy" error**
   - Ensure you're using a valid Supabase JWT token
   - Check that the user has access to the resource

2. **Database connection issues**
   - Verify your Supabase credentials in `.env`
   - Check that your Supabase project is active

3. **Missing documentation**
   - Run `npm run docs:validate` to identify undocumented endpoints
   - Add swagger annotations to all routes

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Support

For questions and support:
- Open an issue on GitHub
- Check the [API documentation](http://localhost:3000/api-docs)
- Review the [technical design document](docs/archive/PDR.md) for architecture details
