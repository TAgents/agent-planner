const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');
const { tokensDal } = require('../db/dal.cjs');
const logger = require('../utils/logger');

/**
 * Get all API tokens for a user
 */
const getTokens = async (req, res, next) => {
  try {
    const userId = req.user.id;

    const data = await tokensDal.listActiveByUser(userId);
    res.json(data);
  } catch (error) {
    next(error);
  }
};

/**
 * Create a new API token
 */
const createToken = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { name, permissions = ['read'] } = req.body;

    if (!name) {
      return res.status(400).json({ error: 'Token name is required' });
    }

    // Validate permissions
    const validPermissions = ['read', 'write', 'admin'];
    for (const perm of permissions) {
      if (!validPermissions.includes(perm)) {
        return res.status(400).json({ 
          error: `Invalid permission: ${perm}. Valid values are: ${validPermissions.join(', ')}` 
        });
      }
    }

    // Generate a random token
    const tokenValue = crypto.randomBytes(32).toString('hex');
    
    // Hash token for storage
    const tokenHash = crypto
      .createHash('sha256')
      .update(tokenValue)
      .digest('hex');

    const tokenId = uuidv4();
    const now = new Date();

    // Store token in database
    const data = await tokensDal.create({
      id: tokenId,
      userId: userId,
      name,
      tokenHash: tokenHash,
      permissions,
      createdAt: now,
      revoked: false
    });

    // Return token data with the token value (will only be shown once)
    res.status(201).json({
      id: data.id,
      name: data.name,
      createdAt: data.createdAt,
      permissions: data.permissions,
      token: tokenValue
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Revoke (delete) an API token
 */
const revokeToken = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { id: tokenId } = req.params;

    // Verify the token belongs to the user
    const token = await tokensDal.findByUserAndId(userId, tokenId);

    if (!token) {
      return res.status(404).json({ error: 'Token not found' });
    }

    // Update the token to mark it as revoked
    await tokensDal.revoke(tokenId);

    res.status(204).send();
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getTokens,
  createToken,
  revokeToken
};