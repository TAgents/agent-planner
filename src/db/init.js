const { adminAuth, auth } = require('../services/supabase-auth');
const { usersDal } = require('./dal.cjs');
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');

/**
 * Get PostgreSQL connection pool
 */
const getDbPool = () => {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is not set');
  return new Pool({ connectionString: databaseUrl });
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

    const migrationTrackingFile = path.resolve(__dirname, 'sql', '00000_migration_tracking.sql');
    const migrationTrackingSql = fs.readFileSync(migrationTrackingFile, 'utf-8');
    await client.query(migrationTrackingSql);

    const appliedResult = await client.query('SELECT version FROM schema_migrations ORDER BY version');
    const appliedMigrations = new Set(appliedResult.rows.map(row => row.version));

    const migrationsDir = path.resolve(__dirname, 'sql');
    const migrationFiles = fs.readdirSync(migrationsDir)
      .filter(file => file.endsWith('.sql') && file !== '00000_migration_tracking.sql' && file !== 'CONSOLIDATED_INIT.sql')
      .sort();

    let appliedCount = 0;
    for (const file of migrationFiles) {
      const version = file.replace('.sql', '');
      if (appliedMigrations.has(version)) continue;

      await logger.api(`Executing migration: ${file}`);
      try {
        const filePath = path.join(migrationsDir, file);
        const sql = fs.readFileSync(filePath, 'utf-8');
        await client.query('BEGIN');
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [version]);
        await client.query('COMMIT');
        appliedCount++;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    }

    await logger.api(`Applied ${appliedCount} new migrations`);
    return true;
  } finally {
    if (client) client.release();
    await pool.end();
  }
};

/**
 * Sync auth users with custom users table
 */
const syncAuthUsersWithCustomTable = async () => {
  try {
    console.log('Checking for users that need to be synced...');
    const { data: authUsers, error } = await adminAuth.admin.listUsers();
    if (error || !authUsers?.users?.length) return true;

    console.log(`Found ${authUsers.users.length} users in Auth system`);

    const existingUsers = await usersDal.list({ limit: 10000 });
    const existingIds = new Set(existingUsers.map(u => u.id));
    const missingUsers = authUsers.users.filter(u => !existingIds.has(u.id));

    if (missingUsers.length === 0) {
      console.log('All auth users have corresponding records');
      return true;
    }

    console.log(`Creating ${missingUsers.length} missing user records`);
    for (const user of missingUsers) {
      try {
        await usersDal.create({
          id: user.id,
          email: user.email,
          name: user.user_metadata?.name || user.email.split('@')[0]
        });
        console.log(`Created record for ${user.email}`);
      } catch (e) {
        console.error(`Error creating record for ${user.email}:`, e.message);
      }
    }
    return true;
  } catch (error) {
    console.error('Error syncing users:', error);
    return false;
  }
};

/**
 * Create admin user
 */
const createAdminUser = async () => {
  try {
    const adminEmail = 'admin@example.com';
    const { data: existingUsers } = await adminAuth.admin.listUsers();
    let authUser = existingUsers?.users?.find(u => u.email === adminEmail);

    if (!authUser) {
      const { data, error } = await adminAuth.admin.createUser({
        email: adminEmail, password: 'password123', email_confirm: true,
        user_metadata: { name: 'Admin User' }
      });

      if (error) {
        if (error.code === 'email_exists' || error.status === 422) {
          try {
            const { data: signInData } = await auth.signInWithPassword({ email: adminEmail, password: 'password123' });
            authUser = signInData?.user;
          } catch (e) {
            console.error('Cannot retrieve existing user ID');
            return null;
          }
        } else {
          console.error('Error creating admin:', error);
          return null;
        }
      } else {
        authUser = data.user;
      }
    }

    if (authUser) {
      try {
        await usersDal.create({ id: authUser.id, email: adminEmail, name: 'Admin User' });
        console.log('Admin user record created');
      } catch (e) {
        // May already exist
      }
      return authUser;
    }
    return null;
  } catch (error) {
    console.error('Error creating admin user:', error);
    return null;
  }
};

/**
 * Initialize the database
 */
const initializeDatabase = async () => {
  try {
    console.log('Initializing database...');
    await executeMigrations();

    const existingUsers = await usersDal.list({ limit: 1 });

    if (!existingUsers || existingUsers.length === 0) {
      console.log('No users found, creating admin user...');
      const adminUser = await createAdminUser();
      if (adminUser) {
        console.log(`Admin user created with ID: ${adminUser.id}`);
        console.log('Admin credentials: admin@example.com / password123');
      }
    } else {
      console.log(`Found existing users: ${existingUsers.map(u => u.email).join(', ')}`);
      await syncAuthUsersWithCustomTable();
    }

    console.log('Database initialization completed!');
  } catch (error) {
    console.error('Database initialization failed:', error);
    throw error;
  }
};

module.exports = { initializeDatabase, syncAuthUsersWithCustomTable, createAdminUser, executeMigrations };
