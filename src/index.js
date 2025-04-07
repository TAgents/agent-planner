const express = require('express');
const cors = require('cors');
const swaggerJsdoc = require('swagger-jsdoc');
const swaggerUi = require('swagger-ui-express');
const logger = require('./utils/logger');
require('dotenv').config();

// Import database initialization
const { initializeDatabase } = require('./db/init');
const { checkDatabaseConnection, getDatabaseInfo, checkExistingUsers } = require('./utils/database-check');

// Import routes
const authRoutes = require('./routes/auth.routes');
const planRoutes = require('./routes/plan.routes');
const nodeRoutes = require('./routes/node.routes');
const artifactRoutes = require('./routes/artifact.routes');
const activityRoutes = require('./routes/activity.routes');
const searchRoutes = require('./routes/search.routes');
const tokenRoutes = require('./routes/token.routes');
const debugRoutes = require('./routes/debug.routes');

// Import middlewares
const { debugRequest } = require('./middleware/debug.middleware');

// Create Express app
const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
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
const swaggerOptions = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Planning System API',
      version: '1.0.0',
      description: 'A collaborative planning system for humans and AI agents',
    },
    servers: [
      {
        url: `http://localhost:${port}`,
        description: 'Development server',
      },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'Enter your Supabase access token',
        },
      },
    },
  },
  apis: ['./src/routes/*.js'], // Path to the API docs
};

const swaggerDocs = swaggerJsdoc(swaggerOptions);
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerDocs));

// Routes
app.use('/auth', authRoutes);
app.use('/plans', planRoutes);
app.use('/plans', nodeRoutes);
app.use('/plans', artifactRoutes);
app.use('/activity', activityRoutes);
app.use('/search', searchRoutes);
app.use('/tokens', tokenRoutes);
app.use('/debug', debugRoutes);

// Root route
app.get('/', (req, res) => {
  res.json({
    message: 'Welcome to the Planning System API',
    documentation: `/api-docs`,
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
    if (process.env.NODE_ENV === 'development') {
      await logger.api(`Initializing database in development mode`);
      await initializeDatabase();
    }
    
    // Start the server
    app.listen(port, async () => {
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
    });
  } catch (error) {
    await logger.error(`Failed to start server`, error);
    process.exit(1);
  }
};

startServer();

module.exports = app; // Export for testing
