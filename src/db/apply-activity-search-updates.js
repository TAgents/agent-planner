const fs = require('fs');
const path = require('path');
const { supabase } = require('../config/supabase');

/**
 * Apply the activity tracking and search updates to the database
 */
const applyActivitySearchUpdates = async () => {
  try {
    console.log('Applying activity and search updates to the database...');
    
    // Read the SQL file
    const sqlFilePath = path.join(__dirname, 'migrations', '00003_activity_and_search_updates.sql');
    const sql = fs.readFileSync(sqlFilePath, 'utf8');
    
    // Execute the SQL
    const { error } = await supabase.rpc('exec_sql', { sql });
    
    if (error) {
      console.error('Error applying updates:', error);
      throw error;
    }
    
    console.log('Activity and search updates applied successfully!');
  } catch (error) {
    console.error('Failed to apply activity and search updates:', error);
    throw error;
  }
};

// If this file is run directly, run the function
if (require.main === module) {
  applyActivitySearchUpdates()
    .then(() => process.exit(0))
    .catch(err => {
      console.error(err);
      process.exit(1);
    });
}

module.exports = { applyActivitySearchUpdates };
