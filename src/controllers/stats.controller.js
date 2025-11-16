const { supabaseAdmin } = require('../config/supabase');

/**
 * Get platform-wide statistics
 */
const getPlatformStats = async (req, res) => {
  try {
    // Get total number of users
    const { count: userCount, error: userError } = await supabaseAdmin
      .from('users')
      .select('*', { count: 'exact', head: true });

    if (userError) {
      console.error('Error fetching user count:', userError);
      throw userError;
    }

    // Get total number of plans
    const { count: planCount, error: planError } = await supabaseAdmin
      .from('plans')
      .select('*', { count: 'exact', head: true });

    if (planError) {
      console.error('Error fetching plan count:', planError);
      throw planError;
    }

    // Get total number of public plans (for OSS projects metric)
    const { count: publicPlanCount, error: publicPlanError } = await supabaseAdmin
      .from('plans')
      .select('*', { count: 'exact', head: true })
      .eq('is_public', true);

    if (publicPlanError) {
      console.error('Error fetching public plan count:', publicPlanError);
      throw publicPlanError;
    }

    res.json({
      users: userCount || 0,
      plans: planCount || 0,
      publicPlans: publicPlanCount || 0
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
