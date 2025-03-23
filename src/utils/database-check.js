const { supabase } = require('../config/supabase');
const logger = require('./logger');

/**
 * Simple health check for the Supabase connection
 */
const checkDatabaseConnection = async () => {
  try {
    await logger.api('Checking Supabase database connection...');
    
    // Try to query the users table
    const { data, error, status } = await supabase
      .from('users')
      .select('count', { count: 'exact', head: true });
    
    if (error) {
      await logger.error('Failed to connect to Supabase database', error);
      return {
        connected: false,
        error: error.message,
        details: error
      };
    }
    
    // Try to authenticate with Supabase Auth
    const { error: authError } = await supabase.auth.getSession();
    if (authError) {
      await logger.error('Failed to connect to Supabase Auth', authError);
      return {
        connected: false,
        message: 'Database connected but Auth service failed',
        error: authError.message,
        details: authError
      };
    }
    
    await logger.api('Successfully connected to Supabase database and Auth service');
    return {
      connected: true,
      message: 'Successfully connected to Supabase database and Auth service'
    };
  } catch (error) {
    await logger.error('Unexpected error checking database connection', error);
    return {
      connected: false,
      error: error.message,
      details: error
    };
  }
};

/**
 * Get basic database info
 */
const getDatabaseInfo = async () => {
  try {
    await logger.api('Fetching database information...');
    
    // Check for tables
    const tables = ['users', 'plans', 'plan_nodes', 'plan_collaborators', 'plan_comments'];
    const tableStatus = {};
    
    for (const table of tables) {
      try {
        const { data, error, count } = await supabase
          .from(table)
          .select('count', { count: 'exact', head: true });
        
        if (error) {
          tableStatus[table] = { exists: false, error: error.message };
        } else {
          tableStatus[table] = { exists: true, count };
        }
      } catch (e) {
        tableStatus[table] = { exists: false, error: e.message };
      }
    }
    
    await logger.api(`Database table status: ${JSON.stringify(tableStatus)}`);
    return tableStatus;
  } catch (error) {
    await logger.error('Failed to get database info', error);
    return { error: error.message };
  }
};

/**
 * Check for existing users in the database
 */
const checkExistingUsers = async () => {
  try {
    await logger.api('Checking for existing users...');
    
    const { data, error, count } = await supabase
      .from('users')
      .select('id, email, name, created_at')
      .limit(10);
    
    if (error) {
      await logger.error('Failed to check for existing users', error);
      return { error: error.message };
    }
    
    if (data && data.length > 0) {
      await logger.api(`Found ${data.length} existing users. First user: ${data[0].email}`);
      return {
        hasUsers: true,
        count: data.length,
        sampleUsers: data.map(user => ({ 
          id: user.id, 
          email: user.email,
          name: user.name,
          created_at: user.created_at
        }))
      };
    } else {
      await logger.api('No existing users found in the database');
      return { hasUsers: false };
    }
  } catch (error) {
    await logger.error('Unexpected error checking for users', error);
    return { error: error.message };
  }
};

module.exports = {
  checkDatabaseConnection,
  getDatabaseInfo,
  checkExistingUsers
};
