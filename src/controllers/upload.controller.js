const { adminAuth, storage } = require('../services/supabase-auth');
const logger = require('../utils/logger');
const path = require('path');

/**
 * Upload user avatar
 */
const uploadAvatar = async (req, res, next) => {
  try {
    const userId = req.user.id;
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    if (!allowedTypes.includes(req.file.mimetype)) {
      return res.status(400).json({ error: 'Invalid file type. Only JPEG, PNG, GIF, and WebP are allowed.' });
    }
    if (req.file.size > 5 * 1024 * 1024) {
      return res.status(400).json({ error: 'File size too large. Maximum size is 5MB.' });
    }

    const fileExt = path.extname(req.file.originalname);
    const fileName = `${userId}-${Date.now()}${fileExt}`;
    const filePath = `avatars/${fileName}`;

    const { error: uploadError } = await storage.from('avatars').upload(filePath, req.file.buffer, {
      contentType: req.file.mimetype, upsert: false
    });

    if (uploadError) {
      await logger.error(`Failed to upload avatar`, uploadError);
      return res.status(500).json({ error: 'Failed to upload avatar' });
    }

    const { data: { publicUrl } } = storage.from('avatars').getPublicUrl(filePath);

    const { data: userData, error: updateError } = await adminAuth.admin.updateUserById(userId, {
      user_metadata: { avatar_url: publicUrl }
    });

    if (updateError) {
      await storage.from('avatars').remove([filePath]);
      return res.status(500).json({ error: 'Failed to update user profile' });
    }

    // Delete old avatar
    if (userData.user.user_metadata?.avatar_url) {
      const oldPath = userData.user.user_metadata.avatar_url.split('/').pop();
      if (oldPath && oldPath !== fileName) {
        await storage.from('avatars').remove([`avatars/${oldPath}`]);
      }
    }

    res.json({ message: 'Avatar uploaded successfully', avatar_url: publicUrl });
  } catch (error) {
    await logger.error(`Unexpected error in uploadAvatar`, error);
    next(error);
  }
};

/**
 * Delete user avatar
 */
const deleteAvatar = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { data: userData, error: getUserError } = await adminAuth.admin.getUserById(userId);
    if (getUserError || !userData) return res.status(404).json({ error: 'User not found' });

    const avatarUrl = userData.user.user_metadata?.avatar_url;
    if (!avatarUrl) return res.status(404).json({ error: 'No avatar to delete' });

    const filePath = avatarUrl.split('/').pop();
    if (filePath) {
      await storage.from('avatars').remove([`avatars/${filePath}`]);
    }

    await adminAuth.admin.updateUserById(userId, { user_metadata: { avatar_url: null } });

    res.json({ message: 'Avatar deleted successfully' });
  } catch (error) {
    await logger.error(`Unexpected error in deleteAvatar`, error);
    next(error);
  }
};

module.exports = { uploadAvatar, deleteAvatar };
