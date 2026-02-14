const { usersDal, plansDal } = require('../db/dal.cjs');
const logger = require('./logger');

/**
 * Simple health check for the database connection
 */
const checkDatabaseConnection = async () => {
  try {
    await logger.api('Checking database connection...');
    // Try a simple query through DAL
    await usersDal.count();
    await logger.api('Successfully connected to database');
    return { connected: true, message: 'Successfully connected to database' };
  } catch (error) {
    await logger.error('Failed to connect to database', error);
    return { connected: false, error: error.message, details: error };
  }
};

/**
 * Get basic database info
 */
const getDatabaseInfo = async () => {
  try {
    await logger.api('Fetching database information...');
    const tableStatus = {};

    try {
      const count = await usersDal.count();
      tableStatus.users = { exists: true, count };
    } catch (e) {
      tableStatus.users = { exists: false, error: e.message };
    }

    try {
      const count = await plansDal.count();
      tableStatus.plans = { exists: true, count };
    } catch (e) {
      tableStatus.plans = { exists: false, error: e.message };
    }

    return tableStatus;
  } catch (error) {
    await logger.error('Failed to get database info', error);
    return { error: error.message };
  }
};

/**
 * Check for existing users in the database
 */
const checkExistingUsers = async () => {
  try {
    const data = await usersDal.list({ limit: 10 });

    if (data && data.length > 0) {
      return {
        hasUsers: true,
        count: data.length,
        sampleUsers: data.map(user => ({ id: user.id, email: user.email, name: user.name, created_at: user.createdAt }))
      };
    }
    return { hasUsers: false };
  } catch (error) {
    return { error: error.message };
  }
};

module.exports = { checkDatabaseConnection, getDatabaseInfo, checkExistingUsers };
