const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');
const { supabase, supabaseAdmin } = require('../config/supabase');
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

    // Create user in Supabase Auth
    await logger.auth(`Calling Supabase Auth signUp for email: ${email}`);
    const { data: authData, error: authError } = await supabase.auth.signUp({
      email,
      password,
    });

    if (authError) {
      await logger.error(`Supabase Auth signUp failed for ${email}`, authError);
      return res.status(400).json({ error: authError.message });
    }
    
    await logger.auth(`Supabase Auth signUp succeeded for ${email}. User ID: ${authData.user?.id}`);

    // Insert user record in our custom users table
    await logger.auth(`Inserting user into custom users table. User ID: ${authData.user.id}`);
    const userId = authData.user.id;
    
    const userData = {
      id: userId,
      email,
      name: name || email.split('@')[0], // Use part of email as name if not provided
      created_at: new Date(),
      updated_at: new Date(),
    };
    
    await logger.auth(`User data to insert: ${JSON.stringify(userData)}`);
    
    const { error: dbError } = await supabase
      .from('users')
      .insert([userData]);

    if (dbError) {
      await logger.error(`Failed to insert user into custom table: ${dbError.message}`, dbError);
      await logger.auth(`Database error details - Code: ${dbError.code}, Details: ${JSON.stringify(dbError.details || {})}`);
      
      // If we can't create the user record, we should clean up the auth user
      await logger.auth(`Cleaning up Supabase Auth user due to database error: ${userId}`);
      await supabaseAdmin.auth.admin.deleteUser(userId);
      return res.status(400).json({ error: dbError.message });
    }
    
    await logger.auth(`User record created successfully in custom users table: ${email}`);

    // Generate JWT token
    await logger.auth(`Generating JWT token for user: ${userId}`);
    await logger.auth(`JWT Secret is ${process.env.JWT_SECRET ? 'configured' : 'MISSING'}`);
    
    const token = jwt.sign(
      { userId, email },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRY || '8h' }
    );
    await logger.auth(`JWT token generated successfully for user: ${userId}`);

    // Return user info and token
    await logger.auth(`Preparing response for successful registration: ${email}`);
    const response = {
      user: {
        id: userId,
        email,
        name: name || email.split('@')[0],
      },
      token,
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

    // Get user from our custom users table
    await logger.auth(`Fetching user data from custom table for ID: ${data.user.id}`);
    const { data: userData, error: userError } = await supabase
      .from('users')
      .select('id, email, name')
      .eq('id', data.user.id)
      .single();

    if (userError) {
      await logger.error(`Failed to fetch user data from custom table: ${userError.message}`, userError);
      return res.status(500).json({ error: userError.message });
    }
    
    await logger.auth(`Successfully retrieved user data for: ${email}`);

    // Generate JWT token
    await logger.auth(`Generating JWT token for user: ${userData.id}`);
    const token = jwt.sign(
      { userId: userData.id, email: userData.email },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRY || '8h' }
    );
    await logger.auth(`JWT token generated successfully for user: ${userData.id}`);

    // Return user info and token
    await logger.auth(`Sending login success response for: ${email}`);
    res.json({
      user: userData,
      token,
    });
    await logger.auth(`Login process completed successfully for: ${email}`);
  } catch (error) {
    await logger.error(`Unexpected error in login endpoint for email: ${req.body?.email || 'unknown'}`, error);
    next(error);
  }
};

/**
 * Create an API token for a user
 */
const createApiToken = async (req, res, next) => {
  try {
    const { name, permissions = ['read'] } = req.body;
    const userId = req.user.id;

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

    // Store the token in the database
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

    // Return the token data with the token value (will only be shown once)
    res.status(201).json({
      ...data[0],
      token: tokenValue
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Revoke an API token
 */
const revokeApiToken = async (req, res, next) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    // Verify the token belongs to the user
    const { data: token, error: findError } = await supabase
      .from('api_tokens')
      .select('id')
      .eq('id', id)
      .eq('user_id', userId)
      .single();

    if (findError) {
      if (findError.code === 'PGRST116') {
        return res.status(404).json({ error: 'Token not found' });
      }
      return res.status(500).json({ error: findError.message });
    }

    // Mark the token as revoked instead of deleting it
    const { error: updateError } = await supabase
      .from('api_tokens')
      .update({ revoked: true })
      .eq('id', id);

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
  register,
  login,
  createApiToken,
  revokeApiToken,
};
