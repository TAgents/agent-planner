const swaggerJsdoc = require('swagger-jsdoc');
const fs = require('fs');
const path = require('path');

const swaggerOptions = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Agent Planner API',
      version: '2.0.0',
      description: 'Collaborative planning API for humans and AI agents',
    },
    servers: [
      { url: 'http://localhost:3000', description: 'Local development' },
    ],
    components: {
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
        apiKeyAuth: { type: 'apiKey', in: 'header', name: 'Authorization' },
      },
    },
  },
  apis: [path.join(__dirname, '../src/routes/**/*.js')],
};

const spec = swaggerJsdoc(swaggerOptions);
const outPath = path.join(__dirname, '../docs/openapi.json');

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(spec, null, 2));
console.log(`OpenAPI spec written to ${outPath} (${Object.keys(spec.paths || {}).length} paths)`);
