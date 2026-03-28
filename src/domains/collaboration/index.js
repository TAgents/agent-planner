/**
 * Collaboration Domain — barrel export
 */
const collaborationRoutes = require('../../routes/collaboration.routes');
const shareRoutes = require('../../routes/share.routes');
const organizationRoutes = require('../../routes/organization.routes');
const collaborationController = require('../../controllers/collaboration.controller');
const userRoutes = require('../../routes/user.routes');
const userController = require('../../controllers/user.controller');

module.exports = {
  routes: {
    collaborationRoutes,
    shareRoutes,
    organizationRoutes,
    userRoutes,
  },
  controllers: {
    collaborationController,
    userController,
  },
};
