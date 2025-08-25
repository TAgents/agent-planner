const { supabase, supabaseAdmin } = require('../config/supabase');
const logger = require('../utils/logger');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
require('dotenv').config();

// Email transporter configuration (you'll need to configure this with your email service)
const createEmailTransporter = () => {
  // Use environment variables for email configuration
  if (process.env.EMAIL_SERVICE === 'gmail') {
    return nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
      }
    });
  } else if (process.env.EMAIL_HOST) {
    return nodemailer.createTransport({
      host: process.env.EMAIL_HOST,
      port: process.env.EMAIL_PORT || 587,
      secure: process.env.EMAIL_SECURE === 'true',
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
      }
    });
  }
  return null;
};

/**
 * Register a new user
 */
const register = async (req, res, next) => {
  try {
    await logger.auth(`Register request received for email: ${req.body.email}`);
    const { email, password, name, organization } = req.body;

    if (!email || !password) {
      await logger.auth('Registration failed: Email and password are required');
      return res.status(400).json({ error: 'Email and password are required' });
    }

    // Create user with Supabase Auth
    await logger.auth(`Calling Supabase Auth signUp for email: ${email}`);
    const { data: authData, error: authError } = await supabase.auth.signUp({
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
    
    await logger.auth(`Supabase Auth signUp succeeded for ${email}. User ID: ${authData.user?.id}`);

    // Send verification email
    if (authData.user && process.env.SEND_VERIFICATION_EMAIL === 'true') {
      await sendVerificationEmail(authData.user.email, authData.user.id);
    }

    // Return the Supabase session data directly
    const response = {
      user: {
        id: authData.user.id,
        email: authData.user.email,
        name: authData.user.user_metadata?.name || email.split('@')[0],
        organization: authData.user.user_metadata?.organization,
        email_verified: false
      },
      session: authData.session
    };
    
    await logger.auth(`Sending registration success response with status 201 for: ${email}`);
    res.status(201).json(response);
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
    await logger.auth(`Login request received for email: ${req.body.email}`);
    const { email, password } = req.body;

    if (!email || !password) {
      await logger.auth('Login failed: Email and password are required');
      return res.status(400).json({ error: 'Email and password are required' });
    }

    // Sign in with Supabase Auth
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    
    if (error) {
      await logger.error(`Supabase Auth sign in failed for ${email}`, error);
      return res.status(401).json({ error: error.message });
    }
    
    await logger.auth(`Supabase Auth sign in succeeded for ${email}. User ID: ${data.user?.id}`);

    // Return the Supabase session data
    res.json({
      user: {
        id: data.user.id,
        email: data.user.email,
        name: data.user.user_metadata?.name || email.split('@')[0],
        organization: data.user.user_metadata?.organization,
        email_verified: data.user.user_metadata?.email_verified || false
      },
      session: data.session
    });
  } catch (error) {
    await logger.error(`Unexpected error in login endpoint`, error);
    next(error);
  }
};

/**
 * Logout a user
 */
const logout = async (req, res, next) => {
  try {
    await logger.auth(`Logout request received from user ${req.user?.email || 'unknown'}`);
    
    // With Supabase, we don't need to do anything server-side for logout
    // The client will clear the session token
    
    await logger.auth(`User successfully logged out`);
    res.json({ message: 'Successfully logged out' });
  } catch (error) {
    await logger.error(`Unexpected error in logout endpoint`, error);
    next(error);
  }
};

/**
 * Request password reset
 */
const forgotPassword = async (req, res, next) => {
  try {
    const { email } = req.body;
    
    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }

    await logger.auth(`Password reset requested for email: ${email}`);

    // Use Supabase's built-in password reset
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${process.env.FRONTEND_URL || 'http://localhost:3001'}/reset-password`,
    });

    if (error) {
      await logger.error(`Password reset request failed for ${email}`, error);
      // Don't reveal if email exists or not for security
      return res.json({ message: 'If an account exists with that email, a password reset link has been sent.' });
    }

    await logger.auth(`Password reset email sent to ${email}`);
    res.json({ message: 'If an account exists with that email, a password reset link has been sent.' });
  } catch (error) {
    await logger.error(`Unexpected error in forgotPassword endpoint`, error);
    next(error);
  }
};

/**
 * Reset password with token
 */
const resetPassword = async (req, res, next) => {
  try {
    const { token, password } = req.body;

    if (!token || !password) {
      return res.status(400).json({ error: 'Token and new password are required' });
    }

    await logger.auth(`Password reset attempt with token`);

    // Verify the token and update password using Supabase
    const { data, error } = await supabase.auth.updateUser({
      password: password
    });

    if (error) {
      await logger.error(`Password reset failed`, error);
      return res.status(400).json({ error: 'Invalid or expired reset token' });
    }

    await logger.auth(`Password successfully reset for user ${data.user?.email}`);
    res.json({ message: 'Password has been successfully reset' });
  } catch (error) {
    await logger.error(`Unexpected error in resetPassword endpoint`, error);
    next(error);
  }
};

/**
 * Verify email with token
 */
const verifyEmail = async (req, res, next) => {
  try {
    const { token } = req.body;

    if (!token) {
      return res.status(400).json({ error: 'Verification token is required' });
    }

    await logger.auth(`Email verification attempt with token`);

    // Verify the email using Supabase
    const { data, error } = await supabase.auth.verifyOtp({
      token_hash: token,
      type: 'email'
    });

    if (error) {
      await logger.error(`Email verification failed`, error);
      return res.status(400).json({ error: 'Invalid or expired verification token' });
    }

    // Update user metadata to mark email as verified
    const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(
      data.user.id,
      {
        user_metadata: {
          ...data.user.user_metadata,
          email_verified: true
        }
      }
    );

    if (updateError) {
      await logger.error(`Failed to update email verification status`, updateError);
    }

    await logger.auth(`Email successfully verified for user ${data.user?.email}`);
    res.json({ 
      message: 'Email has been successfully verified',
      user: {
        id: data.user.id,
        email: data.user.email,
        email_verified: true
      }
    });
  } catch (error) {
    await logger.error(`Unexpected error in verifyEmail endpoint`, error);
    next(error);
  }
};

/**
 * Resend verification email
 */
const resendVerificationEmail = async (req, res, next) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }

    await logger.auth(`Resend verification email requested for: ${email}`);

    // Get user by email
    const { data: userData, error: userError } = await supabaseAdmin.auth.admin.listUsers();
    
    if (userError) {
      await logger.error(`Failed to list users`, userError);
      return res.status(500).json({ error: 'Failed to process request' });
    }

    const user = userData.users.find(u => u.email === email);
    
    if (!user) {
      // Don't reveal if email exists or not for security
      return res.json({ message: 'If an account exists with that email, a verification link has been sent.' });
    }

    if (user.user_metadata?.email_verified) {
      return res.status(400).json({ error: 'Email is already verified' });
    }

    // Resend verification email
    const { error } = await supabase.auth.resend({
      type: 'signup',
      email: email,
      options: {
        emailRedirectTo: `${process.env.FRONTEND_URL || 'http://localhost:3001'}/verify-email`
      }
    });

    if (error) {
      await logger.error(`Failed to resend verification email`, error);
      return res.status(500).json({ error: 'Failed to send verification email' });
    }

    await logger.auth(`Verification email resent to ${email}`);
    res.json({ message: 'Verification email has been sent' });
  } catch (error) {
    await logger.error(`Unexpected error in resendVerificationEmail endpoint`, error);
    next(error);
  }
};

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

    const profile = {
      id: userData.user.id,
      email: userData.user.email,
      name: userData.user.user_metadata?.name,
      organization: userData.user.user_metadata?.organization,
      avatar_url: userData.user.user_metadata?.avatar_url,
      email_verified: userData.user.user_metadata?.email_verified || false,
      created_at: userData.user.created_at,
      updated_at: userData.user.updated_at
    };

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

    // Get current user data
    const { data: currentUser, error: getUserError } = await supabaseAdmin.auth.admin.getUserById(userId);

    if (getUserError || !currentUser) {
      await logger.error(`Failed to get user for update`, getUserError);
      return res.status(404).json({ error: 'User not found' });
    }

    // Update user metadata
    const updatedMetadata = {
      ...currentUser.user.user_metadata,
      name: name !== undefined ? name : currentUser.user.user_metadata?.name,
      organization: organization !== undefined ? organization : currentUser.user.user_metadata?.organization,
      avatar_url: avatar_url !== undefined ? avatar_url : currentUser.user.user_metadata?.avatar_url
    };

    const { data: userData, error: updateError } = await supabaseAdmin.auth.admin.updateUserById(
      userId,
      {
        user_metadata: updatedMetadata
      }
    );

    if (updateError) {
      await logger.error(`Failed to update user profile`, updateError);
      return res.status(500).json({ error: 'Failed to update profile' });
    }

    await logger.auth(`Profile updated successfully for user ${userId}`);

    const profile = {
      id: userData.user.id,
      email: userData.user.email,
      name: userData.user.user_metadata?.name,
      organization: userData.user.user_metadata?.organization,
      avatar_url: userData.user.user_metadata?.avatar_url,
      email_verified: userData.user.user_metadata?.email_verified || false,
      created_at: userData.user.created_at,
      updated_at: userData.user.updated_at
    };

    res.json(profile);
  } catch (error) {
    await logger.error(`Unexpected error in updateUserProfile endpoint`, error);
    next(error);
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

/**
 * Helper function to send verification email
 */
const sendVerificationEmail = async (email, userId) => {
  try {
    const transporter = createEmailTransporter();
    
    if (!transporter) {
      await logger.warn('Email transporter not configured, skipping verification email');
      return;
    }

    const verificationToken = crypto.randomBytes(32).toString('hex');
    const verificationUrl = `${process.env.FRONTEND_URL || 'http://localhost:3001'}/verify-email?token=${verificationToken}`;

    // Store token in user metadata (in production, use a separate table with expiry)
    await supabaseAdmin.auth.admin.updateUserById(userId, {
      user_metadata: {
        verification_token: verificationToken,
        verification_token_expires: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() // 24 hours
      }
    });

    const mailOptions = {
      from: process.env.EMAIL_FROM || 'noreply@agentplanner.com',
      to: email,
      subject: 'Verify your Agent Planner account',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2>Welcome to Agent Planner!</h2>
          <p>Please verify your email address by clicking the link below:</p>
          <p style="margin: 30px 0;">
            <a href="${verificationUrl}" 
               style="background-color: #3b82f6; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; display: inline-block;">
              Verify Email
            </a>
          </p>
          <p>Or copy and paste this link into your browser:</p>
          <p style="color: #666; word-break: break-all;">${verificationUrl}</p>
          <p style="color: #666; margin-top: 30px;">This link will expire in 24 hours.</p>
        </div>
      `
    };

    await transporter.sendMail(mailOptions);
    await logger.auth(`Verification email sent to ${email}`);
  } catch (error) {
    await logger.error(`Failed to send verification email to ${email}`, error);
  }
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
  changePassword
};
