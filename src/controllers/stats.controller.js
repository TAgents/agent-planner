const { usersDal, plansDal } = require('../db/dal.cjs');

/**
 * Get platform-wide statistics
 */
const getPlatformStats = async (req, res) => {
  try {
    const [userCount, planCount, publicPlanCount] = await Promise.all([
      usersDal.count(),
      plansDal.count(),
      plansDal.count({ isPublic: true }),
    ]);

    res.json({
      users: userCount,
      plans: planCount,
      publicPlans: publicPlanCount
    });
  } catch (error) {
    console.error('Error fetching platform stats:', error);
    res.status(500).json({
      error: 'Failed to fetch platform statistics',
      message: error.message
    });
  }
};

module.exports = {
  getPlatformStats
};
