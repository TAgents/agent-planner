const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
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
    const { name, scopes } = req.body;
    const userId = req.user.id;

    if (!name) {
      return res.status(400).json({ error: 'Token name is required' });
    }

    // Generate a unique API key
    const apiKey = uuidv4();
    
    // Hash the key for storage
    const keyHash = jwt.sign({ key: apiKey }, process.env.JWT_SECRET);

    // Store the API key in the database
    const { data, error } = await supabase
      .from('api_keys')
      .insert([
        {
          id: uuidv4(),
          user_id: userId,
          name,
          key_hash: keyHash,
          created_at: new Date(),
          scopes: scopes || ['read'], // Default to read-only
        },
      ])
      .select();

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    // Return the API key (this is the only time the full key will be visible)
    res.status(201).json({
      id: data[0].id,
      name: data[0].name,
      key: apiKey, // This is shown only once
      created_at: data[0].created_at,
      scopes: data[0].scopes,
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

    // Delete the API key
    const { error } = await supabase
      .from('api_keys')
      .delete()
      .eq('id', id)
      .eq('user_id', userId); // Ensure the key belongs to the user

    if (error) {
      return res.status(400).json({ error: error.message });
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
