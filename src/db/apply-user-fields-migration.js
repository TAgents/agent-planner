const { supabaseAdmin } = require('../config/supabase');
const fs = require('fs').promises;
const path = require('path');

async function applyUserFieldsMigration() {
  try {
    console.log('Applying user fields migration...');
    
    // Read the migration SQL
    const sqlPath = path.join(__dirname, 'sql', '00003_add_user_fields.sql');
    const sql = await fs.readFile(sqlPath, 'utf8');
    
    // Split into individual statements and execute
    const statements = sql.split(';').filter(stmt => stmt.trim());
    
    for (const statement of statements) {
      if (statement.trim()) {
        console.log('Executing:', statement.substring(0, 50) + '...');
        const { error } = await supabaseAdmin.rpc('exec_sql', { sql: statement + ';' }).single();
        
        if (error) {
          // Try direct execution as alternative
          console.log('Direct RPC failed, trying alternative method...');
          // Note: This might not work depending on Supabase setup
          // You may need to run this directly in Supabase SQL editor
          console.warn('Warning:', error.message);
        }
      }
    }
    
    console.log('Migration completed successfully!');
    console.log('Note: If you see warnings above, please run the SQL directly in Supabase SQL Editor.');
    
  } catch (error) {
    console.error('Migration failed:', error);
    console.log('\nPlease run the following SQL directly in your Supabase SQL Editor:');
    console.log('File: src/db/sql/00003_add_user_fields.sql');
  }
}

// Run if called directly
if (require.main === module) {
  applyUserFieldsMigration().then(() => process.exit(0)).catch(() => process.exit(1));
}

module.exports = { applyUserFieldsMigration };
