const { supabaseAdmin } = require('../config/supabase');
const fs = require('fs');
const path = require('path');

/**
 * Apply RLS policy fixes to the database
 */
const applyRLSFixes = async () => {
  try {
    console.log('Applying RLS policy fixes...');
    
    // Read the migration file
    const migrationSql = fs.readFileSync(
      path.join(__dirname, './migrations/00002_rls_policy_fixes.sql'),
      'utf8'
    );

    // Apply the migration using the admin client
    const { error } = await supabaseAdmin.rpc('apply_rls_fixes', {
      sql: migrationSql
    });

    if (error) {
      console.error('Error applying RLS fixes:', error);
      throw error;
    }

    console.log('RLS policy fixes applied successfully');
  } catch (error) {
    console.error('Failed to apply RLS fixes:', error);
    throw error;
  }
};

// If this file is run directly, execute the function
if (require.main === module) {
  applyRLSFixes()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}

module.exports = { applyRLSFixes };
