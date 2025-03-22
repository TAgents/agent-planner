const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const { supabase, supabaseAdmin } = require('../config/supabase');
require('dotenv').config();

/**
 * Register a new user
 */
const register = async (req, res, next) => {
  try {
    const { email, password, name } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    // Create user in Supabase Auth
    const { data: authData, error: authError } = await supabase.auth.signUp({
      email,
      password,
    });

    if (authError) {
      return res.status(400).json({ error: authError.message });
    }

    // Insert user record in our custom users table
    const userId = authData.user.id;
    const { error: dbError } = await supabase
      .from('users')
      .insert([
        {
          id: userId,
          email,
          name: name || email.split('@')[0], // Use part of email as name if not provided
          created_at: new Date(),
          updated_at: new Date(),
        },
      ]);

    if (dbError) {
      // If we can't create the user record, we should clean up the auth user
      await supabaseAdmin.auth.admin.deleteUser(userId);
      return res.status(400).json({ error: dbError.message });
    }

    // Generate JWT token
    const token = jwt.sign(
      { userId, email },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRY || '8h' }
    );

    // Return user info and token
    res.status(201).json({
      user: {
        id: userId,
        email,
        name: name || email.split('@')[0],
      },
      token,
    });
  } catch (error) {
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

    // Sign in with Supabase Auth
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      return res.status(401).json({ error: error.message });
    }

    // Get user from our custom users table
    const { data: userData, error: userError } = await supabase
      .from('users')
      .select('id, email, name')
      .eq('id', data.user.id)
      .single();

    if (userError) {
      return res.status(500).json({ error: userError.message });
    }

    // Generate JWT token
    const token = jwt.sign(
      { userId: userData.id, email: userData.email },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRY || '8h' }
    );

    // Return user info and token
    res.json({
      user: userData,
      token,
    });
  } catch (error) {
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
