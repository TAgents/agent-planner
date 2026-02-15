/**
 * Memory Sync Workflow (v0 registerWorkflow API)
 * 
 * Syncs OpenClaw workspace memory files into the knowledge system.
 * Schedule: Every 15 minutes
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const logger = require('../utils/logger');

const WORKSPACE_MEMORY_DIR = process.env.OPENCLAW_WORKSPACE_MEMORY || '/workspace/memory';

function computeHash(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

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
        files.push(...scanMemoryFiles(fullPath));
      }
    }
  } catch (err) {
    // graceful skip
  }
  return files;
}

function getMemorySyncWorkflows() {
  return [
    {
      id: 'openclaw-memory-sync',
      description: 'Syncs OpenClaw workspace memory files into the knowledge system',
      on: { crons: ['*/15 * * * *'] },
      steps: [
        {
          name: 'scan-and-sync',
          run: async (ctx) => {
            const files = scanMemoryFiles(WORKSPACE_MEMORY_DIR);
            await logger.api(`Memory sync: Found ${files.length} files in ${WORKSPACE_MEMORY_DIR}`);

            if (files.length === 0) {
              return { synced: 0, skipped: 0, message: 'No memory files found' };
            }

            let synced = 0;
            let skipped = 0;

            let knowledgeDal, embeddings;
            try {
              knowledgeDal = require('../db/dal.cjs').knowledgeDal;
              embeddings = require('../services/embeddings');
            } catch (err) {
              await logger.error(`Memory sync: Failed to load dependencies: ${err.message}`);
              return { synced: 0, skipped: 0, error: err.message };
            }

            for (const file of files) {
              try {
                const hash = file.hash;
                const existing = await knowledgeDal.findBySource('openclaw', file.path);

                if (existing && existing.metadata?.contentHash === hash) {
                  skipped++;
                  continue;
                }

                const embedding = await embeddings.generateEmbedding(
                  `Memory file: ${file.name}\n\n${file.content}`
                );

                const entry = {
                  title: `Memory: ${file.name}`,
                  content: file.content,
                  entryType: 'context',
                  source: 'openclaw',
                  sourceRef: file.path,
                  embedding,
                  metadata: {
                    contentHash: hash,
                    syncedAt: new Date().toISOString(),
                    fileName: file.name,
                  },
                };

                if (existing) {
                  await knowledgeDal.update(existing.id, entry);
                } else {
                  await knowledgeDal.create(entry);
                }

                synced++;
              } catch (err) {
                await logger.error(`Memory sync: Failed to sync ${file.name}: ${err.message}`);
              }
            }

            await logger.api(`Memory sync complete: ${synced} synced, ${skipped} unchanged`);
            return { synced, skipped };
          },
        },
      ],
    },
  ];
}

module.exports = { getMemorySyncWorkflows, scanMemoryFiles, computeHash };
