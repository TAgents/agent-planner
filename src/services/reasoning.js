/**
 * Reasoning Services
 *
 * Status propagation, bottleneck detection, RPI chain detection,
 * topological sorting, and auto-decomposition alerts.
 */

const dal = require('../db/dal.cjs');

// ─── Status Propagation ───
// When a task is completed, auto-unblock downstream tasks whose
// blockers are all completed. When a task is blocked, warn downstream.

/**
 * Propagate status changes through the dependency graph.
 * Called when a node's status changes.
 *
 * @param {string} nodeId - The node whose status changed
 * @param {string} newStatus - The new status
 * @returns {object} Summary of propagation effects
 */
async function propagateStatus(nodeId, newStatus) {
  const effects = { unblocked: [], warnings: [] };

  if (newStatus === 'completed') {
    // Check downstream tasks that this node blocks
    const downstream = await dal.dependenciesDal.listByNode(nodeId, 'downstream');
    const targets = Array.isArray(downstream) ? downstream : [];

    for (const row of targets) {
      const dep = row.dependency || row;
      if (dep.dependencyType !== 'blocks' && dep.dependencyType !== 'requires') continue;

      const targetId = dep.targetNodeId;
      const targetNode = await dal.nodesDal.findById(targetId);
      if (!targetNode || targetNode.status !== 'blocked') continue;

      // Check if ALL upstream blockers of this target are now completed
      const upstream = await dal.dependenciesDal.listByNode(targetId, 'upstream');
      const upstreamList = Array.isArray(upstream) ? upstream : [];
      const allResolved = upstreamList.every(u => {
        const uDep = u.dependency || u;
        if (uDep.dependencyType !== 'blocks' && uDep.dependencyType !== 'requires') return true;
        // Check source node status
        return false; // We need to fetch each source node
      });

      // More accurate check: fetch all source nodes
      const blockerIds = upstreamList
        .filter(u => {
          const uDep = u.dependency || u;
          return uDep.dependencyType === 'blocks' || uDep.dependencyType === 'requires';
        })
        .map(u => (u.dependency || u).sourceNodeId);

      let allBlockersCompleted = true;
      for (const blockerId of blockerIds) {
        const blocker = await dal.nodesDal.findById(blockerId);
        if (blocker && blocker.status !== 'completed') {
          allBlockersCompleted = false;
          break;
        }
      }

      if (allBlockersCompleted) {
        await dal.nodesDal.update(targetId, { status: 'not_started' });
        effects.unblocked.push({
          node_id: targetId,
          title: targetNode.title,
          previous_status: 'blocked',
          new_status: 'not_started',
        });
      }
    }
  }

  // ── Parent auto-completion ──
  // When a node is completed, check if all siblings under the same parent
  // are also completed. If so, auto-complete the parent (phase/root).
  if (newStatus === 'completed') {
    const node = await dal.nodesDal.findById(nodeId);
    if (node && node.parentId) {
      const siblings = await dal.nodesDal.getChildren(node.parentId);
      const allDone = siblings.every(s => s.status === 'completed');
      if (allDone) {
        const parent = await dal.nodesDal.findById(node.parentId);
        if (parent && parent.status !== 'completed' && parent.nodeType !== 'root') {
          await dal.nodesDal.update(node.parentId, { status: 'completed' });
          effects.unblocked.push({
            node_id: node.parentId,
            title: parent.title,
            previous_status: parent.status,
            new_status: 'completed',
            reason: 'all_children_completed',
          });
          // Recurse: completing a phase may complete its parent too
          const parentEffects = await propagateStatus(node.parentId, 'completed');
          effects.unblocked.push(...parentEffects.unblocked);
          effects.warnings.push(...parentEffects.warnings);
        }
      }
    }
  }

  if (newStatus === 'blocked') {
    // Warn downstream tasks that a blocker is now blocked
    const downstream = await dal.dependenciesDal.listByNode(nodeId, 'downstream');
    const targets = Array.isArray(downstream) ? downstream : [];

    for (const row of targets) {
      const dep = row.dependency || row;
      if (dep.dependencyType !== 'blocks') continue;
      const targetNode = await dal.nodesDal.findById(dep.targetNodeId);
      if (targetNode && targetNode.status !== 'completed' && targetNode.status !== 'blocked') {
        effects.warnings.push({
          node_id: dep.targetNodeId,
          title: targetNode?.title,
          message: `Upstream blocker "${(await dal.nodesDal.findById(nodeId))?.title}" is now blocked`,
        });
      }
    }
  }

  return effects;
}

// ─── Bottleneck Detection ───
// Find nodes with the most downstream dependents (high fan-out).

/**
 * Detect bottleneck nodes in a plan.
 * A bottleneck is a node that blocks many downstream tasks.
 *
 * @param {string} planId
 * @param {object} opts
 * @param {number} opts.limit - Max results (default 5)
 * @param {boolean} opts.incomplete_only - Only show non-completed (default true)
 * @returns {Array} Bottleneck nodes with downstream counts
 */
async function detectBottlenecks(planId, { limit = 5, incomplete_only = true } = {}) {
  const allNodes = await dal.nodesDal.listByPlan(planId);
  const tasks = allNodes.filter(n =>
    n.nodeType === 'task' || n.nodeType === 'milestone'
  );

  if (tasks.length === 0) return [];

  let allDeps = [];
  try {
    const depsResult = await dal.dependenciesDal.listByPlan(planId);
    allDeps = depsResult.map(r => r.dependency);
  } catch {
    return [];
  }

  // Count how many tasks each node blocks (directly + transitively)
  const blockCounts = new Map();
  for (const dep of allDeps) {
    if (dep.dependencyType === 'blocks' || dep.dependencyType === 'requires') {
      blockCounts.set(dep.sourceNodeId, (blockCounts.get(dep.sourceNodeId) || 0) + 1);
    }
  }

  const bottlenecks = tasks
    .filter(n => blockCounts.has(n.id))
    .filter(n => !incomplete_only || n.status !== 'completed')
    .map(n => ({
      node_id: n.id,
      title: n.title,
      status: n.status,
      node_type: n.nodeType,
      task_mode: n.taskMode,
      direct_downstream_count: blockCounts.get(n.id) || 0,
    }))
    .sort((a, b) => b.direct_downstream_count - a.direct_downstream_count)
    .slice(0, limit);

  return bottlenecks;
}

// ─── RPI Chain Detection ───
// Find existing R→P→I chains and validate their integrity.

/**
 * Detect RPI chains in a plan.
 * An RPI chain is a set of 3 sibling tasks with task_mode research→plan→implement
 * connected by blocks dependencies.
 *
 * @param {string} planId
 * @returns {Array} Detected chains with status
 */
async function detectRpiChains(planId) {
  const allNodes = await dal.nodesDal.listByPlan(planId);
  const tasks = allNodes.filter(n => n.nodeType === 'task' && n.taskMode);

  let allDeps = [];
  try {
    const depsResult = await dal.dependenciesDal.listByPlan(planId);
    allDeps = depsResult.map(r => r.dependency);
  } catch {
    return [];
  }

  // Group tasks by parent
  const byParent = new Map();
  for (const task of tasks) {
    const parentId = task.parentId;
    if (!parentId) continue;
    const group = byParent.get(parentId) || [];
    group.push(task);
    byParent.set(parentId, group);
  }

  const chains = [];

  for (const [parentId, siblings] of byParent) {
    const research = siblings.filter(s => s.taskMode === 'research');
    const plan = siblings.filter(s => s.taskMode === 'plan');
    const implement = siblings.filter(s => s.taskMode === 'implement');

    // Find connected R→P→I chains
    for (const r of research) {
      for (const p of plan) {
        // Check if R blocks P
        const rBlocksP = allDeps.some(d =>
          d.sourceNodeId === r.id && d.targetNodeId === p.id &&
          d.dependencyType === 'blocks'
        );
        if (!rBlocksP) continue;

        for (const i of implement) {
          // Check if P blocks I
          const pBlocksI = allDeps.some(d =>
            d.sourceNodeId === p.id && d.targetNodeId === i.id &&
            d.dependencyType === 'blocks'
          );
          if (!pBlocksI) continue;

          // Found a chain
          const chainStatus =
            i.status === 'completed' ? 'completed' :
            i.status === 'in_progress' ? 'implementing' :
            p.status === 'completed' || p.status === 'plan_ready' ? 'plan_ready' :
            p.status === 'in_progress' ? 'planning' :
            r.status === 'completed' ? 'research_done' :
            r.status === 'in_progress' ? 'researching' :
            'not_started';

          chains.push({
            parent_id: parentId,
            parent_title: allNodes.find(n => n.id === parentId)?.title,
            status: chainStatus,
            research: { id: r.id, title: r.title, status: r.status },
            plan: { id: p.id, title: p.title, status: p.status },
            implement: { id: i.id, title: i.title, status: i.status },
          });
        }
      }
    }
  }

  return chains;
}

// ─── Topological Sort ───
// Returns tasks in dependency order (respecting blocks/requires edges).

/**
 * Get tasks in topological order for a plan.
 * Tasks with no dependencies come first, then tasks whose deps are satisfied.
 *
 * @param {string} planId
 * @returns {Array} Nodes in execution order
 */
async function topologicalSort(planId) {
  const allNodes = await dal.nodesDal.listByPlan(planId);
  const tasks = allNodes.filter(n =>
    (n.nodeType === 'task' || n.nodeType === 'milestone') && n.status !== 'completed'
  );

  let allDeps = [];
  try {
    const depsResult = await dal.dependenciesDal.listByPlan(planId);
    allDeps = depsResult.map(r => r.dependency)
      .filter(d => d.dependencyType === 'blocks' || d.dependencyType === 'requires');
  } catch {
    return tasks.map(t => ({
      id: t.id, title: t.title, status: t.status, task_mode: t.taskMode,
      node_type: t.nodeType, layer: 0,
    }));
  }

  const taskIds = new Set(tasks.map(t => t.id));
  const inDegree = new Map();
  const adjList = new Map();

  for (const t of tasks) {
    inDegree.set(t.id, 0);
    adjList.set(t.id, []);
  }

  for (const dep of allDeps) {
    if (taskIds.has(dep.sourceNodeId) && taskIds.has(dep.targetNodeId)) {
      adjList.get(dep.sourceNodeId).push(dep.targetNodeId);
      inDegree.set(dep.targetNodeId, (inDegree.get(dep.targetNodeId) || 0) + 1);
    }
  }

  // Kahn's algorithm
  const queue = [];
  for (const [id, deg] of inDegree) {
    if (deg === 0) queue.push(id);
  }

  const result = [];
  let layer = 0;

  while (queue.length > 0) {
    const currentLayer = [...queue];
    queue.length = 0;

    for (const nodeId of currentLayer) {
      const node = tasks.find(t => t.id === nodeId);
      result.push({
        id: node.id,
        title: node.title,
        status: node.status,
        task_mode: node.taskMode,
        node_type: node.nodeType,
        layer,
      });

      for (const neighbor of (adjList.get(nodeId) || [])) {
        const newDeg = (inDegree.get(neighbor) || 1) - 1;
        inDegree.set(neighbor, newDeg);
        if (newDeg === 0) queue.push(neighbor);
      }
    }

    layer++;
  }

  return result;
}

// ─── Auto-decomposition Alerts ───
// Flag tasks that might need decomposition (too complex for a single task).

/**
 * Detect tasks that may need decomposition.
 * Heuristics: long description, many logs, stale in_progress, high dependency count.
 *
 * @param {string} planId
 * @returns {Array} Tasks flagged for decomposition
 */
async function detectDecompositionCandidates(planId) {
  const allNodes = await dal.nodesDal.listByPlan(planId);
  const tasks = allNodes.filter(n =>
    n.nodeType === 'task' && n.status !== 'completed' && !n.taskMode
  );

  const alerts = [];

  for (const task of tasks) {
    const reasons = [];

    // Long description suggests complexity
    if (task.description && task.description.length > 500) {
      reasons.push('Long description suggests multiple sub-tasks');
    }

    // Stale in_progress (more than 7 days)
    if (task.status === 'in_progress') {
      const daysInProgress = (Date.now() - new Date(task.updatedAt).getTime()) / (1000 * 60 * 60 * 24);
      if (daysInProgress > 7) {
        reasons.push(`In progress for ${Math.round(daysInProgress)} days`);
      }
    }

    // High log count suggests ongoing complexity
    try {
      const logCount = await dal.logsDal.countByNodes([task.id]);
      if (logCount > 20) {
        reasons.push(`${logCount} log entries — high activity suggests complexity`);
      }
    } catch { /* ignore */ }

    if (reasons.length > 0) {
      alerts.push({
        node_id: task.id,
        title: task.title,
        status: task.status,
        recommendation: 'Consider decomposing into an RPI chain',
        reasons,
      });
    }
  }

  return alerts;
}

/**
 * Initialize status propagation listener on the message bus.
 */
function initStatusPropagation(messageBus) {
  if (!messageBus) return;

  messageBus.subscribe('node.status.changed', async (event) => {
    try {
      const { nodeId, newStatus } = event;
      await propagateStatus(nodeId, newStatus);
    } catch (err) {
      console.error('Status propagation error:', err.message);
    }
  });
}

module.exports = {
  propagateStatus,
  detectBottlenecks,
  detectRpiChains,
  topologicalSort,
  detectDecompositionCandidates,
  initStatusPropagation,
};
