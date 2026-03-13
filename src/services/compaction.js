/**
 * Research Output Compaction Service
 *
 * When a research task (task_mode=research) is completed, compacts its logs
 * into a concise summary stored in node metadata.compacted_context.
 * Downstream tasks receive this compact version instead of raw logs,
 * reducing context size by 5-10x.
 *
 * Strategy: rule-based extraction (LLM summarization can be added later).
 *   1. Extract logs of type 'decision' and 'reasoning' (highest signal)
 *   2. Fall back to most recent 'progress' and 'comment' logs
 *   3. Compose a structured summary with key findings
 */

const dal = require('../db/dal.cjs');

/**
 * Compact research output for a node.
 * Called when a research/plan task is marked completed.
 *
 * @param {string} nodeId - The completed research/plan node
 * @returns {object|null} The compacted context, or null if nothing to compact
 */
async function compactResearchOutput(nodeId) {
  const node = await dal.nodesDal.findById(nodeId);
  if (!node) return null;

  // Only compact research and plan task modes
  if (!['research', 'plan'].includes(node.taskMode)) return null;

  // Get all logs for this node
  const allLogs = await dal.logsDal.listByNode(nodeId, { limit: 100 });
  if (allLogs.length === 0) return null;

  // Priority extraction: decisions > reasoning > progress > comments
  const decisions = allLogs.filter(l => l.logType === 'decision');
  const reasoning = allLogs.filter(l => l.logType === 'reasoning');
  const progress = allLogs.filter(l => l.logType === 'progress');
  const challenges = allLogs.filter(l => l.logType === 'challenge');

  // Build compact summary
  const sections = [];

  if (decisions.length > 0) {
    sections.push({
      type: 'decisions',
      items: decisions.map(l => l.content),
    });
  }

  if (reasoning.length > 0) {
    sections.push({
      type: 'key_findings',
      items: reasoning.map(l => l.content),
    });
  }

  if (challenges.length > 0) {
    sections.push({
      type: 'challenges',
      items: challenges.map(l => l.content),
    });
  }

  // If no high-signal logs, fall back to recent progress
  if (sections.length === 0 && progress.length > 0) {
    // Filter out auto-generated "Created task" and "Updated status" logs
    const meaningful = progress.filter(l =>
      !l.content.startsWith('Created task') &&
      !l.content.startsWith('Updated status')
    );
    if (meaningful.length > 0) {
      sections.push({
        type: 'progress_notes',
        items: meaningful.slice(0, 5).map(l => l.content),
      });
    }
  }

  if (sections.length === 0) return null;

  const compacted = {
    source_node_id: nodeId,
    source_title: node.title,
    source_task_mode: node.taskMode,
    compacted_at: new Date().toISOString(),
    log_count: allLogs.length,
    sections,
  };

  // Store in node metadata
  const currentMetadata = node.metadata || {};
  await dal.nodesDal.update(nodeId, {
    metadata: {
      ...currentMetadata,
      compacted_context: compacted,
    },
  });

  return compacted;
}

/**
 * Get compacted context for a node, if available.
 * Returns the stored compacted_context from metadata, or null.
 */
async function getCompactedContext(nodeId) {
  const node = await dal.nodesDal.findById(nodeId);
  if (!node) return null;
  return node.metadata?.compacted_context || null;
}

/**
 * Initialize compaction listener on the message bus.
 * Triggers compaction when research/plan tasks are completed.
 */
function initCompactionListener(messageBus) {
  if (!messageBus) return;

  messageBus.subscribe('node.status.changed', async (event) => {
    try {
      const { nodeId, newStatus, taskMode } = event;
      if (newStatus === 'completed' && ['research', 'plan'].includes(taskMode)) {
        await compactResearchOutput(nodeId);
      }
    } catch (err) {
      console.error('Compaction listener error:', err.message);
    }
  });
}

module.exports = { compactResearchOutput, getCompactedContext, initCompactionListener };
