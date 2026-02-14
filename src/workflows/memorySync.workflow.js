/**
 * Memory Sync Workflow
 * 
 * Hatchet cron workflow that syncs OpenClaw workspace memory files
 * into the knowledge system.
 * 
 * Schedule: Every 15 minutes
 * Scans /workspace/memory/, diffs with DB, embeds new/changed files, upserts.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const logger = require('../utils/logger');
const { getHatchetClient } = require('./client');

const WORKSPACE_MEMORY_DIR = process.env.OPENCLAW_WORKSPACE_MEMORY || '/workspace/memory';
const SYNC_CRON = '*/15 * * * *';

/**
 * Compute content hash for change detection
 */
function computeHash(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

/**
 * Scan memory directory for markdown files
 */
function scanMemoryFiles(dir) {
  const files = [];
  try {
    if (!fs.existsSync(dir)) return files;

    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isFile() && (entry.name.endsWith('.md') || entry.name.endsWith('.txt'))) {
        const content = fs.readFileSync(fullPath, 'utf-8');
        const stat = fs.statSync(fullPath);
        files.push({
          path: fullPath,
          name: entry.name,
          content,
          hash: computeHash(content),
          modifiedAt: stat.mtime,
        });
      } else if (entry.isDirectory()) {
        // Recurse one level
        files.push(...scanMemoryFiles(fullPath));
      }
    }
  } catch (err) {
    // Directory doesn't exist or isn't readable — graceful skip
  }
  return files;
}

/**
 * Create the memory sync workflow
 */
function createMemorySyncWorkflow() {
  const hatchet = getHatchetClient();
  if (!hatchet) return null;

  const workflow = hatchet.workflow({
    name: 'openclaw-memory-sync',
    description: 'Syncs OpenClaw workspace memory files into the knowledge system',
    onCrons: [SYNC_CRON],
  });

  workflow.task({
    name: 'scan-memory-files',
    fn: async () => {
      const files = scanMemoryFiles(WORKSPACE_MEMORY_DIR);
      await logger.api(`Memory sync: Found ${files.length} files in ${WORKSPACE_MEMORY_DIR}`);
      return { files: files.map(f => ({ name: f.name, path: f.path, hash: f.hash, contentLength: f.content.length })) };
    },
  });

  workflow.task({
    name: 'diff-and-upsert',
    parents: ['scan-memory-files'],
    fn: async (ctx) => {
      const { files } = ctx.steps['scan-memory-files'].output;
      if (!files || files.length === 0) {
        return { synced: 0, skipped: 0, message: 'No memory files found' };
      }

      let synced = 0;
      let skipped = 0;

      // Lazy-load DAL and embeddings to avoid circular deps
      let knowledgeDal, embeddings;
      try {
        knowledgeDal = require('../db/dal.cjs').knowledgeDal;
        embeddings = require('../services/embeddings');
      } catch (err) {
        await logger.error(`Memory sync: Failed to load dependencies: ${err.message}`);
        return { synced: 0, skipped: 0, error: err.message };
      }

      for (const fileMeta of files) {
        try {
          // Read file content (we only passed metadata in previous step)
          const content = fs.readFileSync(fileMeta.path, 'utf-8');
          const hash = computeHash(content);

          // Check if this file already exists in knowledge with same hash
          const existing = await knowledgeDal.findBySource('openclaw', fileMeta.path);

          if (existing && existing.metadata?.contentHash === hash) {
            skipped++;
            continue;
          }

          // Generate embedding for the content
          const embedding = await embeddings.generateEmbedding(
            `Memory file: ${fileMeta.name}\n\n${content}`
          );

          // Upsert knowledge entry
          const entry = {
            title: `Memory: ${fileMeta.name}`,
            content,
            entryType: 'context',
            source: 'openclaw',
            sourceRef: fileMeta.path,
            embedding,
            metadata: {
              contentHash: hash,
              syncedAt: new Date().toISOString(),
              fileName: fileMeta.name,
            },
          };

          if (existing) {
            await knowledgeDal.update(existing.id, entry);
          } else {
            await knowledgeDal.create(entry);
          }

          synced++;
        } catch (err) {
          await logger.error(`Memory sync: Failed to sync ${fileMeta.name}: ${err.message}`);
        }
      }

      await logger.api(`Memory sync complete: ${synced} synced, ${skipped} unchanged`);
      return { synced, skipped };
    },
  });

  return workflow;
}

module.exports = { createMemorySyncWorkflow, scanMemoryFiles, computeHash };
