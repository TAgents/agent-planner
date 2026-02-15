const { Pool } = require('pg');
const fs = require('fs').promises;
const path = require('path');

async function applyUserFieldsMigration() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  let client;
  
  try {
    console.log('Applying user fields migration...');
    client = await pool.connect();
    
    const sqlPath = path.join(__dirname, 'sql', '00003_add_user_fields.sql');
    const sql = await fs.readFile(sqlPath, 'utf8');
    
    const statements = sql.split(';').filter(stmt => stmt.trim());
    
    for (const statement of statements) {
      if (statement.trim()) {
        console.log('Executing:', statement.substring(0, 50) + '...');
        try {
          await client.query(statement + ';');
        } catch (error) {
          console.warn('Warning:', error.message);
        }
      }
    }
    
    console.log('Migration completed!');
  } catch (error) {
    console.error('Migration failed:', error);
    console.log('Please run the SQL directly in your database.');
  } finally {
    if (client) client.release();
    await pool.end();
  }
}

if (require.main === module) {
  require('dotenv').config();
  applyUserFieldsMigration().then(() => process.exit(0)).catch(() => process.exit(1));
}

module.exports = { applyUserFieldsMigration };
