const { supabaseAdmin: supabase } = require('../config/supabase');
const logger = require('../utils/logger');

/**
 * Debug endpoint to check token table contents for the current user
 */
const debugTokens = async (req, res, next) => {
  try {
    const userId = req.user.id;
    await logger.api(`Debug tokens called by user: ${userId}`);

    // Query all tokens for the user, including revoked ones
    const { data: allTokens, error: tokensError } = await supabase
      .from('api_tokens')
      .select('*')
      .eq('user_id', userId);

    if (tokensError) {
      await logger.error('Error fetching all tokens', tokensError);
      return res.status(500).json({ error: 'Failed to retrieve tokens for debugging' });
    }

    // Get a count of active (non-revoked) tokens
    const activeTokens = allTokens.filter(token => !token.revoked);
    
    // Log token counts
    await logger.api(`Debug tokens: Found ${allTokens.length} total tokens, ${activeTokens.length} active tokens`);
    
    // Return detailed token information
    res.json({
      userId,
      totalTokenCount: allTokens.length,
      activeTokenCount: activeTokens.length,
      tokens: allTokens.map(token => ({
        id: token.id,
        name: token.name,
        created_at: token.created_at,
        last_used: token.last_used,
        revoked: token.revoked,
        permissions: token.permissions
      }))
    });
  } catch (error) {
    await logger.error('Error in debug tokens endpoint', error);
    next(error);
  }
};

module.exports = {
  debugTokens
};
