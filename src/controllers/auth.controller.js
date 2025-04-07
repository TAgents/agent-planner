const { supabase } = require('../config/supabase');
const logger = require('../utils/logger');
require('dotenv').config();

/**
 * Register a new user
 */
const register = async (req, res, next) => {
  try {
    await logger.auth(`Register request received for email: ${req.body.email}`);
    await logger.auth(`Register request body: ${JSON.stringify(req.body)}`);
    const { email, password, name } = req.body;

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
          name: name || email.split('@')[0]  // Store name in user metadata
        }
      }
    });

    if (authError) {
      await logger.error(`Supabase Auth signUp failed for ${email}`, authError);
      return res.status(400).json({ error: authError.message });
    }
    
    await logger.auth(`Supabase Auth signUp succeeded for ${email}. User ID: ${authData.user?.id}`);

    // Return the Supabase session data directly
    await logger.auth(`Preparing response for successful registration: ${email}`);
    const response = {
      user: {
        id: authData.user.id,
        email: authData.user.email,
        name: authData.user.user_metadata?.name || email.split('@')[0]
      },
      session: authData.session  // This includes the access_token and refresh_token
    };
    
    await logger.auth(`Sending registration success response with status 201 for: ${email}`);
    res.status(201).json(response);
    await logger.auth(`Registration process completed successfully for: ${email}`);
  } catch (error) {
    await logger.error(`Unexpected error in register endpoint for email: ${req.body?.email || 'unknown'}`, error);
    next(error);
  }
};

/**
 * Login a user
 */
const login = async (req, res, next) => {
  try {
    await logger.auth(`Login request received for email: ${req.body.email}`);
    await logger.auth(`Login request body: ${JSON.stringify(req.body)}`);
    const { email, password } = req.body;

    if (!email || !password) {
      await logger.auth('Login failed: Email and password are required');
      return res.status(400).json({ error: 'Email and password are required' });
    }

    // Sign in with Supabase Auth
    await logger.auth(`Attempting to sign in with Supabase Auth for: ${email}`);
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    
    if (error) {
      await logger.error(`Supabase Auth sign in failed for ${email}`, error);
      return res.status(401).json({ error: error.message });
    }
    
    await logger.auth(`Supabase Auth sign in succeeded for ${email}. User ID: ${data.user?.id}`);

    // Return the Supabase session data directly
    await logger.auth(`Sending login success response for: ${email}`);
    res.json({
      user: {
        id: data.user.id,
        email: data.user.email,
        name: data.user.user_metadata?.name || email.split('@')[0]
      },
      session: data.session  // This includes the access_token and refresh_token
    });
    await logger.auth(`Login process completed successfully for: ${email}`);
  } catch (error) {
    await logger.error(`Unexpected error in login endpoint for email: ${req.body?.email || 'unknown'}`, error);
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

module.exports = {
  register,
  login,
  logout
};
