const { auth, adminAuth } = require('../services/supabase-auth');
const logger = require('../utils/logger');
const { convertPendingInvites } = require('../services/invites');
const createPersonalOrganization = async (userId, userName, email) => null;
require('dotenv').config();

/**
 * Register a new user
 */
const register = async (req, res, next) => {
  try {
    await logger.auth(`Register request received for email: ${req.body.email}`);
    const { email, password, name, organization } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const { data: authData, error: authError } = await auth.signUp({
      email,
      password,
      options: {
        data: {
          name: name || email.split('@')[0],
          organization: organization || null,
          email_verified: false
        },
        emailRedirectTo: `${process.env.FRONTEND_URL || 'http://localhost:3001'}/verify-email`
      }
    });

    if (authError) {
      await logger.error(`Supabase Auth signUp failed for ${email}`, authError);
      return res.status(400).json({ error: authError.message });
    }

    const userName = authData.user.user_metadata?.name || email.split('@')[0];
    const inviteResult = await convertPendingInvites(authData.user.id, email, userName);
    if (inviteResult.converted > 0) {
      await logger.auth(`Converted ${inviteResult.converted} pending invites for ${email}`);
    }

    const personalOrg = await createPersonalOrganization(authData.user.id, userName, email);

    res.status(201).json({
      user: {
        id: authData.user.id,
        email: authData.user.email,
        name: userName,
        organization: authData.user.user_metadata?.organization,
        email_verified: false
      },
      session: authData.session,
      converted_invites: inviteResult.invites
    });
  } catch (error) {
    await logger.error(`Unexpected error in register endpoint`, error);
    next(error);
  }
};

/**
 * Login a user
 */
const login = async (req, res, next) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const { data, error } = await auth.signInWithPassword({ email, password });

    if (error) {
      if (error.message === 'Email not confirmed') {
        return res.status(401).json({ error: 'Please verify your email address.', code: 'EMAIL_NOT_CONFIRMED', email });
      }
      if (error.message === 'Invalid login credentials') {
        return res.status(401).json({ error: 'Invalid email or password.', code: 'INVALID_CREDENTIALS' });
      }
      return res.status(401).json({ error: error.message });
    }

    const userName = data.user.user_metadata?.name || email.split('@')[0];
    const inviteResult = await convertPendingInvites(data.user.id, email, userName);

    res.json({
      user: {
        id: data.user.id,
        email: data.user.email,
        name: userName,
        organization: data.user.user_metadata?.organization,
        email_verified: data.user.user_metadata?.email_verified || false
      },
      session: data.session,
      converted_invites: inviteResult.invites
    });
  } catch (error) {
    await logger.error(`Unexpected error in login endpoint`, error);
    next(error);
  }
};

const logout = async (req, res, next) => {
  try {
    res.json({ message: 'Successfully logged out' });
  } catch (error) {
    next(error);
  }
};

const forgotPassword = async (req, res, next) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email is required' });

    await auth.resetPasswordForEmail(email, {
      redirectTo: `${process.env.FRONTEND_URL || 'http://localhost:3001'}/reset-password`,
    });

    res.json({ message: 'If an account exists with that email, a password reset link has been sent.' });
  } catch (error) {
    next(error);
  }
};

const resetPassword = async (req, res, next) => {
  try {
    const { token, password } = req.body;
    if (!token || !password) return res.status(400).json({ error: 'Token and new password are required' });

    const { data, error } = await auth.updateUser({ password });
    if (error) return res.status(400).json({ error: 'Invalid or expired reset token' });

    res.json({ message: 'Password has been successfully reset' });
  } catch (error) {
    next(error);
  }
};

const verifyEmail = async (req, res, next) => {
  try {
    const { token } = req.body;
    if (!token) return res.status(400).json({ error: 'Verification token is required' });

    const { data, error } = await auth.verifyOtp({ token_hash: token, type: 'email' });
    if (error) return res.status(400).json({ error: 'Invalid or expired verification token' });

    await adminAuth.admin.updateUserById(data.user.id, {
      user_metadata: { ...data.user.user_metadata, email_verified: true }
    });

    res.json({
      message: 'Email has been successfully verified',
      user: { id: data.user.id, email: data.user.email, email_verified: true }
    });
  } catch (error) {
    next(error);
  }
};

const resendVerificationEmail = async (req, res, next) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email is required' });

    const { data: userData } = await adminAuth.admin.listUsers();
    const user = userData?.users?.find(u => u.email === email);
    if (!user) return res.json({ message: 'If an account exists with that email, a verification link has been sent.' });
    if (user.user_metadata?.email_verified) return res.status(400).json({ error: 'Email is already verified' });

    await auth.resend({
      type: 'signup', email,
      options: { emailRedirectTo: `${process.env.FRONTEND_URL || 'http://localhost:3001'}/verify-email` }
    });

    res.json({ message: 'Verification email has been sent' });
  } catch (error) {
    next(error);
  }
};

const getUserProfile = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { data: userData, error } = await adminAuth.admin.getUserById(userId);
    if (error || !userData) return res.status(404).json({ error: 'User not found' });

    res.json({
      id: userData.user.id,
      email: userData.user.email,
      name: userData.user.user_metadata?.name,
      organization: userData.user.user_metadata?.organization,
      avatar_url: userData.user.user_metadata?.avatar_url,
      email_verified: userData.user.user_metadata?.email_verified || false,
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

    const { data: currentUser, error: getUserError } = await adminAuth.admin.getUserById(userId);
    if (getUserError || !currentUser) return res.status(404).json({ error: 'User not found' });

    const { data: userData, error: updateError } = await adminAuth.admin.updateUserById(userId, {
      user_metadata: {
        ...currentUser.user.user_metadata,
        name: name !== undefined ? name : currentUser.user.user_metadata?.name,
        organization: organization !== undefined ? organization : currentUser.user.user_metadata?.organization,
        avatar_url: avatar_url !== undefined ? avatar_url : currentUser.user.user_metadata?.avatar_url
      }
    });

    if (updateError) return res.status(500).json({ error: 'Failed to update profile' });

    res.json({
      id: userData.user.id,
      email: userData.user.email,
      name: userData.user.user_metadata?.name,
      organization: userData.user.user_metadata?.organization,
      avatar_url: userData.user.user_metadata?.avatar_url,
      email_verified: userData.user.user_metadata?.email_verified || false,
      created_at: userData.user.created_at,
      updated_at: userData.user.updated_at
    });
  } catch (error) {
    next(error);
  }
};

const refreshToken = async (req, res, next) => {
  try {
    const { refresh_token } = req.body;
    if (!refresh_token) return res.status(400).json({ error: 'Refresh token is required' });

    const { data, error } = await auth.refreshSession({ refresh_token });
    if (error) return res.status(401).json({ error: 'Invalid or expired refresh token' });

    res.json({
      access_token: data.session.access_token,
      refresh_token: data.session.refresh_token,
      expires_at: data.session.expires_at
    });
  } catch (error) {
    next(error);
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

module.exports = {
  register, login, logout, forgotPassword, resetPassword,
  verifyEmail, resendVerificationEmail, getUserProfile,
  updateUserProfile, changePassword, refreshToken
};
