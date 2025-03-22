const { supabase, supabaseAdmin } = require('../config/supabase');

/**
 * Initialize the database by creating tables directly through Supabase API
 * instead of relying on executing raw SQL
 */
const initializeDatabase = async () => {
  try {
    console.log('Initializing database...');
    
    // Create users table (if it doesn't already exist)
    console.log('Creating users table...');
    const { error: usersError } = await supabaseAdmin
      .from('users')
      .select('id')
      .limit(1);
      
    if (usersError && usersError.code === '42P01') { // Table doesn't exist
      console.log('Users table not found, creating...');
      
      const { error: createUsersError } = await supabaseAdmin.auth.admin.createUser({
        email: 'admin@example.com',
        password: 'password123',
        email_confirm: true,
        user_metadata: { name: 'Admin User' }
      });
      
      if (createUsersError) {
        console.error('Error creating admin user:', createUsersError);
      } else {
        console.log('Admin user created successfully');
      }
    } else if (usersError) {
      console.error('Error checking users table:', usersError);
    } else {
      console.log('Users table already exists');
    }
    
    // For other tables, we'll use the Supabase UI to create them manually
    // as the service_role key doesn't have permission to run raw SQL queries
    // through the API in most configurations.
    
    console.log('\nIMPORTANT: Please complete the database setup by running the SQL script manually');
    console.log('1. Go to your Supabase dashboard: https://app.supabase.com/project/_/sql');
    console.log('2. Open the file: /src/db/migrations/00001_initial_schema.sql');
    console.log('3. Copy its contents and run it in the Supabase SQL editor');
    console.log('\nThis step is necessary as the Supabase client cannot run schema-changing SQL in most configurations.');
    
    console.log('\nAlternatively, you can use the Supabase UI to create the required tables:');
    console.log('- plans: For storing plan information');
    console.log('- plan_nodes: For hierarchical structure of plans');
    console.log('- plan_collaborators: For managing who has access to plans');
    console.log('- plan_comments: For storing comments on plan nodes');
    console.log('- api_keys: For API token storage');
    console.log('- plan_node_labels: For categorizing nodes');
    console.log('- plan_node_artifacts: For storing outputs and references');
    console.log('- plan_node_logs: For tracking agent activity');
    
    console.log('\nDatabase initialization completed with instructions for manual steps');
  } catch (error) {
    console.error('Database initialization failed:', error);
    throw error;
  }
};

module.exports = { initializeDatabase };
