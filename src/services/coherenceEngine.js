/**
 * Belief-Intention Coherence Engine (BDI Phase 2)
 *
 * Detects when new knowledge (episodes) contradicts or invalidates
 * assumptions held by active task intentions across the organization.
 *
 * Two execution paths:
 *   1. Synchronous (2s timeout) — called inline during POST /knowledge/episodes
 *      when plan_id is provided. Scoped to that single plan.
 *   2. Asynchronous — triggered via messageBus 'episode.created' event.
 *      Runs org-wide with no timeout.
 */
const dal = require('../db/dal.cjs');
const graphitiBridge = require('./graphitiBridge');

// ─── Stop words for keyword extraction ───────────────────────────
const STOP_WORDS = new Set([
  'the', 'and', 'for', 'are', 'but', 'not', 'you', 'all', 'can',
  'had', 'her', 'was', 'one', 'our', 'out', 'has', 'have', 'been',
  'will', 'with', 'this', 'that', 'from', 'they', 'were', 'said',
  'each', 'which', 'their', 'time', 'there', 'would', 'make',
  'like', 'just', 'over', 'such', 'take', 'also', 'into', 'than',
  'them', 'very', 'when', 'what', 'your', 'about', 'should', 'could',
  'using', 'used', 'need', 'must', 'does',
]);

/**
 * Extract search keywords from episode content.
 * Takes distinctive words (>4 chars, not stop words), returns top 5.
 */
function extractKeywords(content) {
  const words = content
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 4 && !STOP_WORDS.has(w));
  // Deduplicate and take longest/most distinctive
  const unique = [...new Set(words)];
  unique.sort((a, b) => b.length - a.length);
  return unique.slice(0, 5);
}

/**
 * Find tasks semantically related to episode content.
 *
 * @param {string} episodeContent - The episode text
 * @param {string|null} planId - Scope to a single plan (null = org-wide)
 * @param {string|null} organizationId - For org-wide search
 * @param {number} maxTasks - Maximum tasks to return
 * @returns {Promise<Array>} matched task nodes
 */
async function findAffectedTasks(episodeContent, planId, organizationId, maxTasks = 20) {
  const keywords = extractKeywords(episodeContent);
  if (keywords.length === 0) return [];

  const seen = new Set();
  const results = [];

  async function searchPlan(pid) {
    for (const keyword of keywords) {
      if (results.length >= maxTasks) break;
      try {
        const nodes = await dal.nodesDal.search(pid, {
          query: keyword,
          status: 'not_started,in_progress,blocked',
        });
        for (const node of nodes) {
          if (seen.has(node.id)) continue;
          if (node.nodeType === 'root') continue;
          seen.add(node.id);
          results.push(node);
          if (results.length >= maxTasks) break;
        }
      } catch {
        // Skip plan on error
      }
    }
  }

  // Search the specified plan first
  if (planId) {
    await searchPlan(planId);
  }

  // Org-wide search if no planId or still under limit
  if (!planId && organizationId && results.length < maxTasks) {
    try {
      const orgPlans = await dal.plansDal.listByOrganization(organizationId, {
        status: ['active'],
      });
      for (const plan of orgPlans) {
        if (results.length >= maxTasks) break;
        await searchPlan(plan.id);
      }
    } catch {
      // Org query failed — continue with what we have
    }
  }

  return results;
}

/**
 * Check a single task for coherence issues against the knowledge graph.
 *
 * @param {object} node - The task node
 * @param {string} groupId - Graphiti org namespace
 * @returns {Promise<object|null>} CoherenceIssue or null
 */
async function checkTaskCoherence(node, groupId) {
  if (!graphitiBridge.isAvailable()) return null;

  const query = [node.title, node.description].filter(Boolean).join(' ');
  if (!query.trim()) return null;

  try {
    const result = await graphitiBridge.detectContradictions({
      query,
      group_id: groupId,
      max_results: 5,
    });

    if (result && result.contradictions_found) {
      return {
        node_id: node.id,
        title: node.title,
        status: node.status,
        node_type: node.nodeType,
        conflict_type: 'contradiction_detected',
        superseded_facts: result.superseded || [],
      };
    }
  } catch {
    // Graphiti call failed — skip this task
  }

  return null;
}

/**
 * Apply a coherence result: update node status and create episode link.
 *
 * @param {string} nodeId
 * @param {string} episodeId - Graphiti episode UUID
 * @param {object} issue - CoherenceIssue
 */
async function applyCoherenceResult(nodeId, episodeId, issue) {
  // Update coherence_status on the node
  try {
    await dal.nodesDal.update(nodeId, {
      coherenceStatus: issue.conflict_type,
    });
  } catch (err) {
    console.error('Failed to update coherence status:', err.message);
  }

  // Auto-link episode to node
  if (episodeId) {
    const linkType = issue.conflict_type === 'contradiction_detected' ? 'contradicts' : 'informs';
    try {
      await dal.episodeLinksDal.link(episodeId, nodeId, linkType);
    } catch {
      // Unique constraint — link already exists, ignore
    }
  }
}

/**
 * Run coherence check for an episode against tasks.
 *
 * @param {object} params
 * @param {string} params.episodeContent - The episode text
 * @param {string|null} params.episodeId - Graphiti episode UUID
 * @param {string} params.groupId - Org group_id for Graphiti namespace
 * @param {string|null} params.planId - Scope to a single plan
 * @param {string|null} params.organizationId - For org-wide search
 * @param {object} [params.options]
 * @param {number} [params.options.maxTasks=20]
 * @param {number} [params.options.timeoutMs=0] - 0 = no timeout
 * @returns {Promise<{issues: Array, checked_count: number, timed_out: boolean}>}
 */
async function checkCoherence({ episodeContent, episodeId, groupId, planId, organizationId, options = {} }) {
  const { maxTasks = 20, timeoutMs = 0 } = options;

  if (!graphitiBridge.isAvailable()) {
    return { issues: [], checked_count: 0, timed_out: false };
  }

  async function run() {
    const tasks = await findAffectedTasks(episodeContent, planId, organizationId, maxTasks);
    const issues = [];

    for (const task of tasks) {
      const issue = await checkTaskCoherence(task, groupId);
      if (issue) {
        await applyCoherenceResult(task.id, episodeId, issue);
        issues.push(issue);
      }
    }

    return { issues, checked_count: tasks.length, timed_out: false };
  }

  // With timeout: race against a timer
  if (timeoutMs > 0) {
    return Promise.race([
      run(),
      new Promise(resolve =>
        setTimeout(() => resolve({ issues: [], checked_count: 0, timed_out: true }), timeoutMs)
      ),
    ]);
  }

  return run();
}

/**
 * Initialize the coherence engine as a messageBus listener.
 * Subscribes to 'episode.created' for async org-wide coherence checks.
 */
function initCoherenceEngine(messageBus) {
  if (!messageBus) return;

  messageBus.subscribe('episode.created', async (event) => {
    try {
      const { episodeId, content, groupId, organizationId } = event;
      if (!content) return;

      await checkCoherence({
        episodeContent: content,
        episodeId,
        groupId,
        planId: null, // Org-wide — don't limit to one plan
        organizationId,
        options: { maxTasks: 50, timeoutMs: 0 },
      });
    } catch (err) {
      console.error('Coherence engine async check error:', err.message);
    }
  });
}

module.exports = { checkCoherence, findAffectedTasks, initCoherenceEngine };
