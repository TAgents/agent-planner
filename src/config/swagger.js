const port = process.env.PORT || 3000;

const swaggerOptions = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Agent Planner API',
      version: '2.0.0',
      description: 'A collaborative planning system for humans and AI agents. Features dependency graph with cycle detection, progressive context engine with token budgeting, RPI (Research→Plan→Implement) task chains, and reasoning services for automated scheduling and impact analysis.',
      contact: {
        name: 'API Support',
        email: 'support@example.com'
      },
      license: {
        name: 'MIT',
        url: 'https://opensource.org/licenses/MIT'
      }
    },
    servers: [
      {
        url: process.env.API_URL || `http://localhost:${port}`,
        description: 'Current environment'
      },
      {
        url: 'http://localhost:3000',
        description: 'Local development'
      },
      {
        url: 'https://api.agent-planner.com',
        description: 'Production'
      }
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'JWT token'
        },
        apiKey: {
          type: 'apiKey',
          in: 'header',
          name: 'Authorization',
          description: 'API Key authentication (format: ApiKey <token>)'
        }
      },
      responses: {
        Unauthorized: {
          description: 'Authentication required',
          content: {
            'application/json': {
              schema: {
                $ref: '#/components/schemas/Error'
              },
              example: {
                error: 'Authentication required'
              }
            }
          }
        },
        Forbidden: {
          description: 'Access denied',
          content: {
            'application/json': {
              schema: {
                $ref: '#/components/schemas/Error'
              },
              example: {
                error: 'You do not have permission to access this resource'
              }
            }
          }
        },
        NotFound: {
          description: 'Resource not found',
          content: {
            'application/json': {
              schema: {
                $ref: '#/components/schemas/Error'
              },
              example: {
                error: 'Resource not found'
              }
            }
          }
        },
        BadRequest: {
          description: 'Invalid request',
          content: {
            'application/json': {
              schema: {
                $ref: '#/components/schemas/Error'
              },
              example: {
                error: 'Invalid request parameters'
              }
            }
          }
        },
        InternalError: {
          description: 'Internal server error',
          content: {
            'application/json': {
              schema: {
                $ref: '#/components/schemas/Error'
              },
              example: {
                error: 'An internal server error occurred'
              }
            }
          }
        }
      }
    },
    tags: [
      {
        name: 'Authentication',
        description: 'User authentication and session management'
      },
      {
        name: 'Plans',
        description: 'Plan management operations'
      },
      {
        name: 'Nodes',
        description: 'Plan node operations'
      },
      {
        name: 'Artifacts',
        description: 'Artifact management'
      },
      {
        name: 'Activity',
        description: 'Activity tracking and logs'
      },
      {
        name: 'Search',
        description: 'Search operations'
      },
      {
        name: 'Tokens',
        description: 'API token management'
      },
      {
        name: 'Upload',
        description: 'File upload operations'
      },
      {
        name: 'Users',
        description: 'User management'
      },
      {
        name: 'Health',
        description: 'System health and status'
      },
      {
        name: 'GitHub',
        description: 'GitHub integration operations'
      },
      {
        name: 'Dependencies',
        description: 'Dependency graph operations — create edges, cycle detection, traversal, impact analysis, critical path'
      },
      {
        name: 'Context',
        description: 'Progressive context assembly — layered depth, token budgeting, research compaction'
      },
      {
        name: 'Reasoning',
        description: 'Reasoning services — bottleneck detection, RPI chains, topological scheduling, decomposition alerts'
      }
    ]
  },
  apis: [
    './src/routes/*.js',
    './src/routes/**/*.js',
    './src/schemas/*.js'
  ]
};

module.exports = swaggerOptions;
