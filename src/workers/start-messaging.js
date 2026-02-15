#!/usr/bin/env node
/**
 * Start the Hatchet messaging worker
 * 
 * Usage:
 *   node -r dotenv/config src/workers/start-messaging.js
 *   
 * Requires:
 *   - HATCHET_CLIENT_TOKEN
 *   - DATABASE_URL
 */
require('dotenv').config();

const { startWorker } = require('../workflows/messaging.workflow');

startWorker()
  .then(() => console.log('Worker running. Press Ctrl+C to stop.'))
  .catch(err => {
    console.error('Failed to start messaging worker:', err);
    process.exit(1);
  });
