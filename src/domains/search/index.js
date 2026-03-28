/**
 * Search Domain — barrel export
 */
const searchRoutes = require('../../routes/search.routes');
const searchController = require('../../controllers/search.controller');

module.exports = {
  routes: { searchRoutes },
  controllers: { searchController },
};
