const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');
const { supabaseAdmin: supabase } = require('../config/supabase');
const logger = require('../utils/logger');

/**
 * Get all API tokens for a user
 */
const getTokens = async (req, res, next) => {
  try {
    const userId = req.user.id;

    const { data, error } = await supabase
      .from('api_tokens')
      .select('id, name, created_at, last_used, permissions')
      .eq('user_id', userId)
      .eq('revoked', false);

    if (error) {
      await logger.error('Error fetching tokens', error);
      return res.status(500).json({ error: 'Failed to retrieve tokens' });
    }

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
    const { data, error } = await supabase
      .from('api_tokens')
      .insert([
        {
          id: tokenId,
          user_id: userId,
          name,
          token_hash: tokenHash,
          permissions,
          created_at: now,
          revoked: false
        },
      ])
      .select('id, name, created_at, permissions');

    if (error) {
      await logger.error('Error creating token', error);
      return res.status(400).json({ error: error.message });
    }

    // Return token data with the token value (will only be shown once)
    res.status(201).json({
      ...data[0],
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
    const { data: token, error: findError } = await supabase
      .from('api_tokens')
      .select('id')
      .eq('id', tokenId)
      .eq('user_id', userId)
      .single();

    if (findError) {
      if (findError.code === 'PGRST116') {
        return res.status(404).json({ error: 'Token not found' });
      }
      return res.status(500).json({ error: findError.message });
    }

    // Update the token to mark it as revoked
    const { error: updateError } = await supabase
      .from('api_tokens')
      .update({ revoked: true })
      .eq('id', tokenId);

    if (updateError) {
      await logger.error('Error revoking token', updateError);
      return res.status(500).json({ error: updateError.message });
    }

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