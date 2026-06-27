/**
 * Plan Service — business logic for the plan domain.
 *
 * All data access goes through plan.repository.js — never imports DAL directly.
 */
const repo = require('../repositories/plan.repository');
const planRollup = require('../../../services/planRollup.service');
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
  // v1.1 — Workspace + Blueprint provenance
  workspace_id: p.workspaceId ?? null,
  forked_from_blueprint_id: p.forkedFromBlueprintId ?? null,
  forked_at: p.forkedAt ?? null,
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

// Plan progress + stats are derived ONLY through the canonical planRollup
// service (work nodes = task+milestone; root/phases are structure). Do NOT
// reintroduce ad-hoc completed/total math here — that drift is the 68-vs-100
// bug. See docs/DERIVATIONS_AUDIT.md.

const calculatePlanProgress = async (planId) => {
  const nodes = await repo.listNodesByPlan(planId);
  return planRollup.rollupFromNodes(nodes).progress_pct;
};

/**
 * Legacy segmented-bar shape (total/done/doing/blocked/todo/percentage) for the
 * Plans Index, projected from the canonical rollup so it can never disagree with
 * `progress`. `todo` folds not_started + plan_ready.
 */
const statsFromRollup = (rollup) => {
  const c = rollup.status_counts;
  return {
    total: rollup.total_work,
    done: c.completed,
    doing: c.in_progress,
    blocked: c.blocked,
    todo: c.not_started + c.plan_ready,
    percentage: rollup.progress_pct,
  };
};

const computePlanStats = async (planId) => {
  const nodes = await repo.listNodesByPlan(planId);
  return statsFromRollup(planRollup.rollupFromNodes(nodes));
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

async function listPlans(userId, organizationId, { statusFilter, workspaceId } = {}) {
  const { owned, shared, organization = [] } = await repo.listForUser(userId, { organizationId, status: statusFilter, workspaceId });

  const all = [
    ...owned.map((p) => ({ ...snakePlan(p), role: 'owner' })),
    ...shared.map((p) => ({ ...snakePlan(p), role: p.role })),
    ...organization.map((p) => ({ ...snakePlan(p), role: p.role })),
  ];
  const unique = [...new Map(all.map(p => [p.id, p])).values()];

  // Bulk-decorate with the canonical rollup, goal tether, and agent-active
  // timestamps in three batch queries — no per-plan N+1. `progress` + `stats`
  // are projected from `rollup` so every plan row is internally consistent.
  const planIds = unique.map(p => p.id);
  const [rollups, goalRows, logRows] = await Promise.all([
    planRollup.computePlanRollups(planIds),
    repo.listGoalTethersForPlanIds(planIds),
    repo.latestLogTimestampsByPlanIds(planIds),
  ]);
  for (const p of unique) {
    const r = rollups.get(p.id) || planRollup.rollupFromNodes([]);
    p.rollup = r;
    p.progress = r.progress_pct;
    p.stats = statsFromRollup(r);
  }
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
  const rollup = await planRollup.computePlanRollup(planId, { withCriticalPath: true });
  const owner = await repo.findUserById(plan.ownerId);

  return {
    ...snakePlan(plan), rollup, progress: rollup.progress_pct,
    owner: owner ? { id: owner.id, name: owner.name, email: owner.email } : null,
  };
}

// ── Create ─────────────────────────────────────────────────

async function createPlan(userId, userName, { title, description, status, visibility, metadata, organizationId, workspaceId }) {
  if (!title) throw new ServiceError('Plan title is required', 400);

  // Workspace-first invariant: if the caller didn't pin a workspace, drop the
  // plan into the org's default workspace. workspace_id is NOT NULL since
  // migration 0021, so fall back to the user's own default workspace as a
  // last resort and reject only when no workspace exists at all.
  let resolvedWorkspaceId = workspaceId || null;
  let resolvedOrganizationId = organizationId || null;
  if (!resolvedWorkspaceId && resolvedOrganizationId) {
    const defaultWs = await repo.findDefaultWorkspace(resolvedOrganizationId);
    if (defaultWs) resolvedWorkspaceId = defaultWs.id;
  }
  if (!resolvedWorkspaceId) {
    const fallback = await repo.findFallbackWorkspaceForUser(userId);
    if (fallback) {
      resolvedWorkspaceId = fallback.workspace.id;
      resolvedOrganizationId = resolvedOrganizationId || fallback.organizationId;
    }
  }
  if (!resolvedWorkspaceId) {
    throw new ServiceError('No workspace available — provide workspace_id', 400);
  }

  const plan = await repo.create({
    title, description: description || '',
    ownerId: userId, status: status || 'draft',
    visibility: visibility || 'private',
    metadata: metadata || {},
    organizationId: resolvedOrganizationId,
    workspaceId: resolvedWorkspaceId,
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
  if (data.workspaceId !== undefined) updates.workspaceId = data.workspaceId;

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

  const rollup = planRollup.rollupFromNodes(nodes);

  return {
    plan: plan ? { ...snakePlan(plan), rollup, progress: rollup.progress_pct } : null,
    nodes_count: nodes.length,
    collaborators_count: collabs.length,
  };
}

async function getPlanProgress(planId, userId) {
  await requireAccess(planId, userId);

  const nodes = await repo.listNodesByPlan(planId);
  const rollup = planRollup.rollupFromNodes(nodes);
  const c = rollup.status_counts;

  // Legacy keys retained for back-compat, but every value comes from the
  // canonical rollup over work nodes — so this can't disagree with the list or
  // the detail view.
  return {
    total: rollup.total_work,
    completed: c.completed,
    in_progress: c.in_progress,
    not_started: c.not_started,
    blocked: c.blocked,
    progress_percentage: rollup.progress_pct,
    rollup,
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
    const rollup = planRollup.rollupFromNodes(nodes);
    return {
      ...snakePlan(p),
      owner: owner ? { id: owner.id, name: owner.name } : null,
      rollup,
      progress: rollup.progress_pct,
      task_count: rollup.total_work,
      completed_count: rollup.completed_work,
      completion_percentage: rollup.progress_pct,
      star_count: p.starCount || 0,
    };
  }));

  return { plans: results, total, page, limit, total_pages: totalPages };
}

// For link unfurls / share previews. Allows `unlisted` (anyone with the link
// can view) in addition to `public`; `private` and missing still 404 so a
// private plan's title/content never leaks into an unfurl. Lightweight shape —
// just what the OG meta needs.
async function getPlanForUnfurl(planId, { userId } = {}) {
  const plan = await repo.findById(planId);
  if (!plan) throw new ServiceError('Plan not found', 404);
  const publiclyShareable = plan.visibility === 'public' || plan.visibility === 'unlisted' || plan.isPublic;
  // Authorized viewers (owner / collaborator / org member) may preview any plan
  // they can access, including private ones — used when the preview request
  // carries a token. Anonymous callers (e.g. Slack's unfurl bot) only ever see
  // public/unlisted, so a private plan never leaks.
  const authorized = userId ? await checkPlanAccess(planId, userId) : false;
  if (!publiclyShareable && !authorized) throw new ServiceError('Plan not found', 404);

  const [nodes, owner] = await Promise.all([
    repo.getNodeTree(planId),
    repo.findUserById(plan.ownerId),
  ]);
  const countNodes = (ns) => (Array.isArray(ns) ? ns.reduce((acc, n) => acc + 1 + countNodes(n.children), 0) : 0);

  return {
    id: plan.id,
    title: plan.title,
    description: plan.description,
    nodes, // for the share-card (phases/progress)
    visibility: plan.visibility,
    owner: owner ? { name: owner.name } : null,
    node_count: countNodes(nodes),
  };
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

/**
 * Public knowledge digest for a published plan. Returns recent Graphiti
 * episodes that either (a) carry plan_id in metadata or (b) link to a node
 * in this plan via episode_node_links. No auth — only works on plans whose
 * visibility is `public`.
 */
async function getPublicPlanKnowledgeDigest(planId, { limit = 5 } = {}) {
  const plan = await repo.findById(planId);
  if (!plan || (plan.visibility !== 'public' && !plan.isPublic)) {
    throw new ServiceError('Plan not found', 404);
  }

  const graphitiBridge = require('../../../services/graphitiBridge');
  if (!graphitiBridge.isAvailable()) {
    return { episodes: [], available: false };
  }

  const groupId = graphitiBridge.orgGroupId(plan.organizationId);
  // Fetch a wider pool from Graphiti, then filter to plan-attributed ones.
  const result = await graphitiBridge.getEpisodes({ group_id: groupId, max_episodes: 50 });
  const all = Array.isArray(result?.episodes) ? result.episodes : Array.isArray(result) ? result : [];

  // Filter (a): episodes whose metadata.plan_id matches.
  const byMetadata = all.filter((e) => {
    const meta = e?.metadata || e?.source_metadata;
    return meta && (meta.plan_id === planId || meta.planId === planId);
  });

  // Filter (b): episodes linked to a node in this plan via episode_node_links.
  const dal = require('../../../db/dal.cjs');
  const episodeIds = all.map((e) => e.uuid).filter(Boolean);
  const links = episodeIds.length > 0
    ? await dal.episodeLinksDal.listByEpisodeIdsWithTitles(episodeIds)
    : [];
  const linkedEpisodeIds = new Set(
    links.filter((l) => l.plan_id === planId).map((l) => l.episode_id),
  );
  const byLink = all.filter((e) => linkedEpisodeIds.has(e.uuid));

  // Merge + dedupe + sort by created_at desc + cap.
  const seen = new Set();
  const merged = [...byMetadata, ...byLink]
    .filter((e) => {
      if (!e?.uuid || seen.has(e.uuid)) return false;
      seen.add(e.uuid);
      return true;
    })
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .slice(0, Math.min(Math.max(limit, 1), 20));

  return {
    available: true,
    episodes: merged.map((e) => ({
      uuid: e.uuid,
      name: e.name || null,
      content: e.content || '',
      created_at: e.created_at,
      source: e.source || null,
    })),
  };
}

// ── Visibility & Misc ──────────────────────────────────────

async function updatePlanVisibility(planId, userId, visibility) {
  if (!(await checkPlanAccess(planId, userId, ['owner']))) {
    throw new ServiceError('Only the plan owner can change visibility', 403);
  }

  // Canonical spelling is 'organization' (matches the org tables/columns);
  // accept the British 'organisation' as an alias so docs/UI spelling can't
  // reject a valid request.
  if (visibility === 'organisation') visibility = 'organization';
  const validValues = ['private', 'public', 'unlisted', 'organization'];
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
  getPlanForUnfurl,
  getPublicPlanKnowledgeDigest,
  updatePlanVisibility,
  incrementViewCount,
  linkGitHubRepo,
};
