/**
 * Simple migration runner — applies SQL files from migrations/ directory.
 * Tracks applied migrations in a `schema_migrations` table.
 * Runs each migration in a transaction.
 */
import pg from 'pg';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.join(__dirname, '..', 'migrations');

async function run() {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  // Create tracking table
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  // Get already-applied migrations
  const { rows: applied } = await client.query('SELECT name FROM schema_migrations ORDER BY name');
  const appliedSet = new Set(applied.map(r => r.name));

  // Get all .sql files (skip meta directory)
  const files = fs.readdirSync(MIGRATIONS_DIR)
    .filter(f => f.endsWith('.sql'))
    .sort();

  let count = 0;
  for (const file of files) {
    if (appliedSet.has(file)) continue;

    const raw = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf-8');
    // Split on Drizzle's statement breakpoint marker, then filter empty chunks
    const statements = raw.split(/-->\s*statement-breakpoint\s*/)
      .map(s => s.trim())
      .filter(Boolean);
    console.log(`Applying migration: ${file} (${statements.length} statement(s))`);

    try {
      await client.query('BEGIN');
      for (const stmt of statements) {
        await client.query(stmt);
      }
      await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
      await client.query('COMMIT');
      count++;
    } catch (err) {
      await client.query('ROLLBACK');
      console.error(`Migration ${file} failed:`, err.message);
      process.exit(1);
    }
  }

  console.log(`Migrations complete. Applied ${count} new migration(s).`);
  await client.end();
}

run().catch(err => {
  console.error('Migration runner error:', err);
  process.exit(1);
});
