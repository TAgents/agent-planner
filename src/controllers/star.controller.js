const { supabase } = require('../config/supabase');

/**
 * Star a plan (add to favorites)
 */
const starPlan = async (req, res, next) => {
  try {
    const { id: planId } = req.params;
    const userId = req.user.id;

    // Check if plan exists and is public
    const { data: plan, error: planError } = await supabase
      .from('plans')
      .select('id, visibility')
      .eq('id', planId)
      .single();

    if (planError || !plan) {
      return res.status(404).json({ error: 'Plan not found' });
    }

    if (plan.visibility !== 'public') {
      return res.status(403).json({ error: 'Can only star public plans' });
    }

    // Insert star
    const { error: insertError } = await supabase
      .from('plan_stars')
      .insert({
        user_id: userId,
        plan_id: planId
      });

    if (insertError) {
      // Check for unique constraint violation (already starred)
      if (insertError.code === '23505') {
        return res.status(400).json({ error: 'Plan already starred' });
      }
      throw insertError;
    }

    // Get updated star count
    const { count } = await supabase
      .from('plan_stars')
      .select('*', { count: 'exact', head: true })
      .eq('plan_id', planId);

    res.json({
      success: true,
      starred: true,
      star_count: count || 0
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Unstar a plan (remove from favorites)
 */
const unstarPlan = async (req, res, next) => {
  try {
    const { id: planId } = req.params;
    const userId = req.user.id;

    // Delete star
    const { error: deleteError } = await supabase
      .from('plan_stars')
      .delete()
      .match({ user_id: userId, plan_id: planId });

    if (deleteError) {
      throw deleteError;
    }

    // Get updated star count
    const { count } = await supabase
      .from('plan_stars')
      .select('*', { count: 'exact', head: true })
      .eq('plan_id', planId);

    res.json({
      success: true,
      starred: false,
      star_count: count || 0
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get star information for a plan
 */
const getPlanStars = async (req, res, next) => {
  try {
    const { id: planId } = req.params;
    const userId = req.user?.id; // Optional - may not be authenticated

    // Get total star count
    const { count } = await supabase
      .from('plan_stars')
      .select('*', { count: 'exact', head: true })
      .eq('plan_id', planId);

    // Check if current user has starred (if authenticated)
    let isStarred = false;
    if (userId) {
      const { data: userStar } = await supabase
        .from('plan_stars')
        .select('id')
        .match({ user_id: userId, plan_id: planId })
        .single();

      isStarred = !!userStar;
    }

    res.json({
      plan_id: planId,
      star_count: count || 0,
      is_starred: isStarred
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get user's starred plans
 */
const getUserStarredPlans = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { page = 1, limit = 12 } = req.query;

    const limitNum = Math.min(parseInt(limit) || 12, 100);
    const pageNum = Math.max(parseInt(page) || 1, 1);
    const offsetNum = (pageNum - 1) * limitNum;

    // Get starred plan IDs
    const { data: stars, error: starsError, count } = await supabase
      .from('plan_stars')
      .select('plan_id, created_at', { count: 'exact' })
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .range(offsetNum, offsetNum + limitNum - 1);

    if (starsError) {
      throw starsError;
    }

    if (!stars || stars.length === 0) {
      return res.json({
        plans: [],
        total: 0,
        limit: limitNum,
        page: pageNum,
        total_pages: 0
      });
    }

    // Get plan details
    const planIds = stars.map(s => s.plan_id);
    const { data: plans, error: plansError } = await supabase
      .from('plans')
      .select('id, title, description, status, created_at, updated_at, owner_id, visibility, view_count, github_repo_owner, github_repo_name')
      .in('id', planIds)
      .eq('visibility', 'public'); // Only return public plans

    if (plansError) {
      throw plansError;
    }

    // Fetch owner information and stats for each plan
    const plansWithMetadata = await Promise.all(
      plans.map(async (plan) => {
        const { data: owner } = await supabase
          .from('users')
          .select('id, name, email, github_username, avatar_url')
          .eq('id', plan.owner_id)
          .single();

        const { data: nodes } = await supabase
          .from('plan_nodes')
          .select('id, status')
          .eq('plan_id', plan.id)
          .neq('node_type', 'root');

        const task_count = nodes ? nodes.length : 0;
        const completed_count = nodes ? nodes.filter(n => n.status === 'completed').length : 0;
        const completion_percentage = task_count > 0 ? Math.round((completed_count / task_count) * 100) : 0;

        return {
          ...plan,
          owner: owner || { id: plan.owner_id, name: 'Unknown', email: '', github_username: null, avatar_url: null },
          task_count,
          completed_count,
          completion_percentage,
          starred_at: stars.find(s => s.plan_id === plan.id)?.created_at
        };
      })
    );

    res.json({
      plans: plansWithMetadata,
      total: count || 0,
      limit: limitNum,
      page: pageNum,
      total_pages: count ? Math.ceil(count / limitNum) : 0
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  starPlan,
  unstarPlan,
  getPlanStars,
  getUserStarredPlans
};
