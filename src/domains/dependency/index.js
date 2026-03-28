/**
 * Dependency Domain — barrel export
 */
const dependencyRoutes = require('../../routes/dependency.routes');
const crossPlanDepsRoutes = require('../../routes/cross-plan-deps.routes');
const reasoningRoutes = require('../../routes/reasoning.routes');
const dependencyController = require('../../controllers/dependency.controller.v2');

module.exports = {
  routes: {
    dependencyRoutes,
    crossPlanDepsRoutes,
    reasoningRoutes,
  },
  controllers: { dependencyController },
};
