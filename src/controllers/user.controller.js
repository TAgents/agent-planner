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

module.exports = {
  getUserProfile,
  updateUserProfile,
  changePassword
};
