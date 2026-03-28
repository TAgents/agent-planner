/**
 * Node Domain — barrel export
 */
const nodeRoutes = require('../../routes/node.routes');
const nodeController = require('../../controllers/node.controller.v2');
const activityRoutes = require('../../routes/activity.routes');
const activityController = require('../../controllers/activity.controller');
const claimsController = require('../../controllers/claims.controller.v2');
const episodeLinksController = require('../../controllers/episodeLinks.controller.v2');
const assignmentController = require('../../controllers/assignment.controller');
const nodeViewRoutes = require('../../routes/node-views.routes');

module.exports = {
  routes: {
    nodeRoutes,
    activityRoutes,
    nodeViewRoutes,
  },
  controllers: {
    nodeController,
    activityController,
    claimsController,
    episodeLinksController,
    assignmentController,
  },
};
