const { supabaseAdmin } = require('../config/supabase');
const logger = require('../utils/logger');
const path = require('path');
const fs = require('fs').promises;

/**
 * Upload user avatar
 */
const uploadAvatar = async (req, res, next) => {
  try {
    const userId = req.user.id;
    
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    await logger.auth(`Avatar upload requested for user ${userId}`);

    // Validate file type
    const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    if (!allowedTypes.includes(req.file.mimetype)) {
      return res.status(400).json({ error: 'Invalid file type. Only JPEG, PNG, GIF, and WebP are allowed.' });
    }

    // Validate file size (max 5MB)
    if (req.file.size > 5 * 1024 * 1024) {
      return res.status(400).json({ error: 'File size too large. Maximum size is 5MB.' });
    }

    // Generate unique filename
    const fileExt = path.extname(req.file.originalname);
    const fileName = `${userId}-${Date.now()}${fileExt}`;
    const filePath = `avatars/${fileName}`;

    // Upload to Supabase Storage
    const { data: uploadData, error: uploadError } = await supabaseAdmin.storage
      .from('avatars')
      .upload(filePath, req.file.buffer, {
        contentType: req.file.mimetype,
        upsert: false
      });

    if (uploadError) {
      await logger.error(`Failed to upload avatar to Supabase Storage`, uploadError);
      return res.status(500).json({ error: 'Failed to upload avatar' });
    }

    // Get public URL
    const { data: { publicUrl } } = supabaseAdmin.storage
      .from('avatars')
      .getPublicUrl(filePath);

    // Update user metadata with avatar URL
    const { data: userData, error: updateError } = await supabaseAdmin.auth.admin.updateUserById(
      userId,
      {
        user_metadata: {
          avatar_url: publicUrl
        }
      }
    );

    if (updateError) {
      // Try to delete the uploaded file if user update fails
      await supabaseAdmin.storage.from('avatars').remove([filePath]);
      await logger.error(`Failed to update user avatar URL`, updateError);
      return res.status(500).json({ error: 'Failed to update user profile' });
    }

    // Delete old avatar if exists
    if (userData.user.user_metadata?.avatar_url) {
      const oldPath = userData.user.user_metadata.avatar_url.split('/').pop();
      if (oldPath && oldPath !== fileName) {
        await supabaseAdmin.storage.from('avatars').remove([`avatars/${oldPath}`]);
      }
    }

    await logger.auth(`Avatar successfully uploaded for user ${userId}`);
    
    res.json({
      message: 'Avatar uploaded successfully',
      avatar_url: publicUrl
    });
  } catch (error) {
    await logger.error(`Unexpected error in uploadAvatar endpoint`, error);
    next(error);
  }
};

/**
 * Delete user avatar
 */
const deleteAvatar = async (req, res, next) => {
  try {
    const userId = req.user.id;
    
    await logger.auth(`Avatar deletion requested for user ${userId}`);

    // Get current user data
    const { data: userData, error: getUserError } = await supabaseAdmin.auth.admin.getUserById(userId);

    if (getUserError || !userData) {
      return res.status(404).json({ error: 'User not found' });
    }

    const avatarUrl = userData.user.user_metadata?.avatar_url;
    
    if (!avatarUrl) {
      return res.status(404).json({ error: 'No avatar to delete' });
    }

    // Extract file path from URL
    const filePath = avatarUrl.split('/').pop();
    
    if (filePath) {
      // Delete from Supabase Storage
      const { error: deleteError } = await supabaseAdmin.storage
        .from('avatars')
        .remove([`avatars/${filePath}`]);

      if (deleteError) {
        await logger.error(`Failed to delete avatar from storage`, deleteError);
      }
    }

    // Update user metadata to remove avatar URL
    const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(
      userId,
      {
        user_metadata: {
          avatar_url: null
        }
      }
    );

    if (updateError) {
      await logger.error(`Failed to update user metadata`, updateError);
      return res.status(500).json({ error: 'Failed to update user profile' });
    }

    await logger.auth(`Avatar successfully deleted for user ${userId}`);
    
    res.json({
      message: 'Avatar deleted successfully'
    });
  } catch (error) {
    await logger.error(`Unexpected error in deleteAvatar endpoint`, error);
    next(error);
  }
};

module.exports = {
  uploadAvatar,
  deleteAvatar
};
