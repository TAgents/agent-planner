/**
 * Plan Domain — barrel export
 *
 * Re-exports plan routes and controllers from their current locations.
 * Files will be physically moved here in Phase 4.
 */
const planRoutes = require('../../routes/plan.routes');
const planController = require('../../controllers/plan.controller.v2');
const planService = require('./services/plan.service');
const planRepository = require('./repositories/plan.repository');
const coherenceRoutes = require('../../routes/v2/coherence.routes');
const coherencePendingRoutes = require('../../routes/v2/coherencePending.routes');
const knowledgeLoopRoutes = require('../../routes/v2/knowledgeLoop.routes');

module.exports = {
  routes: {
    planRoutes,
    coherenceRoutes,
    coherencePendingRoutes,
    knowledgeLoopRoutes,
  },
  controllers: {
    planController,
  },
  services: {
    planService,
  },
  repositories: {
    planRepository,
  },
};
