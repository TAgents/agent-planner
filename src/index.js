const express = require('express');
const cors = require('cors');
const swaggerJsdoc = require('swagger-jsdoc');
const swaggerUi = require('swagger-ui-express');
const logger = require('./utils/logger');
require('dotenv').config();

// Import swagger configuration
const swaggerOptions = require('./config/swagger');

// Import database initialization
const { initializeDatabase } = require('./db/init');
const { checkDatabaseConnection, getDatabaseInfo, checkExistingUsers } = require('./utils/database-check');

// Import routes
const authRoutes = require('./routes/auth.routes');
const planRoutes = require('./routes/plan.routes');
const nodeRoutes = require('./routes/node.routes');
// Removed: artifact routes (Phase 0 simplification)
const activityRoutes = require('./routes/activity.routes');
const searchRoutes = require('./routes/search.routes');
const tokenRoutes = require('./routes/token.routes');
// Removed: debug routes (pre-v2 cleanup)
const uploadRoutes = require('./routes/upload.routes');
const userRoutes = require('./routes/user.routes');
const collaborationRoutes = require('./routes/collaboration.routes');
const statsRoutes = require('./routes/stats.routes');
const githubRoutes = require('./routes/github.routes');
// Removed: ai routes, webhook routes (pre-v2 cleanup)
const shareRoutes = require('./routes/share.routes');
// Removed: template, analytics, import-export, organization routes (pre-v2 cleanup)
const goalRoutes = require('./routes/goal.routes');
const goalsV2Routes = require('./routes/v2/goals.routes');
// Removed: knowledge routes (pre-v2 cleanup)
const contextRoutes = require('./routes/context.routes');
const decisionRoutes = require('./routes/decision.routes');
const dashboardRoutes = require('./routes/dashboard.routes');
// Removed: handoff routes (pre-v2 cleanup)
// Removed: chat, prompt routes (pre-v2 cleanup)
const heartbeatRoutes = require('./routes/heartbeat.routes');
const slackRoutes = require('./routes/slack.routes');
// Removed: artifact controller (Phase 0 simplification)

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
    'https://agentplanner.io',
    'https://www.agentplanner.io'
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

// Removed: template, analytics, import-export, organization routes (pre-v2 cleanup)

// Goal routes
app.use('/goals', generalLimiter, goalRoutes);
app.use('/api/goals', generalLimiter, goalsV2Routes);

// Removed: knowledge routes (pre-v2 cleanup)

// Agent context routes (leaf-up context loading)
app.use('/context', generalLimiter, contextRoutes);

// Decision request routes (human-in-the-loop)
app.use('/plans', generalLimiter, decisionRoutes);

// Dashboard routes (home page data)
app.use('/dashboard', generalLimiter, dashboardRoutes);
// Removed: handoff routes (pre-v2 cleanup)
// Removed: chat, prompt routes (pre-v2 cleanup)
app.use('/', generalLimiter, heartbeatRoutes);

// Slack integration routes
app.use('/integrations/slack', generalLimiter, slackRoutes);

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
    await logger.api(`Starting agent-planner API server...`);
    
    // Initialize the database if the environment is development
    // Skip old migrations in v2 mode — Drizzle handles schema
    if (process.env.NODE_ENV === 'development' && process.env.AUTH_VERSION !== 'v2') {
      await logger.api(`Initializing database in development mode`);
      await initializeDatabase();
    } else if (process.env.AUTH_VERSION === 'v2') {
      await logger.api(`v2 mode: skipping legacy migrations (Drizzle manages schema)`);
    }
    
    // Start the server
    const server = app.listen(port, async () => {
      await logger.api(`Server running on port ${port}`);
      await logger.api(`API Documentation available at http://localhost:${port}/api-docs`);
      await logger.api(`JWT_SECRET is ${process.env.JWT_SECRET ? 'configured' : 'MISSING'}`);
      await logger.api(`SUPABASE_URL: ${process.env.SUPABASE_URL}`);
      await logger.api(`SUPABASE_ANON_KEY is ${process.env.SUPABASE_ANON_KEY ? 'configured' : 'MISSING'}`);
      await logger.api(`SUPABASE_SERVICE_KEY is ${process.env.SUPABASE_SERVICE_KEY ? 'configured' : 'MISSING'}`);
      
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
