const { supabase, supabaseAdmin } = require('../config/supabase');
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');

/**
 * Get PostgreSQL connection pool
 */
const getDbPool = () => {
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    throw new Error('DATABASE_URL is not set in environment variables');
  }

  return new Pool({
    connectionString: databaseUrl,
  });
};

/**
 * Execute SQL migration files using direct PostgreSQL connection
 */
const executeMigrations = async () => {
  const pool = getDbPool();
  let client;

  try {
    client = await pool.connect();
    await logger.api('Connected to PostgreSQL database');

    // First, ensure the schema_migrations table exists
    await logger.api('Creating migration tracking table...');
    const migrationTrackingFile = path.resolve(__dirname, 'sql', '00000_migration_tracking.sql');
    const migrationTrackingSql = fs.readFileSync(migrationTrackingFile, 'utf-8');
    await client.query(migrationTrackingSql);
    await logger.api('Migration tracking table ready');

    // Get list of applied migrations
    const appliedResult = await client.query('SELECT version FROM schema_migrations ORDER BY version');
    const appliedMigrations = new Set(appliedResult.rows.map(row => row.version));
    await logger.api(`Found ${appliedMigrations.size} previously applied migrations`);

    // Get all migration files
    const migrationsDir = path.resolve(__dirname, 'sql');
    const migrationFiles = fs.readdirSync(migrationsDir)
      .filter(file => file.endsWith('.sql') && file !== '00000_migration_tracking.sql' && file !== 'CONSOLIDATED_INIT.sql')
      .sort(); // Ensure they run in order

    await logger.api(`Found ${migrationFiles.length} migration files`);

    // Execute migrations that haven't been applied
    let appliedCount = 0;
    for (const file of migrationFiles) {
      const version = file.replace('.sql', '');

      if (appliedMigrations.has(version)) {
        await logger.api(`Skipping already applied migration: ${file}`);
        continue;
      }

      await logger.api(`Executing migration: ${file}`);

      try {
        // Read the SQL file
        const filePath = path.join(migrationsDir, file);
        const sql = fs.readFileSync(filePath, 'utf-8');

        // Start transaction
        await client.query('BEGIN');

        // Execute the SQL
        await client.query(sql);

        // Record the migration
        await client.query(
          'INSERT INTO schema_migrations (version) VALUES ($1)',
          [version]
        );

        // Commit transaction
        await client.query('COMMIT');

        await logger.api(`Successfully executed migration: ${file}`);
        appliedCount++;
      } catch (error) {
        // Rollback on error
        await client.query('ROLLBACK');
        await logger.error(`Error executing migration ${file}:`, error);
        console.error(`Error executing migration ${file}:`, error.message);
        throw error; // Stop on first error
      }
    }

    await logger.api(`Applied ${appliedCount} new migrations`);
    return true;
  } catch (error) {
    await logger.error('Error executing migrations:', error);
    console.error('Error executing migrations:', error);
    throw error;
  } finally {
    if (client) {
      client.release();
    }
    await pool.end();
  }
};

/**
 * Ensures that user records exist in our custom users table for all Supabase Auth users
 */
const syncAuthUsersWithCustomTable = async () => {
  try {
    console.log('Checking for users that need to be synced...');

    // Get all users from Supabase Auth
    const { data: authUsers, error: authError } = await supabaseAdmin.auth.admin.listUsers();

    if (authError) {
      console.error('Error fetching auth users:', authError);
      return false;
    }

    if (!authUsers || !authUsers.users || authUsers.users.length === 0) {
      console.log('No auth users found to sync');
      return true;
    }

    console.log(`Found ${authUsers.users.length} users in Auth system`);

    // Get existing users from our custom table
    const { data: customUsers, error: customError } = await supabaseAdmin
      .from('users')
      .select('id');

    if (customError) {
      console.error('Error fetching custom users:', customError);
      return false;
    }

    // Find users that exist in Auth but not in our custom table
    const customUserIds = customUsers.map(u => u.id);
    const missingUsers = authUsers.users.filter(user => !customUserIds.includes(user.id));

    if (missingUsers.length === 0) {
      console.log('All auth users have corresponding records in the users table');
      return true;
    }

    console.log(`Found ${missingUsers.length} auth users that need to be created in custom table`);

    // Create missing users in our custom table
    for (const user of missingUsers) {
      const { error: insertError } = await supabaseAdmin
        .from('users')
        .insert([
          {
            id: user.id,
            email: user.email,
            name: user.user_metadata?.name || user.email.split('@')[0],
            created_at: new Date(),
            updated_at: new Date()
          }
        ]);

      if (insertError) {
        console.error(`Error creating record for user ${user.email}:`, insertError);
      } else {
        console.log(`Created record for user ${user.email} in users table`);
      }
    }

    return true;
  } catch (error) {
    console.error('Error syncing users:', error);
    return false;
  }
};

/**
 * Create admin user in both Auth and users table
 */
const createAdminUser = async () => {
  try {
    const adminEmail = 'admin@example.com';

    // First check if the admin user already exists in Auth
    console.log(`Checking if admin user (${adminEmail}) exists in Auth...`);

    // Try to find the user by email in Auth
    const { data: existingUsers, error: listError } = await supabaseAdmin.auth.admin.listUsers();

    let authUser = null;

    if (listError) {
      console.error('Error listing Auth users:', listError);
    } else if (existingUsers && existingUsers.users) {
      // Find the admin user in the list
      const adminUser = existingUsers.users.find(user => user.email === adminEmail);

      if (adminUser) {
        console.log(`Found existing admin user in Auth with ID: ${adminUser.id}`);
        authUser = adminUser;
      }
    }

    // If admin user doesn't exist in Auth, create them
    if (!authUser) {
      console.log('Creating admin user in Auth system...');

      const { data, error: createUsersError } = await supabaseAdmin.auth.admin.createUser({
        email: adminEmail,
        password: 'password123',
        email_confirm: true,
        user_metadata: { name: 'Admin User' }
      });

      if (createUsersError) {
        console.error('Error creating admin user in Auth:', createUsersError);

        // If the error is because the user already exists but we couldn't find them earlier,
        // try a different approach to get their ID
        if (createUsersError.code === 'email_exists' || createUsersError.status === 422) {
          console.log('Attempting to sign in to get user ID...');

          // Create a temporary auth client to try signing in
          const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
            email: adminEmail,
            password: 'password123' // This may fail if we don't know the password
          });

          if (signInError) {
            console.error('Cannot retrieve existing user ID:', signInError);
            return null;
          }

          authUser = signInData.user;
          console.log(`Retrieved existing admin user ID: ${authUser.id}`);
        } else {
          return null;
        }
      } else {
        console.log('Admin user created successfully in Auth');
        authUser = data.user;
      }
    }

    // Now create the record in the users table
    if (authUser) {
      console.log(`Creating user record in custom table for ID: ${authUser.id}`);

      const { error: insertError } = await supabaseAdmin
        .from('users')
        .insert([
          {
            id: authUser.id,
            email: adminEmail,
            name: 'Admin User',
            created_at: new Date(),
            updated_at: new Date()
          }
        ]);

      if (insertError) {
        console.error('Error creating admin record in users table:', insertError);
        return null;
      }

      console.log('Admin user record created successfully in users table');
      return authUser;
    }

    return null;
  } catch (error) {
    console.error('Error creating admin user:', error);
    return null;
  }
};

/**
 * Initialize the database by running migrations and creating initial users
 */
const initializeDatabase = async () => {
  try {
    console.log('Initializing database...');
    console.log('Using DATABASE_URL:', process.env.DATABASE_URL ? 'Set' : 'NOT SET');

    // Run all SQL migrations
    await executeMigrations();

    // Check if users table exists and has records
    console.log('Checking for existing users...');
    const { data: existingUsers, error: usersError } = await supabaseAdmin
      .from('users')
      .select('id, email')
      .limit(1);

    // If we can't query users or there are no users, create an admin user
    if (usersError || !existingUsers || existingUsers.length === 0) {
      console.log('No users found, creating admin user...');
      const adminUser = await createAdminUser();
      if (adminUser) {
        console.log(`Admin user created with ID: ${adminUser.id}`);
        console.log('Admin credentials: admin@example.com / password123');
      } else {
        console.error('Failed to create admin user');
      }
    } else {
      console.log(`Found existing users in the database: ${existingUsers.map(u => u.email).join(', ')}`);

      // Sync any users that might exist in Auth but not in the users table
      await syncAuthUsersWithCustomTable();
    }

    console.log('Database initialization completed successfully!');
  } catch (error) {
    console.error('Database initialization failed:', error);
    throw error;
  }
};

module.exports = { initializeDatabase, syncAuthUsersWithCustomTable, createAdminUser, executeMigrations };
