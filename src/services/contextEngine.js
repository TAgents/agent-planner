/**
 * Progressive Context Engine
 *
 * Assembles context for agent tasks via 4 progressive layers:
 *   Layer 1 — Task Focus: the node itself + recent logs
 *   Layer 2 — Local Neighborhood: parent, siblings, direct dependencies
 *   Layer 3 — Knowledge: plan-scoped knowledge entries (stub for Graphiti)
 *   Layer 4 — Extended: plan overview, cross-references, goal alignment
 *
 * Each layer adds detail; callers pick max depth + optional token budget.
 * Token estimation uses a simple heuristic (~4 chars per token).
 */

const dal = require('../db/dal.cjs');
const graphitiBridge = require('./graphitiBridge');

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

  const node = await dal.nodesDal.findById(nodeId);
  if (!node) return null;

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
    return trimToTokenBudget(context, tokenBudget);
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
    return trimToTokenBudget(context, tokenBudget);
  }

  // ── Layer 3: Knowledge (Graphiti temporal graph) ──
  if (graphitiBridge.isAvailable()) {
    try {
      const searchQuery = [node.title, node.description].filter(Boolean).join(' ');
      const facts = await graphitiBridge.queryForContext(node.planId, searchQuery);
      context.knowledge = facts;
    } catch {
      context.knowledge = [];
    }
  } else {
    context.knowledge = [];
  }

  if (depth < 4) {
    context.meta.layers_included = ['task_focus', 'local_neighborhood', 'knowledge'];
    return trimToTokenBudget(context, tokenBudget);
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
  return trimToTokenBudget(context, tokenBudget);
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
async function suggestNextTasks(planId, { limit = 5 } = {}) {
  const allNodes = await dal.nodesDal.listByPlan(planId);
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
    // If deps not available, just return tasks by order
    return tasks.slice(0, limit).map(t => ({
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
        const facts = await graphitiBridge.queryForContext(planId, task.title);
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
      reason: reason + (knowledge_ready ? ' (knowledge available)' : ''),
    });
  }

  // Sort: RPI research first, then by unblocks_count desc, then order_index
  suggestions.sort((a, b) => {
    // RPI research tasks first
    if (a.task_mode === 'research' && b.task_mode !== 'research') return -1;
    if (b.task_mode === 'research' && a.task_mode !== 'research') return 1;
    // Then by how many tasks this unblocks
    if (b.unblocks_count !== a.unblocks_count) return b.unblocks_count - a.unblocks_count;
    // Then by order
    return (a.order_index ?? 0) - (b.order_index ?? 0);
  });

  return suggestions.slice(0, limit);
}

module.exports = { assembleContext, suggestNextTasks, estimateTokens };
