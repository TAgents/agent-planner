# Planning System API

A collaborative planning system that facilitates interactions between humans and AI agents through a unified interface.

## Overview

The Planning System API stores plan data in a Supabase database and provides a REST API for accessing and manipulating plans. The system is designed to enable seamless collaboration between humans and LLM agents, without creating artificial distinctions between them in the architecture.

## Core Features

- 🏗️ **Hierarchical plan structures** with phases, tasks, and milestones
- 🤖 **Rich context for AI agent collaboration** with detailed instructions and acceptance criteria
- 👥 **Equal status for human and AI collaborators** in the system architecture
- 📊 **Detailed progress tracking and logging** with activity feeds
- 📁 **Artifact management** for tracking outputs and references
- 🔍 **Advanced search capabilities** across plans, nodes, and artifacts
- 🔐 **Secure authentication** using Supabase Auth with API token support

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
- `SUPABASE_URL` - Your Supabase project URL
- `SUPABASE_ANON_KEY` - Your Supabase anonymous key
- `SUPABASE_SERVICE_KEY` - Your Supabase service role key
- `JWT_SECRET` - Secret for JWT token generation

4. **Set up the database**

Initialize the database schema in your Supabase project:

```bash
# Run the initialization script
npm run db:init
```

Then go to your [Supabase SQL Editor](https://app.supabase.com/project/_/editor) and execute the generated SQL scripts.

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
│   ├── index.js           # Main application entry point
│   ├── config/            # Configuration files
│   │   └── swagger.js     # Swagger/OpenAPI configuration
│   ├── controllers/       # Route controllers
│   ├── routes/           # API route definitions with swagger annotations
│   ├── middleware/       # Express middleware
│   ├── schemas/          # Shared OpenAPI schema definitions
│   └── db/              # Database initialization and migrations
├── docs/                # Generated documentation
├── scripts/             # Utility scripts
└── tests/              # Test files
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

The system uses PostgreSQL (via Supabase) with the following main tables:
- `users` - User accounts
- `plans` - Plan definitions
- `plan_nodes` - Hierarchical plan structure
- `plan_collaborators` - User access to plans
- `plan_comments` - Comments on nodes
- `plan_node_logs` - Activity tracking
- `plan_node_artifacts` - File/resource attachments
- `api_tokens` - API authentication tokens

Row Level Security (RLS) policies ensure users can only access their own data and plans they collaborate on.

## Authentication System

The system uses Supabase's built-in authentication:
- Authentication tokens come directly from Supabase Auth
- Row Level Security (RLS) policies work with auth.uid()
- The frontend stores a Supabase session
- Login/registration return Supabase sessions
- API tokens provide programmatic access with scoped permissions

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
