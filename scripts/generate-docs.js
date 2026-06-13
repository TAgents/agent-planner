/**
 * Generates BOTH OpenAPI specs (Phase 3 of the API v1 consolidation):
 *   - docs/openapi.json    — full internal spec (every mounted route)
 *   - docs/openapi.v1.json — the public /v1 surface (operations tagged `v1`)
 */
const swaggerJsdoc = require('swagger-jsdoc');
const fs = require('fs');
const path = require('path');
const { extractV1Spec } = require('../src/utils/v1Spec');

const swaggerOptions = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Agent Planner API (internal)',
      version: '2.0.0',
      description:
        'Collaborative planning API for humans and AI agents. ' +
        'This is the FULL internal spec — unversioned routes may change or ' +
        'disappear without notice. The public, stable surface is the v1 spec ' +
        '(docs/openapi.v1.json, served at /api-docs).',
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
const v1Spec = extractV1Spec(spec);

const docsDir = path.join(__dirname, '../docs');
fs.mkdirSync(docsDir, { recursive: true });

const outPath = path.join(docsDir, 'openapi.json');
fs.writeFileSync(outPath, JSON.stringify(spec, null, 2));
console.log(`Internal OpenAPI spec written to ${outPath} (${Object.keys(spec.paths || {}).length} paths)`);

const v1OutPath = path.join(docsDir, 'openapi.v1.json');
fs.writeFileSync(v1OutPath, JSON.stringify(v1Spec, null, 2));
console.log(`v1 OpenAPI spec written to ${v1OutPath} (${Object.keys(v1Spec.paths || {}).length} paths)`);
