/**
 * Decision Domain — barrel export
 */
const decisionRoutes = require('../../routes/decision.routes');
const decisionController = require('../../controllers/decision.controller');

module.exports = {
  routes: { decisionRoutes },
  controllers: { decisionController },
};
