const { auth, adminAuth } = require('../services/supabase-auth');
const { usersDal, plansDal, nodesDal, collaboratorsDal } = require('../db/dal.cjs');
const logger = require('../utils/logger');

const getUserProfile = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { data: userData, error: userError } = await adminAuth.admin.getUserById(userId);
    if (userError || !userData) return res.status(404).json({ error: 'User not found' });

    const dbUser = await usersDal.findById(userId);

    res.json({
      id: userData.user.id,
      email: userData.user.email,
      name: dbUser?.name || userData.user.user_metadata?.name || userData.user.email.split('@')[0],
      organization: userData.user.user_metadata?.organization,
      avatar_url: dbUser?.avatarUrl || userData.user.user_metadata?.avatar_url,
      email_verified: userData.user.user_metadata?.email_verified || false,
      github_id: dbUser?.githubId || null,
      github_username: dbUser?.githubUsername || null,
      github_avatar_url: dbUser?.githubAvatarUrl || null,
      github_profile_url: dbUser?.githubProfileUrl || null,
      capability_tags: dbUser?.capabilityTags || [],
      created_at: userData.user.created_at,
      updated_at: userData.user.updated_at
    });
  } catch (error) {
    next(error);
  }
};

const updateUserProfile = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { name, organization, avatar_url } = req.body;

    const { data: authUpdate, error: authError } = await adminAuth.admin.updateUserById(userId, {
      user_metadata: { name, organization, avatar_url }
    });
    if (authError) return res.status(500).json({ error: 'Failed to update profile in auth system' });

    // Update or insert in users table
    const existingUser = await usersDal.findById(userId);
    if (existingUser) {
      await usersDal.update(userId, { name: name || null, avatarUrl: avatar_url || null });
    } else {
      await usersDal.create({ id: userId, email: req.user.email, name: name || null, avatarUrl: avatar_url || null });
    }

    res.json({
      id: userId,
      email: req.user.email,
      name,
      organization,
      avatar_url,
      email_verified: authUpdate.user.user_metadata?.email_verified || false,
      created_at: authUpdate.user.created_at,
      updated_at: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error while updating profile' });
  }
};

const changePassword = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) return res.status(400).json({ error: 'Current password and new password are required' });

    const { data: userData } = await adminAuth.admin.getUserById(userId);
    if (!userData) return res.status(404).json({ error: 'User not found' });

    const { error: signInError } = await auth.signInWithPassword({ email: userData.user.email, password: currentPassword });
    if (signInError) return res.status(401).json({ error: 'Current password is incorrect' });

    const { error: updateError } = await adminAuth.admin.updateUserById(userId, { password: newPassword });
    if (updateError) return res.status(500).json({ error: 'Failed to update password' });

    res.json({ message: 'Password has been successfully changed' });
  } catch (error) {
    next(error);
  }
};

const listUsers = async (req, res, next) => {
  try {
    const { limit = 50, page = 1 } = req.query;
    const { data: users, error } = await adminAuth.admin.listUsers({ page, perPage: limit });
    if (error) return res.status(500).json({ error: 'Failed to retrieve users' });

    const userIds = users.users.map(u => u.id);
    const dbUsers = await usersDal.findByIds(userIds);
    const dbUserMap = Object.fromEntries(dbUsers.map(u => [u.id, u]));

    res.json({
      users: users.users.map(user => {
        const dbUser = dbUserMap[user.id];
        return {
          id: user.id, email: user.email,
          name: user.user_metadata?.name || user.email.split('@')[0],
          organization: user.user_metadata?.organization,
          avatar_url: user.user_metadata?.avatar_url,
          github_id: dbUser?.githubId || null,
          github_username: dbUser?.githubUsername || null,
          github_avatar_url: dbUser?.githubAvatarUrl || null,
          github_profile_url: dbUser?.githubProfileUrl || null,
          created_at: user.created_at
        };
      }),
      total: users.total, page, limit, total_pages: Math.ceil(users.total / limit)
    });
  } catch (error) {
    next(error);
  }
};

const searchUsers = async (req, res, next) => {
  try {
    const { query, limit = 10 } = req.query;
    if (!query || query.length < 2) return res.status(400).json({ error: 'Search query must be at least 2 characters' });

    const { data: authUsers, error } = await adminAuth.admin.listUsers();
    if (error) return res.status(500).json({ error: 'Failed to search users' });

    const searchLower = query.toLowerCase();
    const matched = authUsers.users
      .filter(user => {
        const email = user.email?.toLowerCase() || '';
        const name = (user.user_metadata?.name || '').toLowerCase();
        return email.includes(searchLower) || name.includes(searchLower);
      })
      .slice(0, limit);

    const userIds = matched.map(u => u.id);
    const dbUsers = await usersDal.findByIds(userIds);
    const dbUserMap = Object.fromEntries(dbUsers.map(u => [u.id, u]));

    res.json({
      query,
      results: matched.map(user => {
        const dbUser = dbUserMap[user.id];
        return {
          id: user.id, email: user.email,
          name: user.user_metadata?.name || user.email.split('@')[0],
          avatar_url: user.user_metadata?.avatar_url,
          github_id: dbUser?.githubId || null,
          github_username: dbUser?.githubUsername || null,
          github_avatar_url: dbUser?.githubAvatarUrl || null,
          github_profile_url: dbUser?.githubProfileUrl || null
        };
      }),
      count: matched.length
    });
  } catch (error) {
    next(error);
  }
};

const getMyTasks = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { requested, status, limit = 50 } = req.query;
    const limitNum = parseInt(limit, 10) || 50;

    // Get all plan IDs user has access to
    const ownedPlans = await plansDal.listByOwner(userId);
    const collabPlanIds = await collaboratorsDal.listPlanIdsForUser(userId);
    const planIds = [...ownedPlans.map(p => p.id), ...collabPlanIds];

    if (planIds.length === 0) return res.json({ tasks: [], total: 0 });

    const filters = { nodeType: ['task', 'milestone'], limit: limitNum };
    if (requested === 'true') filters.agentRequested = true;
    if (status) filters.status = status;

    const tasks = await nodesDal.listByPlanIds(planIds, filters);

    // Get plan titles
    const allPlans = await plansDal.listByOwner(userId);
    const planMap = Object.fromEntries(allPlans.map(p => [p.id, p]));

    res.json({
      tasks: tasks.map(task => ({
        id: task.id, title: task.title, description: task.description,
        node_type: task.nodeType, status: task.status, plan_id: task.planId,
        plan_title: planMap[task.planId]?.title,
        parent_id: task.parentId,
        agent_request: task.agentRequested ? {
          type: task.agentRequested, message: task.agentRequestMessage,
          requested_at: task.agentRequestedAt, requested_by: task.agentRequestedBy
        } : null,
        created_at: task.createdAt, updated_at: task.updatedAt
      })),
      total: tasks.length
    });
  } catch (error) {
    next(error);
  }
};

const getCapabilityTags = async (req, res, next) => {
  try {
    const userId = req.params.userId || req.user.id;
    const user = await usersDal.findById(userId);
    res.json({ capability_tags: user?.capabilityTags || [] });
  } catch (error) {
    next(error);
  }
};

const updateCapabilityTags = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { capability_tags } = req.body;
    if (!Array.isArray(capability_tags)) return res.status(400).json({ error: 'capability_tags must be an array' });

    const normalized = [...new Set(capability_tags.map(t => String(t).toLowerCase().trim()).filter(Boolean))];
    if (normalized.length > 50) return res.status(400).json({ error: 'Maximum 50 capability tags allowed' });

    const existing = await usersDal.findById(userId);
    if (existing) {
      await usersDal.update(userId, { capabilityTags: normalized });
    } else {
      await usersDal.create({ id: userId, email: req.user.email, capabilityTags: normalized });
    }

    res.json({ capability_tags: normalized });
  } catch (error) {
    next(error);
  }
};

const searchByCapabilities = async (req, res, next) => {
  try {
    const { tags, match = 'any', limit = 20 } = req.query;
    if (!tags) return res.status(400).json({ error: 'tags query parameter is required' });

    const tagList = tags.split(',').map(t => t.toLowerCase().trim()).filter(Boolean);
    if (tagList.length === 0) return res.status(400).json({ error: 'At least one tag is required' });

    // Get all users with capability tags and filter in memory
    const allUsers = await usersDal.list({ limit: 1000 });
    const filtered = allUsers.filter(user => {
      const userTags = user.capabilityTags || [];
      if (userTags.length === 0) return false;
      if (match === 'all') return tagList.every(t => userTags.includes(t));
      return tagList.some(t => userTags.includes(t));
    }).slice(0, parseInt(limit));

    res.json({
      results: filtered.map(u => ({
        id: u.id, email: u.email, name: u.name, avatar_url: u.avatarUrl,
        capability_tags: u.capabilityTags
      })),
      count: filtered.length, tags: tagList, match
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getUserProfile, updateUserProfile, changePassword, listUsers,
  searchUsers, getMyTasks, getCapabilityTags, updateCapabilityTags, searchByCapabilities
};
