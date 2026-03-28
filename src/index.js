const express = require('express');
const cors = require('cors');
const swaggerJsdoc = require('swagger-jsdoc');
const swaggerUi = require('swagger-ui-express');
const logger = require('./utils/logger');
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

// Non-domain routes (cross-cutting, infra, integrations)
const authRoutes = require('./routes/auth.routes');
const tokenRoutes = require('./routes/token.routes');
const uploadRoutes = require('./routes/upload.routes');
const statsRoutes = require('./routes/stats.routes');
const githubRoutes = require('./routes/github.routes');
const agentV2Routes = require('./routes/v2/agent.routes');
const contextRoutes = require('./routes/context.routes');
const dashboardRoutes = require('./routes/dashboard.routes');
const slackRoutes = require('./routes/slack.routes');
const adminRoutes = require('./routes/admin.routes');

// Import WebSocket collaboration server
const CollaborationServer = require('./websocket/collaboration');
const { setCollaborationServer: setCollaborationServerController } = require('./controllers/collaboration.controller');
const { setCollaborationServer } = require('./websocket/broadcast');

// Import middlewares
const { debugRequest } = require('./middleware/debug.middleware');
const { 
  generalLimiter, 
  authLimiter, 
  searchLimiter, 
  tokenLimiter
} = require('./middleware/rateLimit.middleware');

// Create Express app
const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(cors({
  origin: [
    'http://localhost:3001',
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

// Setup Swagger documentation
const swaggerDocs = swaggerJsdoc(swaggerOptions);
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerDocs));

// Routes with rate limiting
// Auth routes - strict rate limiting to prevent brute force
app.use('/auth', authLimiter, authRoutes);

// Search routes - moderate rate limiting for expensive operations
app.use('/search', searchLimiter, searchRoutes);

// Token routes - strict rate limiting to prevent token abuse
app.use('/tokens', tokenLimiter, tokenRoutes);

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

// Share routes (plan sharing by email)
app.use('/plans', generalLimiter, shareRoutes);
app.use('/invites', generalLimiter, shareRoutes);

// Organization routes
app.use('/organizations', generalLimiter, organizationRoutes);

app.use('/goals', generalLimiter, goalsV2Routes);

app.use('/knowledge', generalLimiter, knowledgeV2Routes);
app.use('/knowledge/search', searchLimiter);  // stricter limit for semantic search
app.use('/v2/agent', generalLimiter, agentV2Routes);
// Agent context routes (leaf-up context loading)
app.use('/context', generalLimiter, contextRoutes);

// Node view routes (human-readable agent context)
app.use('/nodes', generalLimiter, nodeViewRoutes);

// Decision request routes (human-in-the-loop)
app.use('/plans', generalLimiter, decisionRoutes);

// Dependency graph routes
app.use('/plans', generalLimiter, dependencyRoutes);
app.use('/dependencies', generalLimiter, crossPlanDepsRoutes);
app.use('/plans', generalLimiter, reasoningRoutes);
app.use('/plans', generalLimiter, coherenceRoutes);
app.use('/coherence', generalLimiter, coherencePendingRoutes);
app.use('/plans', generalLimiter, knowledgeLoopRoutes);

// Dashboard routes (home page data)
app.use('/dashboard', generalLimiter, dashboardRoutes);
// Removed: handoff routes (pre-v2 cleanup)
// Removed: chat, prompt routes (pre-v2 cleanup)

// Slack integration routes
app.use('/integrations/slack', generalLimiter, slackRoutes);

// Admin
app.use('/admin', generalLimiter, adminRoutes);

// Removed: artifact download endpoint (Phase 0 simplification)
const { authenticate } = require('./middleware/auth.middleware');

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
    service: 'agent-planner-api'
  });
});

// Error handling middleware
app.use(async (err, req, res, next) => {
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
    });
  } catch (error) {
    await logger.error(`Failed to start server`, error);
    process.exit(1);
  }
};

startServer();

module.exports = app; // Export for testing
