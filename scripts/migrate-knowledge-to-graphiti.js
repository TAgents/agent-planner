#!/usr/bin/env node
/**
 * Migrate knowledge_entries from PostgreSQL to Graphiti episodes.
 *
 * Reads directly from the database (the table still needs to exist) and
 * writes through the REST API's POST /knowledge/episodes endpoint so that
 * auth, org-scoping, and Graphiti entity extraction all happen normally.
 *
 * Usage:
 *   DATABASE_URL=postgres://... API_URL=http://localhost:3000 API_TOKEN=<token> \
 *     node scripts/migrate-knowledge-to-graphiti.js [--dry-run] [--batch-size=10] [--delay=2000]
 *
 * Options:
 *   --dry-run       Print what would be migrated without writing anything
 *   --batch-size=N  Process N entries at a time (default: 10)
 *   --delay=MS      Wait MS milliseconds between batches for entity extraction (default: 2000)
 *   --scope=SCOPE   Only migrate entries with this scope (global, plan, node)
 *   --since=DATE    Only migrate entries created after this ISO date
 */

const { Pool } = require('pg');

const DATABASE_URL = process.env.DATABASE_URL;
const API_URL = process.env.API_URL || 'http://localhost:3000';
const API_TOKEN = process.env.API_TOKEN;

if (!DATABASE_URL) {
  console.error('DATABASE_URL env var is required.');
  process.exit(1);
}
if (!API_TOKEN) {
  console.error('API_TOKEN env var is required.');
  process.exit(1);
}

// Parse CLI flags
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const batchSize = parseInt((args.find(a => a.startsWith('--batch-size=')) || '').split('=')[1]) || 10;
const delay = parseInt((args.find(a => a.startsWith('--delay=')) || '').split('=')[1]) || 2000;
const scopeFilter = (args.find(a => a.startsWith('--scope=')) || '').split('=')[1] || null;
const sinceFilter = (args.find(a => a.startsWith('--since=')) || '').split('=')[1] || null;

const authHeader = API_TOKEN.split('.').length === 3
  ? `Bearer ${API_TOKEN}`
  : `ApiKey ${API_TOKEN}`;

async function apiPost(path, body) {
  const res = await fetch(`${API_URL}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': authHeader,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API ${res.status}: ${text}`);
  }
  return res.json();
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  const pool = new Pool({ connectionString: DATABASE_URL });

  // Check that the table still exists
  const tableCheck = await pool.query(`
    SELECT EXISTS (
      SELECT FROM information_schema.tables WHERE table_name = 'knowledge_entries'
    ) AS exists
  `);
  if (!tableCheck.rows[0].exists) {
    console.error('knowledge_entries table does not exist. Nothing to migrate.');
    await pool.end();
    process.exit(1);
  }

  // Build query with optional filters
  let where = [];
  let params = [];
  if (scopeFilter) {
    params.push(scopeFilter);
    where.push(`scope = $${params.length}`);
  }
  if (sinceFilter) {
    params.push(sinceFilter);
    where.push(`created_at >= $${params.length}`);
  }
  const whereClause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';

  // Count entries
  const countResult = await pool.query(`SELECT count(*) FROM knowledge_entries ${whereClause}`, params);
  const total = parseInt(countResult.rows[0].count);
  console.log(`Found ${total} knowledge entries to migrate${dryRun ? ' (dry run)' : ''}`);

  if (total === 0) {
    await pool.end();
    return;
  }

  // Fetch all entries ordered by creation date
  const entries = await pool.query(`
    SELECT
      ke.id, ke.owner_id, ke.scope, ke.scope_id, ke.entry_type,
      ke.title, ke.content, ke.tags, ke.source, ke.created_by,
      ke.created_at,
      u.email AS owner_email,
      p.title AS plan_title
    FROM knowledge_entries ke
    LEFT JOIN users u ON u.id = ke.owner_id
    LEFT JOIN plans p ON p.id = ke.scope_id AND ke.scope = 'plan'
    ${whereClause}
    ORDER BY ke.created_at ASC
  `, params);

  let migrated = 0;
  let failed = 0;
  const failures = [];

  for (let i = 0; i < entries.rows.length; i += batchSize) {
    const batch = entries.rows.slice(i, i + batchSize);

    for (const entry of batch) {
      // Build rich episode content that preserves all metadata
      const parts = [];
      if (entry.title) parts.push(entry.title);
      parts.push(entry.content);
      if (entry.tags && entry.tags.length > 0) {
        parts.push(`Tags: ${entry.tags.join(', ')}`);
      }
      if (entry.scope === 'plan' && entry.plan_title) {
        parts.push(`Plan: ${entry.plan_title}`);
      }
      if (entry.scope === 'node' && entry.scope_id) {
        parts.push(`Node: ${entry.scope_id}`);
      }

      const episodeContent = parts.join('\n\n');
      const episodeName = entry.title || episodeContent.substring(0, 100);

      if (dryRun) {
        console.log(`[DRY RUN] Would migrate entry ${entry.id}:`);
        console.log(`  Type: ${entry.entry_type}, Scope: ${entry.scope}`);
        console.log(`  Title: ${entry.title || '(none)'}`);
        console.log(`  Content: ${entry.content.substring(0, 80)}...`);
        console.log(`  Created: ${entry.created_at}`);
        console.log();
        migrated++;
        continue;
      }

      try {
        await apiPost('/knowledge/episodes', {
          content: episodeContent,
          name: episodeName,
          metadata: {
            migrated_from: 'knowledge_entries',
            original_id: entry.id,
            entry_type: entry.entry_type,
            scope: entry.scope,
            scope_id: entry.scope_id,
            tags: entry.tags,
            original_source: entry.source,
            original_created_by: entry.created_by,
            original_created_at: entry.created_at,
          },
        });
        migrated++;
        process.stdout.write(`\rMigrated ${migrated}/${total} (${failed} failed)`);
      } catch (err) {
        failed++;
        failures.push({ id: entry.id, title: entry.title, error: err.message });
        process.stdout.write(`\rMigrated ${migrated}/${total} (${failed} failed)`);
      }
    }

    // Delay between batches to let Graphiti process entity extraction
    if (!dryRun && i + batchSize < entries.rows.length) {
      await sleep(delay);
    }
  }

  console.log(); // newline after progress
  console.log(`\nMigration complete: ${migrated} migrated, ${failed} failed out of ${total}`);

  if (failures.length > 0) {
    console.log('\nFailed entries:');
    for (const f of failures) {
      console.log(`  ${f.id} "${f.title}": ${f.error}`);
    }
  }

  await pool.end();
}

main().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
