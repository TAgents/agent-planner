/**
 * Auth Controller v2 — Direct Postgres + JWT (no Supabase)
 */
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const logger = require('../utils/logger');
const dal = require('../db/dal.cjs');

const JWT_SECRET = process.env.JWT_SECRET;
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';
const REFRESH_EXPIRES_IN = process.env.REFRESH_EXPIRES_IN || '30d';
const SALT_ROUNDS = 12;

if (process.env.NODE_ENV === 'production' && (!JWT_SECRET || JWT_SECRET === 'dev-jwt-secret-change-in-production')) {
  throw new Error('JWT_SECRET must be set to a strong secret in production');
} else if (!JWT_SECRET || JWT_SECRET === 'dev-jwt-secret-change-in-production') {
  console.warn('⚠️  JWT_SECRET is not set or using default. Set a strong secret in production!');
}

function generateTokens(user) {
  const accessToken = jwt.sign(
    { sub: user.id, email: user.email, name: user.name },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN },
  );

  const refreshToken = jwt.sign(
    { sub: user.id, type: 'refresh' },
    JWT_SECRET,
    { expiresIn: REFRESH_EXPIRES_IN },
  );

  const decoded = jwt.decode(accessToken);

  return {
    access_token: accessToken,
    refresh_token: refreshToken,
    expires_at: decoded.exp,
  };
}

/**
 * Register a new user
 */
const register = async (req, res, next) => {
  try {
    const { email, password, name } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    // Check if user already exists
    const existing = await dal.usersDal.findByEmail(email);
    if (existing) {
      return res.status(409).json({ error: 'An account with this email already exists' });
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

    // Create user
    const user = await dal.usersDal.create({
      email,
      name: name || email.split('@')[0],
      passwordHash,
    });

    await logger.auth(`User registered: ${email} (${user.id})`);

    // Generate tokens
    const session = generateTokens(user);

    // Convert pending invites
    // TODO: migrate convertPendingInvites to use DAL

    res.status(201).json({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
      },
      session,
    });
  } catch (error) {
    await logger.error('Registration error', error);
    next(error);
  }
};

/**
 * Login with email + password
 */
const login = async (req, res, next) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const user = await dal.usersDal.findByEmail(email);
    if (!user || !user.passwordHash) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    await logger.auth(`User logged in: ${email}`);

    const session = generateTokens(user);

    res.json({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
      },
      session,
    });
  } catch (error) {
    await logger.error('Login error', error);
    next(error);
  }
};

/**
 * Logout (stateless — client discards tokens)
 */
const logout = async (req, res) => {
  res.json({ message: 'Successfully logged out' });
};

/**
 * Refresh access token
 */
const refreshToken = async (req, res, next) => {
  try {
    const { refresh_token } = req.body;

    if (!refresh_token) {
      return res.status(400).json({ error: 'Refresh token is required' });
    }

    let payload;
    try {
      payload = jwt.verify(refresh_token, JWT_SECRET);
    } catch (err) {
      return res.status(401).json({ error: 'Invalid or expired refresh token' });
    }

    if (payload.type !== 'refresh') {
      return res.status(401).json({ error: 'Invalid token type' });
    }

    const user = await dal.usersDal.findById(payload.sub);
    if (!user) {
      return res.status(401).json({ error: 'User not found' });
    }

    const session = generateTokens(user);

    res.json(session);
  } catch (error) {
    await logger.error('Token refresh error', error);
    next(error);
  }
};

/**
 * Change password (authenticated)
 */
const changePassword = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Current password and new password are required' });
    }

    const user = await dal.usersDal.findById(userId);
    if (!user || !user.passwordHash) {
      return res.status(404).json({ error: 'User not found' });
    }

    const valid = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!valid) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }

    const newHash = await bcrypt.hash(newPassword, SALT_ROUNDS);
    await dal.usersDal.update(userId, { passwordHash: newHash });

    await logger.auth(`Password changed for user ${userId}`);
    res.json({ message: 'Password has been successfully changed' });
  } catch (error) {
    await logger.error('Change password error', error);
    next(error);
  }
};

/**
 * Get current user profile
 */
const getUserProfile = async (req, res, next) => {
  try {
    const user = await dal.usersDal.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({
      id: user.id,
      email: user.email,
      name: user.name,
      avatar_url: user.avatarUrl,
      github_username: user.githubUsername,
      github_avatar_url: user.githubAvatarUrl,
      capability_tags: user.capabilityTags,
      created_at: user.createdAt,
      updated_at: user.updatedAt,
    });
  } catch (error) {
    await logger.error('Get profile error', error);
    next(error);
  }
};

/**
 * Update user profile
 */
const updateUserProfile = async (req, res, next) => {
  try {
    const { name, avatar_url } = req.body;
    const updates = {};
    if (name !== undefined) updates.name = name;
    if (avatar_url !== undefined) updates.avatarUrl = avatar_url;

    const user = await dal.usersDal.update(req.user.id, updates);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({
      id: user.id,
      email: user.email,
      name: user.name,
      avatar_url: user.avatarUrl,
      updated_at: user.updatedAt,
    });
  } catch (error) {
    await logger.error('Update profile error', error);
    next(error);
  }
};

/**
 * GitHub OAuth callback handler
 * Called after GitHub redirects back with auth code
 */
const githubCallback = async (req, res, next) => {
  try {
    const { code } = req.body;

    if (!code) {
      return res.status(400).json({ error: 'Authorization code is required' });
    }

    // Exchange code for access token
    const tokenResponse = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify({
        client_id: process.env.GITHUB_CLIENT_ID,
        client_secret: process.env.GITHUB_CLIENT_SECRET,
        code,
      }),
    });

    const tokenData = await tokenResponse.json();

    if (tokenData.error) {
      return res.status(401).json({ error: `GitHub OAuth error: ${tokenData.error_description}` });
    }

    // Get user info from GitHub
    const userResponse = await fetch('https://api.github.com/user', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });

    const ghUser = await userResponse.json();

    // Get primary email
    const emailResponse = await fetch('https://api.github.com/user/emails', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });

    const emails = await emailResponse.json();
    const primaryEmail = emails.find(e => e.primary)?.email || ghUser.email;

    if (!primaryEmail) {
      return res.status(400).json({ error: 'Could not get email from GitHub' });
    }

    // Find or create user
    let user = await dal.usersDal.findByGithubId(String(ghUser.id));

    if (!user) {
      // Check by email
      user = await dal.usersDal.findByEmail(primaryEmail);

      if (user) {
        // Link GitHub to existing account
        await dal.usersDal.update(user.id, {
          githubId: String(ghUser.id),
          githubUsername: ghUser.login,
          githubAvatarUrl: ghUser.avatar_url,
          githubProfileUrl: ghUser.html_url,
        });
      } else {
        // Create new user
        user = await dal.usersDal.create({
          email: primaryEmail,
          name: ghUser.name || ghUser.login,
          githubId: String(ghUser.id),
          githubUsername: ghUser.login,
          githubAvatarUrl: ghUser.avatar_url,
          githubProfileUrl: ghUser.html_url,
        });
      }
    } else {
      // Update GitHub info
      await dal.usersDal.update(user.id, {
        githubUsername: ghUser.login,
        githubAvatarUrl: ghUser.avatar_url,
        githubProfileUrl: ghUser.html_url,
      });
    }

    // Refresh user data
    user = await dal.usersDal.findById(user.id);

    await logger.auth(`GitHub OAuth login: ${primaryEmail} (@${ghUser.login})`);

    const session = generateTokens(user);

    res.json({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        github_username: user.githubUsername,
        github_avatar_url: user.githubAvatarUrl,
      },
      session,
      github_token: tokenData.access_token,  // pass through for repo access
    });
  } catch (error) {
    await logger.error('GitHub OAuth error', error);
    next(error);
  }
};

// Placeholder stubs for email-based flows (can be implemented later with nodemailer)
const forgotPassword = async (req, res) => {
  res.status(501).json({ error: 'Password reset via email not yet implemented in v2' });
};

const resetPassword = async (req, res) => {
  res.status(501).json({ error: 'Password reset via email not yet implemented in v2' });
};

const verifyEmail = async (req, res) => {
  res.status(501).json({ error: 'Email verification not yet implemented in v2' });
};

const resendVerificationEmail = async (req, res) => {
  res.status(501).json({ error: 'Email verification not yet implemented in v2' });
};

module.exports = {
  register,
  login,
  logout,
  forgotPassword,
  resetPassword,
  verifyEmail,
  resendVerificationEmail,
  getUserProfile,
  updateUserProfile,
  changePassword,
  refreshToken,
  githubCallback,
};
