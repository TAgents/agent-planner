const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');
const { tokensDal } = require('../db/dal.cjs');

/**
 * Get all API tokens for a user
 */
const getTokens = async (req, res, next) => {
  try {
    const userId = req.user.id;

    const data = await tokensDal.listActiveByUserAndOrg(userId, req.user.organizationId || null);
    // The DAL projects to camelCase (Drizzle's default for `db.select({...})`)
    // but our public API contract — and the OpenAPI schema — uses snake_case
    // for token timestamps. Map at the controller boundary so internal code
    // can keep camelCase without leaking it to clients.
    const out = (Array.isArray(data) ? data : []).map((t) => ({
      id: t.id,
      name: t.name,
      permissions: t.permissions,
      created_at: t.createdAt,
      last_used: t.lastUsed,
    }));
    res.json(out);
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
    const { name } = req.body;

    if (!name) {
      return res.status(400).json({ error: 'Token name is required' });
    }

    // Token scopes were never enforced, and read-only tokens made agents
    // conclude they couldn't act (creating goals/plans/tasks). API tokens are
    // now full-access — same as the OAuth connector, which acts as the full
    // user. Any `permissions` in the body is ignored. `FULL_ACCESS` keeps the
    // column populated for back-compat with code that still reads it.
    const FULL_ACCESS = ['read', 'write', 'admin'];

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
      organizationId: req.user.organizationId || null,
      name,
      tokenHash: tokenHash,
      permissions: FULL_ACCESS,
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

    // Verify token belongs to the current org context
    const userOrgId = req.user.organizationId || null;
    const tokenOrgId = token.organizationId || null;
    if (tokenOrgId !== userOrgId) {
      return res.status(403).json({ error: 'Token belongs to a different organization' });
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
