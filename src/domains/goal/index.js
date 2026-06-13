/**
 * Goal Domain — barrel export
 */
const goalRoutes = require('../../routes/v2/goals.routes');

module.exports = {
  routes: { goalRoutes },
  services: {
    // The shared goal-access guard lives on the goals router for now; expose
    // it through the domain barrel so consumers (the v1 goal-state facade)
    // depend on a module interface, not on a property hung off a Router.
    requireGoalAccess: goalRoutes.requireGoalAccess,
  },
};
