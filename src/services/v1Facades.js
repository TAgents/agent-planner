/**
 * v1 facade services — server-side compositions backing the intent-shaped
 * v1 endpoints. Ports of the MCP tool fan-outs (agent-planner-mcp
 * tools/bdi/*.js) so a single HTTP call answers a whole question:
 *
 *   - planAnalysis    → GET  /v1/plans/:id/analysis   (mirrors `plan_analysis`)
 *   - knowledgeSearch → POST /v1/knowledge/search     (mirrors `recall_knowledge`)
 *   - updateTask      → POST /v1/tasks/:nodeId/update (mirrors `update_task`)
 *   - sharePlan       → POST /v1/plans/:id/share      (mirrors `share_plan`)
 *
 * Write facades apply steps independently and report per-step results in
 * `applied`/`failures` instead of failing the whole call — same contract
 * as the MCP tools they replace. Goal state lives in
 * domains/goal/services/goalState.service.js.
 */

const dal = require('../db/dal.cjs');
const reasoning = require('./reasoning');
const graphitiBridge = require('./graphitiBridge');
const { checkPlanAccess } = require('../middleware/planAccess.middleware');
const nodeService = require('../domains/node/services/node.service');
const planService = require('../domains/plan/services/plan.service');

const asOf = () => new Date().toISOString();

class FacadeError extends Error {
  constructor(message, statusCode = 500, code = undefined) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}

// ── Plan analysis ────────────────────────────────────────────────

async function coherenceIssues(planId) {
  const flaggedNodes = await dal.nodesDal.listByPlan(planId, {
    coherenceStatus: 'stale_beliefs,contradiction_detected',
  });
  const issues = await Promise.all(
    flaggedNodes.map(async (node) => {
      const links = await dal.episodeLinksDal.listByNode(node.id);
      return {
        node_id: node.id,
        title: node.title,
        status: node.status,
        node_type: node.nodeType,
        coherence_status: node.coherenceStatus,
        triggering_episodes: links.map(l => ({
          episode_id: l.episodeId,
          link_type: l.linkType,
          linked_at: l.createdAt,
        })),
      };
    })
  );
  return { issues, count: issues.length };
}

/**
 * Bundled plan reads: critical path + bottlenecks + RPI chains + coherence
 * issues. Partial failures are reported in meta.failures.
 */
async function planAnalysis(planId, user) {
  if (!(await checkPlanAccess(planId, user.id))) {
    throw new FacadeError('You do not have access to this plan', 403, 'forbidden');
  }

  const settled = await Promise.allSettled([
    dal.dependenciesDal.getCriticalPath(planId),
    reasoning.detectBottlenecks(planId, { limit: 5, incomplete_only: true }),
    reasoning.detectRpiChains(planId),
    coherenceIssues(planId),
  ]);

  const failures = [];
  const unwrap = (s, label, def) => {
    if (s.status === 'fulfilled') return s.value;
    failures.push({ source: label, message: s.reason?.message });
    return def;
  };

  return {
    as_of: asOf(),
    plan_id: planId,
    critical_path: unwrap(settled[0], 'critical_path', null),
    bottlenecks: unwrap(settled[1], 'bottlenecks', []),
    rpi_chains: unwrap(settled[2], 'rpi_chains', []),
    coherence: unwrap(settled[3], 'coherence', { issues: [], count: 0 }),
    meta: { partial: failures.length > 0, failures },
  };
}

// ── Knowledge search ─────────────────────────────────────────────

/**
 * Universal knowledge query: facts + entities + episodes + contradictions
 * in one shape. Degrades to empty results when Graphiti is unavailable.
 */
async function knowledgeSearch(user, {
  query,
  since,
  entry_type = 'all',
  result_kind = 'all',
  max_results = 10,
  include_contradictions = false,
} = {}) {
  const out = {
    as_of: asOf(),
    available: graphitiBridge.isAvailable(),
    facts: [],
    entities: [],
    episodes: [],
    contradictions: null,
    meta: { failures: [] },
  };
  if (!out.available) return out;

  const group_id = graphitiBridge.getGroupId(user);
  const wantFacts = result_kind === 'all' || result_kind === 'facts';
  const wantEntities = result_kind === 'all' || result_kind === 'entities';
  const wantEpisodes = result_kind === 'all' || result_kind === 'episodes';

  const calls = [];
  if (wantFacts && query) {
    calls.push({ key: 'facts', p: graphitiBridge.searchMemory({ query, group_id, max_results }) });
  }
  if (wantEntities && query) {
    calls.push({ key: 'entities', p: graphitiBridge.searchEntities({ query, group_id, max_results }) });
  }
  if (wantEpisodes) {
    calls.push({ key: 'episodes', p: graphitiBridge.getEpisodes({ group_id, max_episodes: Math.min(max_results * 2, 50) }) });
  }
  if (include_contradictions && query) {
    calls.push({ key: 'contradictions', p: graphitiBridge.detectContradictions({ query, group_id, max_results }) });
  }

  const settled = await Promise.allSettled(calls.map(c => c.p));
  settled.forEach((s, i) => {
    const key = calls[i].key;
    if (s.status !== 'fulfilled') {
      out.meta.failures.push({ source: `graphiti.${key}`, message: s.reason?.message });
      return;
    }
    const v = s.value;
    if (key === 'facts') out.facts = Array.isArray(v) ? v : (v?.facts || []);
    if (key === 'entities') out.entities = Array.isArray(v) ? v : (v?.entities || []);
    if (key === 'episodes') {
      let eps = v?.episodes?.episodes || v?.episodes || v;
      eps = Array.isArray(eps) ? eps : [];
      if (since) {
        const sinceMs = new Date(since).getTime();
        eps = eps.filter(e => e.created_at && new Date(e.created_at).getTime() >= sinceMs);
      }
      if (entry_type !== 'all') {
        eps = eps.filter(e => (e.entry_type || e.source) === entry_type);
      }
      out.episodes = eps.slice(0, max_results);
    }
    if (key === 'contradictions') out.contradictions = v;
  });

  return out;
}

// ── Atomic task update ───────────────────────────────────────────

/**
 * Atomic task state transition: status + optional log entry + claim
 * release + knowledge episode in one call. Steps apply independently;
 * each failure is recorded rather than aborting the rest (same contract
 * as the MCP `update_task` tool this replaces).
 */
async function updateTask(user, nodeId, {
  status,
  log_message,
  log_type,
  release_claim,
  add_learning,
} = {}) {
  const node = await dal.nodesDal.findById(nodeId);
  if (!node) throw new FacadeError('Task not found', 404, 'not_found');
  const planId = node.planId;

  const access = await dal.plansDal.userHasAccess(planId, user.id);
  if (!access?.hasAccess) throw new FacadeError('Access denied to this plan', 403, 'forbidden');

  const userName = user.name || user.email;
  const result = {
    as_of: asOf(),
    task_id: nodeId,
    plan_id: planId,
    applied: { status_changed: false, log_added: false, claim_released: false, learning_recorded: false },
    failures: [],
  };

  if (status) {
    try {
      const updated = await nodeService.updateNodeStatus(planId, nodeId, user.id, userName, status);
      result.applied.status_changed = true;
      result.status = updated?.status || status;
    } catch (err) {
      result.failures.push({ step: 'update_status', error: err.message });
    }
  }

  if (log_message) {
    const logType = log_type || (status === 'blocked' ? 'challenge' : 'progress');
    try {
      const log = await nodeService.addLogEntry(planId, nodeId, user.id, userName, {
        content: log_message,
        logType,
      });
      result.applied.log_added = true;
      result.log_id = log?.id || log?.log?.id || null;
    } catch (err) {
      result.failures.push({ step: 'add_log', error: err.message });
    }
  }

  // Claim release — auto if status is terminal, explicit override otherwise.
  const shouldRelease = typeof release_claim === 'boolean'
    ? release_claim
    : status === 'completed' || status === 'blocked';
  if (shouldRelease) {
    try {
      const claim = await dal.claimsDal.getActiveClaim(nodeId);
      if (claim) {
        const released = await dal.claimsDal.release(nodeId, claim.agentId);
        result.applied.claim_released = Boolean(released);
      }
    } catch (err) {
      result.failures.push({ step: 'release_claim', error: err.message });
    }
  }

  if (add_learning) {
    if (graphitiBridge.isAvailable()) {
      try {
        await graphitiBridge.addEpisode({
          content: add_learning,
          name: `Task: ${node.title}`,
          source: 'text',
          source_description: 'v1 task update',
          group_id: graphitiBridge.getGroupId(user),
        });
        result.applied.learning_recorded = true;
      } catch (err) {
        result.failures.push({ step: 'add_learning', error: err.message });
      }
    } else {
      result.failures.push({ step: 'add_learning', error: 'Knowledge graph not available' });
    }
  }

  return result;
}

// ── Atomic plan sharing ──────────────────────────────────────────

/**
 * Atomically change plan visibility and add/remove collaborators.
 */
async function sharePlan(user, planId, {
  visibility,
  add_collaborators = [],
  remove_collaborators = [],
} = {}) {
  if (!visibility && add_collaborators.length === 0 && remove_collaborators.length === 0) {
    throw new FacadeError('Nothing to apply: provide visibility, add_collaborators, or remove_collaborators', 400, 'invalid_arg');
  }

  const applied = [];
  const failures = [];

  if (visibility) {
    try {
      await planService.updatePlanVisibility(planId, user.id, visibility);
      applied.push(`visibility:${visibility}`);
    } catch (err) {
      failures.push({ step: 'visibility', error: err.message });
    }
  }

  for (const collab of add_collaborators) {
    try {
      await planService.addCollaborator(planId, user.id, {
        targetUserId: collab.user_id,
        role: collab.role || 'viewer',
      });
      applied.push(`add:${collab.user_id}:${collab.role || 'viewer'}`);
    } catch (err) {
      failures.push({ step: `add:${collab.user_id}`, error: err.message });
    }
  }

  for (const userId of remove_collaborators) {
    try {
      await planService.removeCollaborator(planId, user.id, userId);
      applied.push(`remove:${userId}`);
    } catch (err) {
      failures.push({ step: `remove:${userId}`, error: err.message });
    }
  }

  return {
    as_of: asOf(),
    plan_id: planId,
    applied_changes: applied,
    failures,
  };
}

module.exports = {
  FacadeError,
  planAnalysis,
  knowledgeSearch,
  updateTask,
  sharePlan,
};
