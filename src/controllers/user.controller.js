const { supabase, supabaseAdmin } = require('../config/supabase');
const logger = require('../utils/logger');

/**
 * Get current user profile
 */
const getUserProfile = async (req, res, next) => {
  try {
    const userId = req.user.id;
    
    await logger.auth(`Getting profile for user ${userId}`);

    // Get user from Supabase Auth
    const { data: userData, error: userError } = await supabaseAdmin.auth.admin.getUserById(userId);

    if (userError || !userData) {
      await logger.error(`Failed to get user profile`, userError);
      return res.status(404).json({ error: 'User not found' });
    }

    // Also check if we have a user record in our database
    const { data: dbUser, error: dbError } = await supabaseAdmin
      .from('users')
      .select('*')
      .eq('id', userId)
      .single();

    // Merge the data from auth and database
    const profile = {
      id: userData.user.id,
      email: userData.user.email,
      name: dbUser?.name || userData.user.user_metadata?.name || userData.user.email.split('@')[0],
      organization: dbUser?.organization || userData.user.user_metadata?.organization,
      avatar_url: dbUser?.avatar_url || userData.user.user_metadata?.avatar_url,
      email_verified: userData.user.user_metadata?.email_verified || false,
      github_id: dbUser?.github_id || null,
      github_username: dbUser?.github_username || null,
      github_avatar_url: dbUser?.github_avatar_url || null,
      github_profile_url: dbUser?.github_profile_url || null,
      created_at: userData.user.created_at,
      updated_at: userData.user.updated_at
    };

    await logger.auth(`Profile retrieved successfully for user ${userId}`);
    res.json(profile);
  } catch (error) {
    await logger.error(`Unexpected error in getUserProfile endpoint`, error);
    next(error);
  }
};

/**
 * Update user profile
 */
const updateUserProfile = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { name, organization, avatar_url } = req.body;

    await logger.auth(`Updating profile for user ${userId}`);
    await logger.auth(`Update data: ${JSON.stringify({ name, organization, avatar_url })}`);

    // First, update the auth user metadata
    const { data: authUpdate, error: authError } = await supabaseAdmin.auth.admin.updateUserById(
      userId,
      {
        user_metadata: {
          name: name,
          organization: organization,
          avatar_url: avatar_url
        }
      }
    );

    if (authError) {
      await logger.error(`Failed to update auth user metadata for ${userId}`, authError);
      return res.status(500).json({ error: 'Failed to update profile in auth system' });
    }

    // Then update or insert in the users table
    const { data: existingUser, error: checkError } = await supabaseAdmin
      .from('users')
      .select('id')
      .eq('id', userId)
      .single();

    let dbResult;
    if (existingUser) {
      // Update existing user record
      dbResult = await supabaseAdmin
        .from('users')
        .update({
          name: name || null,
          organization: organization || null,
          avatar_url: avatar_url || null,
          updated_at: new Date().toISOString()
        })
        .eq('id', userId)
        .select()
        .single();
    } else {
      // Insert new user record
      dbResult = await supabaseAdmin
        .from('users')
        .insert({
          id: userId,
          email: req.user.email,
          name: name || null,
          organization: organization || null,
          avatar_url: avatar_url || null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .select()
        .single();
    }

    if (dbResult.error) {
      await logger.error(`Failed to update user in database for ${userId}`, dbResult.error);
      // Don't fail the whole request if database update fails, auth update was successful
      await logger.warn(`Continuing despite database error - auth metadata was updated`);
    }

    await logger.auth(`Profile updated successfully for user ${userId}`);

    // Return the updated profile
    const profile = {
      id: userId,
      email: req.user.email,
      name: name,
      organization: organization,
      avatar_url: avatar_url,
      email_verified: authUpdate.user.user_metadata?.email_verified || false,
      created_at: authUpdate.user.created_at,
      updated_at: new Date().toISOString()
    };

    res.json(profile);
  } catch (error) {
    await logger.error(`Unexpected error in updateUserProfile endpoint`, error);
    res.status(500).json({ error: 'Internal server error while updating profile' });
  }
};

/**
 * Change user password
 */
const changePassword = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Current password and new password are required' });
    }

    await logger.auth(`Password change requested for user ${userId}`);

    // First verify the current password by trying to sign in
    const { data: userData } = await supabaseAdmin.auth.admin.getUserById(userId);
    
    if (!userData) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Verify current password by attempting sign in
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: userData.user.email,
      password: currentPassword
    });

    if (signInError) {
      await logger.auth(`Current password verification failed for user ${userId}`);
      return res.status(401).json({ error: 'Current password is incorrect' });
    }

    // Update password
    const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(
      userId,
      { password: newPassword }
    );

    if (updateError) {
      await logger.error(`Failed to update password`, updateError);
      return res.status(500).json({ error: 'Failed to update password' });
    }

    await logger.auth(`Password successfully changed for user ${userId}`);
    res.json({ message: 'Password has been successfully changed' });
  } catch (error) {
    await logger.error(`Unexpected error in changePassword endpoint`, error);
    next(error);
  }
};

/**
 * List all users (for admin purposes or user search)
 */
const listUsers = async (req, res, next) => {
  try {
    const { limit = 50, page = 1 } = req.query;
    const userId = req.user.id;
    
    await logger.auth(`Listing users requested by ${userId}`);

    // Calculate offset for pagination
    const offset = (page - 1) * limit;

    // Get all users from auth
    const { data: users, error } = await supabaseAdmin.auth.admin.listUsers({
      page: page,
      perPage: limit
    });

    if (error) {
      await logger.error(`Failed to list users`, error);
      return res.status(500).json({ error: 'Failed to retrieve users' });
    }

    // Get user IDs to fetch additional data from database
    const userIds = users.users.map(u => u.id);

    // Fetch GitHub profile data from database
    const { data: dbUsers, error: dbError } = await supabaseAdmin
      .from('users')
      .select('id, github_id, github_username, github_avatar_url, github_profile_url')
      .in('id', userIds);

    // Create a map for quick lookup
    const dbUserMap = {};
    if (dbUsers) {
      dbUsers.forEach(dbUser => {
        dbUserMap[dbUser.id] = dbUser;
      });
    }

    // Format the response
    const formattedUsers = users.users.map(user => {
      const dbUser = dbUserMap[user.id];
      return {
        id: user.id,
        email: user.email,
        name: user.user_metadata?.name || user.email.split('@')[0],
        organization: user.user_metadata?.organization,
        avatar_url: user.user_metadata?.avatar_url,
        github_id: dbUser?.github_id || null,
        github_username: dbUser?.github_username || null,
        github_avatar_url: dbUser?.github_avatar_url || null,
        github_profile_url: dbUser?.github_profile_url || null,
        created_at: user.created_at
      };
    });

    res.json({
      users: formattedUsers,
      total: users.total,
      page: page,
      limit: limit,
      total_pages: Math.ceil(users.total / limit)
    });
  } catch (error) {
    await logger.error(`Unexpected error in listUsers endpoint`, error);
    next(error);
  }
};

/**
 * Search users by name or email
 */
const searchUsers = async (req, res, next) => {
  try {
    const { query, limit = 10 } = req.query;
    const userId = req.user.id;
    
    if (!query || query.length < 2) {
      return res.status(400).json({ error: 'Search query must be at least 2 characters' });
    }

    await logger.auth(`User search for "${query}" by ${userId}`);

    // Search in both auth users and our users table
    // First, get all users (limited approach for now, can be optimized with proper search)
    const { data: authUsers, error: authError } = await supabaseAdmin.auth.admin.listUsers();

    if (authError) {
      await logger.error(`Failed to search users`, authError);
      return res.status(500).json({ error: 'Failed to search users' });
    }

    // Filter users based on query
    const searchLower = query.toLowerCase();
    const matched = authUsers.users
      .filter(user => {
        const email = user.email?.toLowerCase() || '';
        const name = (user.user_metadata?.name || '').toLowerCase();
        return email.includes(searchLower) || name.includes(searchLower);
      })
      .slice(0, limit);

    // Get user IDs to fetch additional data from database
    const userIds = matched.map(u => u.id);

    // Fetch GitHub profile data from database
    const { data: dbUsers, error: dbError } = await supabaseAdmin
      .from('users')
      .select('id, github_id, github_username, github_avatar_url, github_profile_url')
      .in('id', userIds);

    // Create a map for quick lookup
    const dbUserMap = {};
    if (dbUsers) {
      dbUsers.forEach(dbUser => {
        dbUserMap[dbUser.id] = dbUser;
      });
    }

    // Format matched users with GitHub data
    const matchedUsers = matched.map(user => {
      const dbUser = dbUserMap[user.id];
      return {
        id: user.id,
        email: user.email,
        name: user.user_metadata?.name || user.email.split('@')[0],
        organization: user.user_metadata?.organization,
        avatar_url: user.user_metadata?.avatar_url,
        github_id: dbUser?.github_id || null,
        github_username: dbUser?.github_username || null,
        github_avatar_url: dbUser?.github_avatar_url || null,
        github_profile_url: dbUser?.github_profile_url || null
      };
    });

    await logger.auth(`Found ${matchedUsers.length} users matching "${query}"`);

    res.json({
      query: query,
      results: matchedUsers,
      count: matchedUsers.length
    });
  } catch (error) {
    await logger.error(`Unexpected error in searchUsers endpoint`, error);
    next(error);
  }
};

/**
 * Get tasks assigned to or requested for the current user/agent
 */
const getMyTasks = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { requested, status, limit = 50 } = req.query;
    const limitNum = parseInt(limit, 10) || 50;

    // Get plans the user has access to (owned or collaborator)
    const { data: ownedPlans } = await supabaseAdmin
      .from('plans')
      .select('id')
      .eq('owner_id', userId);

    const { data: collabPlans } = await supabaseAdmin
      .from('plan_collaborators')
      .select('plan_id')
      .eq('user_id', userId);

    const planIds = [
      ...(ownedPlans || []).map(p => p.id),
      ...(collabPlans || []).map(c => c.plan_id)
    ];

    if (planIds.length === 0) {
      return res.json({ tasks: [], total: 0 });
    }

    // Build query for tasks
    let query = supabaseAdmin
      .from('plan_nodes')
      .select(`
        id,
        title,
        description,
        node_type,
        status,
        agent_requested,
        agent_requested_at,
        agent_requested_by,
        agent_request_message,
        plan_id,
        parent_id,
        created_at,
        updated_at,
        plans:plan_id (
          id,
          title
        )
      `)
      .in('plan_id', planIds)
      .in('node_type', ['task', 'milestone']); // Only tasks and milestones

    // Filter by agent_requested if requested=true
    if (requested === 'true') {
      query = query.not('agent_requested', 'is', null);
    }

    // Filter by status if provided
    if (status) {
      query = query.eq('status', status);
    }

    // Order by agent_requested_at (most recent first), then by updated_at
    query = query
      .order('agent_requested_at', { ascending: false, nullsFirst: false })
      .order('updated_at', { ascending: false })
      .limit(limitNum);

    const { data: tasks, error } = await query;

    if (error) {
      await logger.error('Failed to fetch my-tasks:', error);
      return res.status(500).json({ error: 'Failed to fetch tasks' });
    }

    // Get assignments for these tasks to include assigned tasks
    const taskIds = tasks.map(t => t.id);
    let assignedTasks = [];
    
    if (taskIds.length > 0 && requested !== 'true') {
      const { data: assignments } = await supabaseAdmin
        .from('plan_node_assignments')
        .select('plan_node_id')
        .eq('user_id', userId)
        .in('plan_node_id', taskIds);

      if (assignments) {
        const assignedIds = new Set(assignments.map(a => a.plan_node_id));
        assignedTasks = tasks.filter(t => assignedIds.has(t.id));
      }
    }

    // Format response
    const formattedTasks = tasks.map(task => ({
      id: task.id,
      title: task.title,
      description: task.description,
      node_type: task.node_type,
      status: task.status,
      plan_id: task.plan_id,
      plan_title: task.plans?.title,
      parent_id: task.parent_id,
      agent_request: task.agent_requested ? {
        type: task.agent_requested,
        message: task.agent_request_message,
        requested_at: task.agent_requested_at,
        requested_by: task.agent_requested_by
      } : null,
      created_at: task.created_at,
      updated_at: task.updated_at
    }));

    res.json({
      tasks: formattedTasks,
      total: formattedTasks.length
    });
  } catch (error) {
    await logger.error('Unexpected error in getMyTasks:', error);
    next(error);
  }
};

module.exports = {
  getUserProfile,
  updateUserProfile,
  changePassword,
  listUsers,
  searchUsers,
  getMyTasks
};
