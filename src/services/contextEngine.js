/**
 * Progressive Context Engine
 *
 * Assembles context for agent tasks via 4 progressive layers:
 *   Layer 1 — Task Focus: the node itself + recent logs
 *   Layer 2 — Local Neighborhood: parent, siblings, direct dependencies
 *   Layer 3 — Knowledge: relevant CURRENT facts from the Graphiti temporal
 *             graph (org-scoped / cross-plan; superseded facts are dropped)
 *   Layer 4 — Extended: plan overview, cross-references, goal alignment
 *
 * Each layer adds detail; callers pick max depth + optional token budget.
 * Token estimation uses a simple heuristic (~4 chars per token).
 */

const dal = require('../db/dal.cjs');
const graphitiBridge = require('./graphitiBridge');

// ---- read-through TTL cache ----
// Agents poll context endpoints; assembly at depth 4 fires 10+ queries.
// Entries expire after CONTEXT_CACHE_TTL_MS (default 30s) and the whole
// plan's entries are dropped on node.status.changed via the message bus.
// Disable with CONTEXT_CACHE_DISABLED=true.
const CACHE_TTL_MS = Number(process.env.CONTEXT_CACHE_TTL_MS) > 0
  ? Number(process.env.CONTEXT_CACHE_TTL_MS)
  : 30 * 1000;
const CACHE_MAX_ENTRIES = 500;
const cacheDisabled = String(process.env.CONTEXT_CACHE_DISABLED).toLowerCase() === 'true';
const contextCache = new Map(); // key → { planId, expiresAt, value }

function cacheGet(key) {
  const entry = contextCache.get(key);
  if (!entry) return undefined;
  if (Date.now() > entry.expiresAt) {
    contextCache.delete(key);
    return undefined;
  }
  return entry.value;
}

function cacheSet(key, planId, value) {
  if (contextCache.size >= CACHE_MAX_ENTRIES) {
    // Evict oldest insertion (Map preserves insertion order)
    const oldest = contextCache.keys().next().value;
    contextCache.delete(oldest);
  }
  contextCache.set(key, { planId, expiresAt: Date.now() + CACHE_TTL_MS, value });
}

function invalidatePlanContext(planId) {
  for (const [key, entry] of contextCache) {
    if (entry.planId === planId) contextCache.delete(key);
  }
}

/**
 * Subscribe cache invalidation to the message bus. Called from index.js
 * alongside the other listeners after messageBus.init().
 */
function initContextCacheInvalidation(messageBus) {
  messageBus.subscribe('node.status.changed', (data) => {
    if (data?.planId) invalidatePlanContext(data.planId);
    else contextCache.clear(); // no plan info — drop everything, stay correct
  });
}

// ---- token estimation helpers ----
const CHARS_PER_TOKEN = 4; // rough heuristic for English/JSON

function estimateTokens(obj) {
  if (obj == null) return 0;
  const s = typeof obj === 'string' ? obj : JSON.stringify(obj);
  return Math.ceil(s.length / CHARS_PER_TOKEN);
}

function trimToTokenBudget(context, budget) {
  if (!budget || budget <= 0) return context;

  let used = 0;
  const result = {};

  // Priority order: layers 1→4, within each layer keep fields in definition order
  for (const [key, value] of Object.entries(context)) {
    if (key === 'meta') { result[key] = value; continue; }
    const cost = estimateTokens(value);
    if (used + cost <= budget) {
      result[key] = value;
      used += cost;
    } else {
      // Try to include a truncated version for array fields
      if (Array.isArray(value) && value.length > 0) {
        const partial = [];
        for (const item of value) {
          const itemCost = estimateTokens(item);
          if (used + itemCost <= budget) {
            partial.push(item);
            used += itemCost;
          } else break;
        }
        if (partial.length > 0) {
          result[key] = partial;
          result[key + '_truncated'] = true;
        }
      }
      // Stop adding more top-level keys once budget is tight
    }
  }

  result.meta = { ...result.meta, token_estimate: used, budget_applied: budget };
  return result;
}

// ---- snake_case helpers ----
function snakeNode(n) {
  if (!n) return null;
  return {
    id: n.id,
    title: n.title,
    node_type: n.nodeType,
    status: n.status,
    description: n.description,
    context: n.context,
    agent_instructions: n.agentInstructions,
    task_mode: n.taskMode,
    parent_id: n.parentId,
    plan_id: n.planId,
    order_index: n.orderIndex,
    due_date: n.dueDate,
    assigned_agent_id: n.assignedAgentId,
    metadata: n.metadata,
  };
}

function snakeNodeMinimal(n) {
  if (!n) return null;
  return {
    id: n.id,
    title: n.title,
    node_type: n.nodeType,
    status: n.status,
    task_mode: n.taskMode,
    order_index: n.orderIndex,
  };
}

function snakeLog(l) {
  return {
    id: l.id,
    content: l.content,
    log_type: l.logType,
    tags: l.tags,
    created_at: l.createdAt,
    user_name: l.userName,
  };
}

function snakeDep(d) {
  const dep = d.dependency || d;
  return {
    id: dep.id,
    source_node_id: dep.sourceNodeId,
    target_node_id: dep.targetNodeId,
    dependency_type: dep.dependencyType,
    weight: dep.weight,
    node_title: d.node?.title || d.sourceNode?.title,
  };
}

// ---- main engine ----

/**
 * Assemble progressive context for a node.
 *
 * @param {string} nodeId   — target node
 * @param {object} opts
 * @param {number} opts.depth        — 1-4 (default 2)
 * @param {number} opts.token_budget — max estimated tokens (0 = unlimited)
 * @param {number} opts.log_limit    — recent logs per node (default 10)
 * @param {boolean} opts.include_research — include research logs from RPI chain (default true)
 * @returns {Promise<object>} assembled context
 */
async function assembleContext(nodeId, opts = {}) {
  const depth = Math.min(Math.max(opts.depth ?? 2, 1), 4);
  const tokenBudget = opts.token_budget ?? 0;
  const logLimit = opts.log_limit ?? 10;
  const includeResearch = opts.include_research !== false;
  const orgId = opts.orgId;

  const cacheKey = `${nodeId}:${depth}:${tokenBudget}:${logLimit}:${includeResearch}:${orgId ?? ''}`;
  if (!cacheDisabled) {
    const cached = cacheGet(cacheKey);
    if (cached !== undefined) return cached;
  }

  const node = await dal.nodesDal.findById(nodeId);
  if (!node) return null;

  const finish = (ctx) => {
    const result = trimToTokenBudget(ctx, tokenBudget);
    if (!cacheDisabled) cacheSet(cacheKey, node.planId, result);
    return result;
  };

  const context = {
    meta: { node_id: nodeId, depth, requested_at: new Date().toISOString() },
  };

  // ── Layer 1: Task Focus ──
  context.task = snakeNode(node);

  // Recent logs for this node
  const logs = await dal.logsDal.listByNode(nodeId, { limit: logLimit });
  context.logs = logs.map(snakeLog);

  // If this node is part of an RPI chain and has task_mode=implement,
  // pull research+plan outputs from upstream siblings
  if (includeResearch && node.taskMode === 'implement' && node.parentId) {
    const rpiLogs = await getRpiChainResearch(node);
    if (rpiLogs.length > 0) context.rpi_research = rpiLogs;
  }

  if (depth < 2) {
    context.meta.layers_included = ['task_focus'];
    return finish(context);
  }

  // ── Layer 2: Local Neighborhood ──
  // Parent
  if (node.parentId) {
    const parent = await dal.nodesDal.findById(node.parentId);
    context.parent = snakeNodeMinimal(parent);
  }

  // Siblings
  if (node.parentId) {
    const siblings = await dal.nodesDal.getChildren(node.parentId);
    context.siblings = siblings
      .filter(s => s.id !== nodeId)
      .map(snakeNodeMinimal);
  }

  // Children — the focal node's direct descendants. Without this you can only
  // walk a plan tree sideways (siblings) or up (parent/ancestry), never DOWN,
  // which makes a plan/phase impossible to enumerate from the top.
  context.children = (await dal.nodesDal.getChildren(nodeId)).map(snakeNodeMinimal);

  // Direct dependencies (upstream = what blocks me, downstream = what I block)
  try {
    const deps = await dal.dependenciesDal.listByNode(nodeId, 'both');
    context.dependencies = {
      upstream: (deps.upstream || []).map(snakeDep),
      downstream: (deps.downstream || []).map(snakeDep),
    };
  } catch {
    context.dependencies = { upstream: [], downstream: [] };
  }

  if (depth < 3) {
    context.meta.layers_included = ['task_focus', 'local_neighborhood'];
    return finish(context);
  }

  // ── Layer 3: Knowledge (Graphiti temporal graph) ──
  if (graphitiBridge.isAvailable()) {
    try {
      const searchQuery = [node.title, node.description].filter(Boolean).join(' ');
      const facts = await graphitiBridge.queryForContext(node.planId, searchQuery, orgId);
      context.knowledge = facts;
    } catch {
      context.knowledge = [];
    }
  } else {
    context.knowledge = [];
  }

  if (depth < 4) {
    context.meta.layers_included = ['task_focus', 'local_neighborhood', 'knowledge'];
    return finish(context);
  }

  // ── Layer 4: Extended Context ──
  // Plan overview
  const plan = await dal.plansDal.findById(node.planId);
  if (plan) {
    context.plan = {
      id: plan.id,
      title: plan.title,
      description: plan.description,
      status: plan.status,
      github_repo_url: plan.githubRepoUrl,
    };
  }

  // Ancestry path (node → root)
  const ancestry = [];
  let currentId = node.parentId;
  while (currentId) {
    const ancestor = await dal.nodesDal.findById(currentId);
    if (!ancestor) break;
    ancestry.push(snakeNodeMinimal(ancestor));
    currentId = ancestor.parentId;
  }
  context.ancestry = ancestry;

  // Linked goals
  try {
    const goals = await dal.goalsDal.getLinkedGoals('plan', node.planId);
    context.goals = goals.map(g => ({
      id: g.id,
      title: g.title,
      description: g.description,
      status: g.status,
      success_criteria: g.successCriteria,
    }));
  } catch {
    context.goals = [];
  }

  // Standing guidance — active org-level INVARIANT goals (type principle |
  // constraint). These aren't worked toward task-by-task; they apply to ALL
  // work in the org, so every task surfaces them. This is what makes goal.type
  // behavioral: a 'principle'/'constraint' goal steers agents directly here,
  // rather than being an inert label. Requires orgId (org-scoped).
  if (orgId) {
    try {
      const guidance = await dal.goalsDal.getStandingGuidance(orgId);
      context.standing_guidance = guidance.map(g => ({
        id: g.id,
        type: g.type, // 'principle' (durable invariant) | 'constraint' (must-not-violate)
        title: g.title,
        description: g.description,
      }));
    } catch {
      context.standing_guidance = [];
    }
  } else {
    context.standing_guidance = [];
  }

  // Transitive dependencies (depth 2+)
  try {
    const upstream = await dal.dependenciesDal.getUpstream(nodeId, 5);
    const downstream = await dal.dependenciesDal.getDownstream(nodeId, 5);
    context.transitive_dependencies = {
      upstream: upstream.map(u => ({
        node_id: u.node_id, title: u.title, status: u.status,
        depth: u.depth, dependency_type: u.dependency_type,
      })),
      downstream: downstream.map(d => ({
        node_id: d.node_id, title: d.title, status: d.status,
        depth: d.depth, dependency_type: d.dependency_type,
      })),
    };
  } catch {
    context.transitive_dependencies = { upstream: [], downstream: [] };
  }

  context.meta.layers_included = ['task_focus', 'local_neighborhood', 'knowledge', 'extended'];
  return finish(context);
}

/**
 * For an RPI "implement" node, find its research/plan siblings and
 * return their context. Prefers compacted summaries over raw logs.
 */
async function getRpiChainResearch(node) {
  if (!node.parentId) return [];

  const siblings = await dal.nodesDal.getChildren(node.parentId);
  const researchSiblings = siblings.filter(
    s => s.id !== node.id && (s.taskMode === 'research' || s.taskMode === 'plan')
  );

  if (researchSiblings.length === 0) return [];

  const results = [];

  for (const sibling of researchSiblings) {
    // Prefer compacted context if available (completed research/plan tasks)
    const compacted = sibling.metadata?.compacted_context;
    if (compacted) {
      results.push({
        source_node_id: sibling.id,
        source_title: sibling.title,
        source_task_mode: sibling.taskMode,
        compacted: true,
        sections: compacted.sections,
      });
    } else {
      // Fall back to raw logs
      const logs = await dal.logsDal.listByNode(sibling.id, { limit: 10 });
      for (const l of logs) {
        results.push({
          source_node_id: l.planNodeId,
          source_task_mode: sibling.taskMode,
          content: l.content,
          log_type: l.logType,
          created_at: l.createdAt,
          compacted: false,
        });
      }
    }
  }

  return results;
}

/**
 * Suggest next actionable tasks for a plan, considering dependencies.
 *
 * A task is "ready" when:
 *   - status is not_started or plan_ready
 *   - all upstream blockers/requires are completed
 *
 * Returns tasks ordered by priority: RPI chains first, then by dependency count.
 */
/**
 * Build a global document-order rank for every node in a plan.
 *
 * `order_index` is only meaningful *within a parent's children* — a "task 0"
 * in phase 3 shares order_index 0 with "task 0" in phase 1. To choose the
 * earliest incomplete task across the whole plan we need a deterministic
 * depth-first rank (root → phases by order_index → tasks by order_index).
 * Returns Map<nodeId, number>; earlier in the plan = smaller number.
 */
function buildDocumentOrder(nodes) {
  const childrenByParent = new Map();
  for (const n of nodes) {
    const key = n.parentId || '__root__';
    if (!childrenByParent.has(key)) childrenByParent.set(key, []);
    childrenByParent.get(key).push(n);
  }
  for (const list of childrenByParent.values()) {
    list.sort((a, b) => (a.orderIndex ?? 0) - (b.orderIndex ?? 0));
  }
  const order = new Map();
  let i = 0;
  const visit = (parentKey) => {
    for (const node of childrenByParent.get(parentKey) || []) {
      order.set(node.id, i++);
      visit(node.id);
    }
  };
  visit('__root__');
  // Defensive: any node not reachable from a root (orphaned parent ref) still
  // gets a stable rank so it can't be silently dropped from selection.
  for (const n of nodes) if (!order.has(n.id)) order.set(n.id, i++);
  return order;
}

async function suggestNextTasks(planId, { limit = 5, orgId } = {}) {
  const allNodes = await dal.nodesDal.listByPlan(planId);
  const documentOrder = buildDocumentOrder(allNodes);
  const tasks = allNodes.filter(n =>
    (n.nodeType === 'task' || n.nodeType === 'milestone') &&
    (n.status === 'not_started' || n.status === 'plan_ready')
  );

  if (tasks.length === 0) return [];

  // Get all dependencies in the plan
  let allDeps = [];
  try {
    const depsResult = await dal.dependenciesDal.listByPlan(planId);
    allDeps = depsResult.map(r => r.dependency);
  } catch {
    // If deps not available, just return tasks in plan (document) order
    return [...tasks]
      .sort((a, b) => (documentOrder.get(a.id) ?? 0) - (documentOrder.get(b.id) ?? 0))
      .slice(0, limit)
      .map(t => ({
        ...snakeNodeMinimal(t),
        reason: 'No dependency information available',
        ready: true,
      }));
  }

  // Build a map of blocking dependencies per target
  const blockedBy = new Map(); // targetId → [sourceId...]
  for (const dep of allDeps) {
    if (dep.dependencyType === 'blocks' || dep.dependencyType === 'requires') {
      const list = blockedBy.get(dep.targetNodeId) || [];
      list.push(dep.sourceNodeId);
      blockedBy.set(dep.targetNodeId, list);
    }
  }

  // Find completed node IDs
  const completedIds = new Set(allNodes.filter(n => n.status === 'completed').map(n => n.id));

  // Classify tasks
  const suggestions = [];
  for (const task of tasks) {
    const blockers = blockedBy.get(task.id) || [];
    const unresolvedBlockers = blockers.filter(id => !completedIds.has(id));
    const isReady = unresolvedBlockers.length === 0;

    if (!isReady) continue; // Only suggest ready tasks

    // Exclude tasks that have an active claim (another agent is working on them)
    try {
      const activeClaim = await dal.claimsDal.getActiveClaim(task.id);
      if (activeClaim) continue;
    } catch { /* non-fatal — if claims table not available, skip filtering */ }

    // Determine how many downstream tasks this unblocks
    const unblocks = allDeps.filter(d =>
      d.sourceNodeId === task.id &&
      (d.dependencyType === 'blocks' || d.dependencyType === 'requires')
    ).length;

    let reason = 'All dependencies satisfied';
    if (task.taskMode === 'research') reason = 'RPI chain: start research phase';
    else if (task.taskMode === 'plan') reason = 'RPI chain: research complete, plan next';
    else if (task.taskMode === 'implement') reason = 'RPI chain: plan approved, implement next';
    if (unblocks > 0) reason += ` (unblocks ${unblocks} task${unblocks > 1 ? 's' : ''})`;

    // Check knowledge availability via Graphiti (if available)
    let knowledge_ready = false;
    if (graphitiBridge.isAvailable()) {
      try {
        const facts = await graphitiBridge.queryForContext(planId, task.title, orgId);
        knowledge_ready = facts.length > 0;
      } catch { /* non-fatal */ }
    }

    suggestions.push({
      ...snakeNodeMinimal(task),
      description: task.description,
      agent_instructions: task.agentInstructions,
      parent_id: task.parentId,
      ready: true,
      unblocks_count: unblocks,
      knowledge_ready,
      document_order: documentOrder.get(task.id) ?? Number.MAX_SAFE_INTEGER,
      reason: reason + (knowledge_ready ? ' (knowledge available)' : ''),
    });
  }

  // Sort by global plan (document) order so the EARLIEST incomplete actionable
  // task wins — resuming a partial plan must not skip earlier unfinished work.
  // unblocks_count / RPI-research only break ties at the same document position
  // (which effectively never happens, since document_order is unique), so they
  // no longer let a later-phase task jump ahead of an earlier actionable one.
  suggestions.sort((a, b) => {
    if (a.document_order !== b.document_order) return a.document_order - b.document_order;
    if (a.task_mode === 'research' && b.task_mode !== 'research') return -1;
    if (b.task_mode === 'research' && a.task_mode !== 'research') return 1;
    return b.unblocks_count - a.unblocks_count;
  });

  return suggestions.slice(0, limit);
}

module.exports = { assembleContext, suggestNextTasks, buildDocumentOrder, estimateTokens, initContextCacheInvalidation };
