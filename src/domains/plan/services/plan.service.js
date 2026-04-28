/**
 * Plan Service — business logic for the plan domain.
 *
 * All data access goes through plan.repository.js — never imports DAL directly.
 */
const repo = require('../repositories/plan.repository');
const { checkPlanAccess } = require('../../../middleware/planAccess.middleware');
const { broadcastPlanUpdate, broadcastToAll } = require('../../../websocket/broadcast');
const {
  createPlanCreatedMessage,
  createPlanUpdatedMessage,
  createPlanDeletedMessage,
} = require('../../../websocket/message-schema');

class ServiceError extends Error {
  constructor(message, statusCode) {
    super(message);
    this.statusCode = statusCode;
  }
}

const snakePlan = (p) => ({
  id: p.id, title: p.title, description: p.description,
  owner_id: p.ownerId, organization_id: p.organizationId,
  status: p.status, visibility: p.visibility,
  is_public: p.isPublic, view_count: p.viewCount,
  github_repo_owner: p.githubRepoOwner, github_repo_name: p.githubRepoName,
  github_repo_url: p.githubRepoUrl, github_repo_full_name: p.githubRepoFullName,
  metadata: p.metadata,
  quality_score: p.qualityScore,
  quality_assessed_at: p.qualityAssessedAt,
  quality_rationale: p.qualityRationale,
  coherence_checked_at: p.coherenceCheckedAt,
  created_at: p.createdAt, updated_at: p.updatedAt,
  last_viewed_at: p.lastViewedAt,
});

const calculatePlanProgress = async (planId) => {
  const nodes = await repo.listNodesByPlan(planId);
  if (!nodes.length) return 0;
  const completed = nodes.filter(n => n.status === 'completed').length;
  return Math.round((completed / nodes.length) * 100);
};

/**
 * Returns the per-status breakdown plus total + percentage so the
 * Plans Index can render a segmented progress bar (done / doing /
 * blocked / todo) instead of a single number. Reuses the same node
 * fetch as `calculatePlanProgress` so the listing page doesn't pay
 * twice per plan.
 */
const computePlanStats = async (planId) => {
  const nodes = await repo.listNodesByPlan(planId);
  const total = nodes.length;
  if (!total) {
    return { total: 0, done: 0, doing: 0, blocked: 0, todo: 0, percentage: 0 };
  }
  let done = 0;
  let doing = 0;
  let blocked = 0;
  let todo = 0;
  for (const n of nodes) {
    if (n.nodeType === 'root') continue; // root is structural, not a real task
    switch (n.status) {
      case 'completed': done += 1; break;
      case 'in_progress': doing += 1; break;
      case 'blocked': blocked += 1; break;
      default: todo += 1; break;
    }
  }
  const counted = done + doing + blocked + todo;
  const percentage = counted ? Math.round((done / counted) * 100) : 0;
  return { total: counted, done, doing, blocked, todo, percentage };
};

const requireAccess = async (planId, userId, roles = []) => {
  if (!(await checkPlanAccess(planId, userId, roles))) {
    const msg = roles.length
      ? 'You do not have permission for this action'
      : 'You do not have access to this plan';
    throw new ServiceError(msg, 403);
  }
};

const requirePlan = async (planId) => {
  const plan = await repo.findById(planId);
  if (!plan) throw new ServiceError('Plan not found', 404);
  return plan;
};

// ── List & Get ─────────────────────────────────────────────

async function listPlans(userId, organizationId, { statusFilter } = {}) {
  const { owned, shared, organization = [] } = await repo.listForUser(userId, { organizationId, status: statusFilter });

  const ownedResults = await Promise.all(owned.map(async (p) => ({
    ...snakePlan(p), role: 'owner',
    progress: await calculatePlanProgress(p.id),
    stats: await computePlanStats(p.id),
  })));

  const sharedResults = await Promise.all(shared.map(async (p) => ({
    ...snakePlan(p), role: p.role,
    progress: await calculatePlanProgress(p.id),
    stats: await computePlanStats(p.id),
  })));

  const orgResults = await Promise.all(organization.map(async (p) => ({
    ...snakePlan(p), role: p.role,
    progress: await calculatePlanProgress(p.id),
    stats: await computePlanStats(p.id),
  })));

  const all = [...ownedResults, ...sharedResults, ...orgResults];
  const unique = [...new Map(all.map(p => [p.id, p])).values()];

  // Bulk-decorate with goal tether + agent-active timestamps so the
  // Plans Index row ornaments don't trigger N+1 queries client-side.
  const planIds = unique.map(p => p.id);
  const [goalRows, logRows] = await Promise.all([
    repo.listGoalTethersForPlanIds(planIds),
    repo.latestLogTimestampsByPlanIds(planIds),
  ]);
  const tethersByPlan = new Map();
  for (const row of goalRows) {
    if (!tethersByPlan.has(row.plan_id)) tethersByPlan.set(row.plan_id, []);
    tethersByPlan.get(row.plan_id).push({ goal_id: row.goal_id, goal_title: row.goal_title });
  }
  const lastLogByPlan = new Map(logRows.map(r => [r.plan_id, r.last_log_at]));
  for (const p of unique) {
    p.goal_tethers = tethersByPlan.get(p.id) || [];
    p.last_agent_log_at = lastLogByPlan.get(p.id) || null;
  }

  unique.sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));

  return unique;
}

async function getPlan(planId, userId) {
  await requireAccess(planId, userId);

  const plan = await requirePlan(planId);
  const progress = await calculatePlanProgress(planId);
  const owner = await repo.findUserById(plan.ownerId);

  return {
    ...snakePlan(plan), progress,
    owner: owner ? { id: owner.id, name: owner.name, email: owner.email } : null,
  };
}

// ── Create ─────────────────────────────────────────────────

async function createPlan(userId, userName, { title, description, status, visibility, metadata, organizationId }) {
  if (!title) throw new ServiceError('Plan title is required', 400);

  const plan = await repo.create({
    title, description: description || '',
    ownerId: userId, status: status || 'draft',
    visibility: visibility || 'private',
    metadata: metadata || {},
    organizationId,
  });

  await repo.createNode({
    planId: plan.id, nodeType: 'root',
    title: plan.title, status: 'not_started',
    description: plan.description || '',
  });

  const result = snakePlan(plan);

  const message = createPlanCreatedMessage(result, userId, userName);
  await broadcastToAll(message);

  return result;
}

// ── Update ─────────────────────────────────────────────────

async function updatePlan(planId, userId, userName, data) {
  await requireAccess(planId, userId, ['owner', 'admin', 'editor']);

  if (data.qualityScore !== undefined && (typeof data.qualityScore !== 'number' || data.qualityScore < 0 || data.qualityScore > 1)) {
    throw new ServiceError('quality_score must be a number between 0.0 and 1.0', 400);
  }

  const updates = {};
  if (data.title !== undefined) updates.title = data.title;
  if (data.description !== undefined) updates.description = data.description;
  if (data.status !== undefined) updates.status = data.status;
  if (data.metadata !== undefined) updates.metadata = data.metadata;
  if (data.qualityScore !== undefined) updates.qualityScore = data.qualityScore;
  if (data.qualityAssessedAt !== undefined) updates.qualityAssessedAt = data.qualityAssessedAt;
  if (data.qualityRationale !== undefined) updates.qualityRationale = data.qualityRationale;

  const plan = await repo.update(planId, updates);
  if (!plan) throw new ServiceError('Plan not found', 404);

  const result = snakePlan(plan);

  const message = createPlanUpdatedMessage(result, userId, userName);
  await broadcastPlanUpdate(planId, message);

  return result;
}

// ── Delete ─────────────────────────────────────────────────

async function deletePlan(planId, userId, userName) {
  const plan = await requirePlan(planId);
  if (plan.ownerId !== userId) {
    throw new ServiceError('Only the plan owner can delete it', 403);
  }

  await repo.delete(planId);

  const message = createPlanDeletedMessage(planId, userId, userName);
  await broadcastToAll(message);
}

// ── Collaborators ──────────────────────────────────────────

async function listCollaborators(planId, userId) {
  await requireAccess(planId, userId);

  const collabs = await repo.listCollaborators(planId);
  const plan = await repo.findById(planId);

  const result = collabs.map(c => ({
    id: c.id, plan_id: c.planId, user_id: c.userId,
    role: c.role, created_at: c.createdAt,
    user: { id: c.userId, name: c.userName, email: c.userEmail },
  }));

  if (plan) {
    const owner = await repo.findUserById(plan.ownerId);
    if (owner) {
      result.unshift({
        id: null, plan_id: planId, user_id: owner.id,
        role: 'owner', created_at: plan.createdAt,
        user: { id: owner.id, name: owner.name, email: owner.email },
      });
    }
  }

  return result;
}

async function addCollaborator(planId, userId, { targetUserId, email, role }) {
  await requireAccess(planId, userId, ['owner', 'admin']);

  let resolvedUserId = targetUserId;
  if (!resolvedUserId && email) {
    const user = await repo.findUserByEmail(email);
    if (user) resolvedUserId = user.id;
  }

  if (!resolvedUserId) throw new ServiceError('User not found', 404);

  return repo.addCollaborator(planId, resolvedUserId, role || 'viewer');
}

async function removeCollaborator(planId, userId, targetUserId) {
  await requireAccess(planId, userId, ['owner', 'admin']);
  await repo.removeCollaborator(planId, targetUserId);
}

// ── Context & Progress ─────────────────────────────────────

async function getPlanContext(planId, userId) {
  await requireAccess(planId, userId);

  const [plan, nodes, collabs] = await Promise.all([
    repo.findById(planId),
    repo.listNodesByPlan(planId),
    repo.listCollaborators(planId),
  ]);

  const progress = nodes.length ? Math.round(nodes.filter(n => n.status === 'completed').length / nodes.length * 100) : 0;

  return {
    plan: plan ? { ...snakePlan(plan), progress } : null,
    nodes_count: nodes.length,
    collaborators_count: collabs.length,
  };
}

async function getPlanProgress(planId, userId) {
  await requireAccess(planId, userId);

  const nodes = await repo.listNodesByPlan(planId);
  const total = nodes.length;
  const byStatus = {};
  for (const n of nodes) {
    byStatus[n.status] = (byStatus[n.status] || 0) + 1;
  }

  return {
    total,
    completed: byStatus.completed || 0,
    in_progress: byStatus.in_progress || 0,
    not_started: byStatus.not_started || 0,
    blocked: byStatus.blocked || 0,
    progress_percentage: total ? Math.round(((byStatus.completed || 0) / total) * 100) : 0,
  };
}

// ── Public plans ───────────────────────────────────────────

async function listPublicPlans({ page = 1, limit = 12, search, status, sortBy = 'recent' }) {
  const allPlans = await repo.listPublic();

  let filtered = allPlans;
  if (search) {
    const q = search.toLowerCase();
    filtered = filtered.filter(p => (p.title || '').toLowerCase().includes(q) || (p.description || '').toLowerCase().includes(q));
  }
  if (status) {
    filtered = filtered.filter(p => p.status === status);
  }

  if (sortBy === 'alphabetical') {
    filtered.sort((a, b) => (a.title || '').localeCompare(b.title || ''));
  } else if (sortBy !== 'completion') {
    filtered.sort((a, b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt));
  }

  const total = filtered.length;
  const totalPages = Math.ceil(total / limit);
  const offset = (page - 1) * limit;
  const paginated = filtered.slice(offset, offset + limit);

  const results = await Promise.all(paginated.map(async (p) => {
    const owner = await repo.findUserById(p.ownerId);
    const nodes = await repo.listNodesByPlan(p.id);
    const task_count = nodes.length;
    const completed_count = nodes.filter(n => n.status === 'completed').length;
    const completion_percentage = task_count > 0 ? Math.round((completed_count / task_count) * 100) : 0;
    return {
      ...snakePlan(p),
      owner: owner ? { id: owner.id, name: owner.name } : null,
      progress: completion_percentage,
      task_count,
      completed_count,
      completion_percentage,
      star_count: p.starCount || 0,
    };
  }));

  return { plans: results, total, page, limit, total_pages: totalPages };
}

async function getPublicPlan(planId) {
  const plan = await repo.findById(planId);
  if (!plan || (plan.visibility !== 'public' && !plan.isPublic)) {
    throw new ServiceError('Plan not found', 404);
  }

  const [nodes, owner] = await Promise.all([
    repo.getNodeTree(planId),
    repo.findUserById(plan.ownerId),
  ]);

  return {
    ...snakePlan(plan),
    owner: owner ? { id: owner.id, name: owner.name } : null,
    nodes,
  };
}

// ── Visibility & Misc ──────────────────────────────────────

async function updatePlanVisibility(planId, userId, visibility) {
  if (!(await checkPlanAccess(planId, userId, ['owner']))) {
    throw new ServiceError('Only the plan owner can change visibility', 403);
  }

  const validValues = ['private', 'public', 'unlisted'];
  if (!validValues.includes(visibility)) {
    throw new ServiceError(`Invalid visibility. Valid: ${validValues.join(', ')}`, 400);
  }

  const plan = await repo.update(planId, {
    visibility, isPublic: visibility === 'public',
  });

  return snakePlan(plan);
}

async function incrementViewCount(planId) {
  await repo.incrementViewCount(planId);
}

async function linkGitHubRepo(planId, userId, { owner, repo: repoName, url }) {
  await requireAccess(planId, userId, ['owner', 'admin']);

  const plan = await repo.update(planId, {
    githubRepoOwner: owner || null,
    githubRepoName: repoName || null,
    githubRepoUrl: url || null,
    githubRepoFullName: owner && repoName ? `${owner}/${repoName}` : null,
  });

  return snakePlan(plan);
}

module.exports = {
  ServiceError,
  snakePlan,
  checkPlanAccess,
  calculatePlanProgress,
  listPlans,
  getPlan,
  createPlan,
  updatePlan,
  deletePlan,
  listCollaborators,
  addCollaborator,
  removeCollaborator,
  getPlanContext,
  getPlanProgress,
  listPublicPlans,
  getPublicPlan,
  updatePlanVisibility,
  incrementViewCount,
  linkGitHubRepo,
};
