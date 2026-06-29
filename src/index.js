const express = require('express');
const cors = require('cors');
const swaggerJsdoc = require('swagger-jsdoc');
const swaggerUi = require('swagger-ui-express');
const logger = require('./utils/logger');
const { versionInfo } = require('./version');
require('dotenv').config();

// Import swagger configuration
const swaggerOptions = require('./config/swagger');

// Import database checks
const { checkDatabaseConnection, getDatabaseInfo, checkExistingUsers } = require('./utils/database-check');

// Import routes — domain-organized (Phase 3 refactor)
const domains = require('./domains');

// Plan domain
const planRoutes = domains.plan.routes.planRoutes;
const coherenceRoutes = domains.plan.routes.coherenceRoutes;
const coherencePendingRoutes = domains.plan.routes.coherencePendingRoutes;
const knowledgeLoopRoutes = domains.plan.routes.knowledgeLoopRoutes;

// Node domain
const nodeRoutes = domains.node.routes.nodeRoutes;
const activityRoutes = domains.node.routes.activityRoutes;
const nodeViewRoutes = domains.node.routes.nodeViewRoutes;

// Decision domain
const decisionRoutes = domains.decision.routes.decisionRoutes;

// Dependency domain
const dependencyRoutes = domains.dependency.routes.dependencyRoutes;
const crossPlanDepsRoutes = domains.dependency.routes.crossPlanDepsRoutes;
const reasoningRoutes = domains.dependency.routes.reasoningRoutes;

// Goal domain
const goalsV2Routes = domains.goal.routes.goalRoutes;

// Knowledge domain
const knowledgeV2Routes = domains.knowledge.routes.knowledgeRoutes;

// Collaboration domain
const collaborationRoutes = domains.collaboration.routes.collaborationRoutes;
const shareRoutes = domains.collaboration.routes.shareRoutes;
const organizationRoutes = domains.collaboration.routes.organizationRoutes;
const userRoutes = domains.collaboration.routes.userRoutes;

// Search domain
const searchRoutes = domains.search.routes.searchRoutes;

// Agent loop facade
const agentLoopRoutes = domains.agent.routes.agentLoopRoutes;

// Non-domain routes (cross-cutting, infra, integrations)
const authRoutes = require('./routes/auth.routes');
const uploadRoutes = require('./routes/upload.routes');
const statsRoutes = require('./routes/stats.routes');
const githubRoutes = require('./routes/github.routes');
const contextRoutes = require('./routes/context.routes');
const dashboardRoutes = require('./routes/dashboard.routes');
const onboardingRoutes = require('./routes/onboarding.routes');
const slackRoutes = require('./routes/slack.routes');
const adminRoutes = require('./routes/admin.routes');
const workspaceRoutes = require('./routes/workspace.routes');
const blueprintRoutes = require('./routes/blueprint.routes');
const oauthStoreRoutes = require('./routes/oauthStore.routes');
const connectionsRoutes = require('./routes/connections.routes');

// Public versioned API surface — aliases + facades over the routes above.
// Internal routes stay mounted (the UI depends on them); /v1 is the
// documented contract. See docs/API_V1_CONSOLIDATION_PLAN.md.
const v1Routes = require('./routes/v1');

// Import WebSocket collaboration server
const CollaborationServer = require('./websocket/collaboration');
const { setCollaborationServer: setCollaborationServerController } = require('./controllers/collaboration.controller');
const { setCollaborationServer } = require('./websocket/broadcast');

// Import middlewares
const { debugRequest } = require('./middleware/debug.middleware');
const {
  generalLimiter,
  authLimiter,
  searchLimiter
} = require('./middleware/rateLimit.middleware');

// Create Express app
const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(cors({
  origin: [
    'http://localhost:3001',
    'http://localhost:3002',
    'http://localhost:8080',
    'https://agentplanner.io',
    'https://www.agentplanner.io',
    'https://talkingagents.com',
    'https://www.talkingagents.com'
  ],
  credentials: true
}));
app.use(express.json());
app.use(express.text({ type: ['text/markdown', 'text/plain'] }));
app.use(express.urlencoded({ extended: true }));

// Request logging middleware
app.use(async (req, res, next) => {
  const start = Date.now();
  const method = req.method;
  const url = req.originalUrl || req.url;
  
  await logger.api(`Request received: ${method} ${url}`);
  
  // Capture response when it completes
  res.on('finish', async () => {
    const duration = Date.now() - start;
    const status = res.statusCode;
    await logger.api(`Response sent: ${method} ${url} ${status} - ${duration}ms`);
  });
  
  next();
});

// Apply debug middleware only in development mode
if (process.env.NODE_ENV === 'development') {
  app.use(debugRequest);
  logger.api('Debug middleware enabled - detailed request/response logging activated');
}

// Setup Swagger documentation — public v1 spec by default, full internal
// spec at /api-docs/internal. (Internal mount must come first so it isn't
// shadowed by the /api-docs mount.)
const { extractV1Spec } = require('./utils/v1Spec');
const swaggerDocs = swaggerJsdoc(swaggerOptions);
const swaggerDocsV1 = extractV1Spec(swaggerDocs);
app.use('/api-docs/internal', swaggerUi.serveFiles(swaggerDocs), swaggerUi.setup(swaggerDocs));
app.use('/api-docs', swaggerUi.serveFiles(swaggerDocsV1), swaggerUi.setup(swaggerDocsV1));

// Tool-call telemetry: records one row per authenticated request via
// res.finish. Mounted globally; reads req.user lazily so route-level
// authenticate middleware has already populated it by finish time.
const { recordToolCall } = require('./middleware/toolCallTelemetry.middleware');
app.use(recordToolCall);

// Routes with rate limiting
// Auth routes - strict rate limiting to prevent brute force
// Public versioned API (v1) — mounted first so /v1/* never collides with
// internal routes. Auth/search subgroups apply their stricter limiters
// per-route inside the v1 router.
app.use('/v1', generalLimiter, v1Routes);

app.use('/auth', authLimiter, authRoutes);

// Search routes - moderate rate limiting for expensive operations
app.use('/search', searchLimiter, searchRoutes);

// Removed: /tokens routes (deprecated; token management lives at /auth/token)
// Removed: webhook routes (pre-v2 cleanup)

// General routes with standard rate limiting
app.use('/plans', generalLimiter, planRoutes);
app.use('/plans', generalLimiter, nodeRoutes);
// Removed: artifact routes (Phase 0 simplification)
app.use('/activity', generalLimiter, activityRoutes);
// Removed: debug routes (pre-v2 cleanup)
app.use('/upload', generalLimiter, uploadRoutes);
app.use('/users', generalLimiter, userRoutes);
app.use('/plans', generalLimiter, collaborationRoutes);
app.use('/stats', generalLimiter, statsRoutes);
app.use('/github', generalLimiter, githubRoutes);
// Removed: ai routes (pre-v2 cleanup)

// Share routes (plan sharing by email) — plan-scoped sharing and
// token-scoped invite acceptance are separate routers so neither mount
// exposes the other's paths.
app.use('/plans', generalLimiter, shareRoutes);
app.use('/invites', generalLimiter, shareRoutes.inviteRoutes);

// Organization routes
app.use('/organizations', generalLimiter, organizationRoutes);

// Workspace routes (folders under an organization, own goals + plans)
app.use('/workspaces', generalLimiter, workspaceRoutes);

// Blueprint routes (reusable templates; fork into a workspace)
app.use('/blueprints', generalLimiter, blueprintRoutes);

app.use('/goals', generalLimiter, goalsV2Routes);

app.use('/knowledge', generalLimiter, knowledgeV2Routes);
app.use('/knowledge/search', searchLimiter);  // stricter limit for semantic search
app.use('/agent', generalLimiter, agentLoopRoutes);
// Agent context routes (leaf-up context loading)
app.use('/context', generalLimiter, contextRoutes);

// Node view routes (human-readable agent context)
app.use('/nodes', generalLimiter, nodeViewRoutes);

// Decision request routes (human-in-the-loop)
app.use('/plans', generalLimiter, decisionRoutes);

// Internal OAuth store (server-to-server, secret-guarded) — the hosted MCP's
// OAuth authorization server persists DCR clients + PKCE codes here. Should not
// be exposed publicly via nginx.
app.use('/internal/oauth', oauthStoreRoutes);

// Connected apps (user-facing OAuth connector management).
app.use('/connections', generalLimiter, connectionsRoutes);

// Dependency graph routes
app.use('/plans', generalLimiter, dependencyRoutes);
app.use('/dependencies', generalLimiter, crossPlanDepsRoutes);
app.use('/plans', generalLimiter, reasoningRoutes);
app.use('/plans', generalLimiter, coherenceRoutes);
app.use('/coherence', generalLimiter, coherencePendingRoutes);
app.use('/plans', generalLimiter, knowledgeLoopRoutes);

// Dashboard routes (home page data)
app.use('/dashboard', generalLimiter, dashboardRoutes);
// Onboarding routes (test-connection, recent calls, .mcpb release metadata)
app.use('/onboarding', generalLimiter, onboardingRoutes);
// Removed: handoff routes (pre-v2 cleanup)
// Removed: chat, prompt routes (pre-v2 cleanup)

// Slack integration routes
app.use('/integrations/slack', generalLimiter, slackRoutes);

// Admin
app.use('/admin', generalLimiter, adminRoutes);

// Removed: artifact download endpoint (Phase 0 simplification)
// Direct file access endpoint for development
if (process.env.NODE_ENV === 'development') {
  app.get('/files/*', (req, res) => {
    const fs = require('fs');
    const path = require('path');
    const filePath = req.params[0];
    const projectRoot = process.cwd();
    const fullPath = path.join(projectRoot, '..', 'docs', filePath);
    
    console.log(`Direct file access: ${fullPath}`);
    
    if (fs.existsSync(fullPath)) {
      res.sendFile(fullPath);
    } else {
      res.status(404).send(`File not found: ${filePath}`);
    }
  });
}

// Root route
app.get('/', (req, res) => {
  res.json({
    message: 'Welcome to the Planning System API',
    documentation: `/api-docs`,
  });
});

// Health check endpoint for Cloud Run
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    service: 'agent-planner-api',
    version: versionInfo().version,
  });
});

// Version endpoint — confirm exactly which build is running. Public (no auth)
// so any client (UI, MCP, ops) can read it.
app.get('/version', (req, res) => {
  res.status(200).json(versionInfo());
});

// Error handling middleware
app.use(async (err, req, res, _next) => {
  const status = err.statusCode || 500;
  const message = err.message || 'Internal Server Error';
  
  await logger.error(`API Error (${status}): ${message}`, err);
  
  res.status(status).json({
    error: message,
  });
});

// Initialize database and start server
const startServer = async () => {
  try {
    // Initialize messageBus for Postgres LISTEN/NOTIFY pub/sub
    const messageBus = require('./services/messageBus');
    if (process.env.DATABASE_URL) {
      await messageBus.init(process.env.DATABASE_URL);
      await logger.api('MessageBus initialized (Postgres LISTEN/NOTIFY)');

      // Initialize async service listeners
      const { initCoherenceEngine } = require('./services/coherenceEngine');
      const { initStatusPropagation } = require('./services/reasoning');
      const { initCompactionListener } = require('./services/compaction');
      initCoherenceEngine(messageBus);
      initStatusPropagation(messageBus);
      initCompactionListener(messageBus);
      const { initContextCacheInvalidation } = require('./services/contextEngine');
      initContextCacheInvalidation(messageBus);
    }

    await logger.api(`Starting agent-planner API server...`);

    // Initialize Graphiti bridge (optional — degrades gracefully)
    const graphitiBridge = require('./services/graphitiBridge');
    const graphitiReady = await graphitiBridge.init();
    if (graphitiReady) {
      await logger.api('Graphiti knowledge graph bridge: CONNECTED');
    } else {
      await logger.api('Graphiti knowledge graph bridge: not available (knowledge graph features disabled)');
    }

    // Schema is managed by Drizzle (npm run db:push)
    await logger.api(`Database schema managed by Drizzle ORM`);
    
    // Start the server
    const server = app.listen(port, async () => {
      await logger.api(`Server running on port ${port}`);
      await logger.api(`API Documentation available at http://localhost:${port}/api-docs`);
      await logger.api(`JWT_SECRET is ${process.env.JWT_SECRET ? 'configured' : 'MISSING'}`);

      // Check database connection
      const dbStatus = await checkDatabaseConnection();
      if (dbStatus.connected) {
        await logger.api('Database connection check: SUCCESS');
        
        // Check database tables
        await getDatabaseInfo();
        
        // Check for existing users
        const usersStatus = await checkExistingUsers();
        if (usersStatus.hasUsers) {
          await logger.api(`Found ${usersStatus.count} users in the database`);
          if (usersStatus.sampleUsers && usersStatus.sampleUsers.length > 0) {
            await logger.api(`Sample user: ${JSON.stringify(usersStatus.sampleUsers[0])}`);
          }
        } else {
          await logger.api('No users found in the database');
        }
      } else {
        await logger.error('Database connection check: FAILED', { message: dbStatus.error });
      }
      
      // Initialize WebSocket collaboration server
      const collaborationServer = new CollaborationServer(server);

      // Set the server instance in both places:
      // 1. Broadcast utility (new centralized approach)
      setCollaborationServer(collaborationServer);
      // 2. Collaboration controller (backward compatibility)
      setCollaborationServerController(collaborationServer);

      await logger.api('WebSocket collaboration server initialized at /ws/collaborate');

      // Tool-call telemetry retention — keeps tool_calls bounded.
      // Defaults: 90d retention, 24h interval. Configurable via
      // TOOL_CALLS_RETENTION_DAYS / TOOL_CALLS_RETENTION_INTERVAL_MS;
      // disable entirely with TOOL_CALLS_RETENTION_DISABLED=true.
      const { startRetentionJob } = require('./services/toolCallsRetention');
      startRetentionJob();

      // Expired plan-invite cleanup — daily, non-fatal on failure.
      const { cleanupExpiredInvites } = require('./services/invites');
      cleanupExpiredInvites();
      setInterval(cleanupExpiredInvites, 24 * 60 * 60 * 1000).unref();
    });
  } catch (error) {
    await logger.error(`Failed to start server`, error);
    process.exit(1);
  }
};

// Only boot the server when run as the entrypoint; `require()` of this module
// (e.g. the route-auth-coverage test) gets the fully-mounted app without
// opening a DB connection or binding a port.
if (require.main === module) {
  startServer();
}

module.exports = app; // Export for testing
