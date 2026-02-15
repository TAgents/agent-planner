const logger = require('../utils/logger');

/**
 * Upload controller — Supabase Storage has been removed.
 * Avatar uploads are not yet implemented for v2.
 * TODO: Implement file storage via local disk, S3, or GCS.
 */

const uploadAvatar = async (req, res) => {
  res.status(501).json({ error: 'Avatar upload is not yet available. File storage is being migrated.' });
};

const deleteAvatar = async (req, res) => {
  res.status(501).json({ error: 'Avatar deletion is not yet available. File storage is being migrated.' });
};

module.exports = { uploadAvatar, deleteAvatar };
