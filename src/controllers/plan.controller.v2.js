/**
 * Plan Controller v2 — Uses DAL instead of Supabase
 */
const { v4: uuidv4 } = require('uuid');
const dal = require('../db/dal.cjs');
const { broadcastPlanUpdate, broadcastToAll } = require('../websocket/broadcast');
const {
  createPlanCreatedMessage,
  createPlanUpdatedMessage,
  createPlanDeletedMessage
} = require('../websocket/message-schema');

/** snake_case plan for API compat */
const snakePlan = (p) => ({
  id: p.id, title: p.title, description: p.description,
  owner_id: p.ownerId, status: p.status, visibility: p.visibility,
  is_public: p.isPublic, view_count: p.viewCount,
  github_repo_owner: p.githubRepoOwner, github_repo_name: p.githubRepoName,
  github_repo_url: p.githubRepoUrl, github_repo_full_name: p.githubRepoFullName,
  metadata: p.metadata,
  created_at: p.createdAt, updated_at: p.updatedAt,
  last_viewed_at: p.lastViewedAt,
});

const calculatePlanProgress = async (planId) => {
  const nodes = await dal.nodesDal.listByPlan(planId);
  if (!nodes.length) return 0;
  const completed = nodes.filter(n => n.status === 'completed').length;
  return Math.round((completed / nodes.length) * 100);
};

const checkPlanAccess = async (planId, userId, roles = []) => {
  const { hasAccess, role } = await dal.plansDal.userHasAccess(planId, userId);
  if (!hasAccess) return false;
  if (roles.length === 0) return true;
  return roles.includes(role);
};

const listPlans = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { owned, shared } = await dal.plansDal.listForUser(userId);

    const ownedResults = await Promise.all(owned.map(async (p) => ({
      ...snakePlan(p), role: 'owner',
      progress: await calculatePlanProgress(p.id),
    })));

    const sharedResults = await Promise.all(shared.map(async (p) => ({
      ...snakePlan(p), role: p.role,
      progress: await calculatePlanProgress(p.id),
    })));

    // Merge, deduplicate, sort
    const all = [...ownedResults, ...sharedResults];
    const unique = [...new Map(all.map(p => [p.id, p])).values()];
    unique.sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));

    res.json(unique);
  } catch (error) { next(error); }
};

const createPlan = async (req, res, next) => {
  try {
    const { title, description, status, visibility, metadata } = req.body;
    const userId = req.user.id;

    if (!title) return res.status(400).json({ error: 'Plan title is required' });

    const plan = await dal.plansDal.create({
      title, description: description || '',
      ownerId: userId, status: status || 'draft',
      visibility: visibility || 'private',
      metadata: metadata || {},
    });

    // Create root node
    await dal.nodesDal.create({
      planId: plan.id, nodeType: 'root',
      title: plan.title, status: 'not_started',
      description: plan.description || '',
    });

    const result = snakePlan(plan);

    const userName = req.user.name || req.user.email;
    const message = createPlanCreatedMessage(result, userId, userName);
    await broadcastToAll(message);

    res.status(201).json(result);
  } catch (error) { next(error); }
};

const getPlan = async (req, res, next) => {
  try {
    const { id: planId } = req.params;
    const userId = req.user.id;

    if (!(await checkPlanAccess(planId, userId))) {
      return res.status(403).json({ error: 'You do not have access to this plan' });
    }

    const plan = await dal.plansDal.findById(planId);
    if (!plan) return res.status(404).json({ error: 'Plan not found' });

    const progress = await calculatePlanProgress(planId);
    const owner = await dal.usersDal.findById(plan.ownerId);

    res.json({
      ...snakePlan(plan), progress,
      owner: owner ? { id: owner.id, name: owner.name, email: owner.email } : null,
    });
  } catch (error) { next(error); }
};

const updatePlan = async (req, res, next) => {
  try {
    const { id: planId } = req.params;
    const { title, description, status, metadata } = req.body;
    const userId = req.user.id;

    if (!(await checkPlanAccess(planId, userId, ['owner', 'admin', 'editor']))) {
      return res.status(403).json({ error: 'You do not have permission to update this plan' });
    }

    const updates = {};
    if (title !== undefined) updates.title = title;
    if (description !== undefined) updates.description = description;
    if (status !== undefined) updates.status = status;
    if (metadata !== undefined) updates.metadata = metadata;

    const plan = await dal.plansDal.update(planId, updates);
    if (!plan) return res.status(404).json({ error: 'Plan not found' });

    const result = snakePlan(plan);

    const userName = req.user.name || req.user.email;
    const message = createPlanUpdatedMessage(result, userId, userName);
    await broadcastPlanUpdate(planId, message);

    res.json(result);
  } catch (error) { next(error); }
};

const deletePlan = async (req, res, next) => {
  try {
    const { id: planId } = req.params;
    const userId = req.user.id;

    const plan = await dal.plansDal.findById(planId);
    if (!plan) return res.status(404).json({ error: 'Plan not found' });
    if (plan.ownerId !== userId) {
      return res.status(403).json({ error: 'Only the plan owner can delete it' });
    }

    await dal.plansDal.delete(planId);

    const userName = req.user.name || req.user.email;
    const message = createPlanDeletedMessage(planId, userId, userName);
    await broadcastToAll(message);

    res.status(204).send();
  } catch (error) { next(error); }
};

const listCollaborators = async (req, res, next) => {
  try {
    const { id: planId } = req.params;
    const userId = req.user.id;

    if (!(await checkPlanAccess(planId, userId))) {
      return res.status(403).json({ error: 'You do not have access to this plan' });
    }

    const collabs = await dal.collaboratorsDal.listByPlan(planId);
    const plan = await dal.plansDal.findById(planId);

    const result = collabs.map(c => ({
      id: c.id, plan_id: c.planId, user_id: c.userId,
      role: c.role, created_at: c.createdAt,
      user: { id: c.userId, name: c.userName, email: c.userEmail },
    }));

    // Add owner
    if (plan) {
      const owner = await dal.usersDal.findById(plan.ownerId);
      if (owner) {
        result.unshift({
          id: null, plan_id: planId, user_id: owner.id,
          role: 'owner', created_at: plan.createdAt,
          user: { id: owner.id, name: owner.name, email: owner.email },
        });
      }
    }

    res.json(result);
  } catch (error) { next(error); }
};

const addCollaborator = async (req, res, next) => {
  try {
    const { id: planId } = req.params;
    const { user_id: targetUserId, email, role } = req.body;
    const userId = req.user.id;

    if (!(await checkPlanAccess(planId, userId, ['owner', 'admin']))) {
      return res.status(403).json({ error: 'Only owners and admins can add collaborators' });
    }

    let resolvedUserId = targetUserId;
    if (!resolvedUserId && email) {
      const user = await dal.usersDal.findByEmail(email);
      if (user) resolvedUserId = user.id;
    }

    if (!resolvedUserId) {
      return res.status(404).json({ error: 'User not found' });
    }

    const collab = await dal.collaboratorsDal.add(planId, resolvedUserId, role || 'viewer');
    res.status(201).json(collab);
  } catch (error) { next(error); }
};

const removeCollaborator = async (req, res, next) => {
  try {
    const { id: planId, userId: targetUserId } = req.params;
    const userId = req.user.id;

    if (!(await checkPlanAccess(planId, userId, ['owner', 'admin']))) {
      return res.status(403).json({ error: 'Only owners and admins can remove collaborators' });
    }

    await dal.collaboratorsDal.remove(planId, targetUserId);
    res.status(204).send();
  } catch (error) { next(error); }
};

const getPlanContext = async (req, res, next) => {
  try {
    const { id: planId } = req.params;
    const userId = req.user.id;

    if (!(await checkPlanAccess(planId, userId))) {
      return res.status(403).json({ error: 'You do not have access to this plan' });
    }

    const [plan, nodes, collabs] = await Promise.all([
      dal.plansDal.findById(planId),
      dal.nodesDal.listByPlan(planId),
      dal.collaboratorsDal.listByPlan(planId),
    ]);

    const progress = nodes.length ? Math.round(nodes.filter(n => n.status === 'completed').length / nodes.length * 100) : 0;

    res.json({
      plan: plan ? { ...snakePlan(plan), progress } : null,
      nodes_count: nodes.length,
      collaborators_count: collabs.length,
    });
  } catch (error) { next(error); }
};

const getPlanProgress = async (req, res, next) => {
  try {
    const { id: planId } = req.params;
    const userId = req.user.id;

    if (!(await checkPlanAccess(planId, userId))) {
      return res.status(403).json({ error: 'You do not have access to this plan' });
    }

    const nodes = await dal.nodesDal.listByPlan(planId);
    const total = nodes.length;
    const byStatus = {};
    for (const n of nodes) {
      byStatus[n.status] = (byStatus[n.status] || 0) + 1;
    }

    res.json({
      total,
      completed: byStatus.completed || 0,
      in_progress: byStatus.in_progress || 0,
      not_started: byStatus.not_started || 0,
      blocked: byStatus.blocked || 0,
      progress_percentage: total ? Math.round(((byStatus.completed || 0) / total) * 100) : 0,
    });
  } catch (error) { next(error); }
};

const listPublicPlans = async (req, res, next) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = Math.min(parseInt(req.query.limit) || 12, 50);
    const search = req.query.search || undefined;
    const status = req.query.status || undefined;
    const sortBy = req.query.sortBy || 'recent';

    const allPlans = await dal.plansDal.listPublic();

    // Filter
    let filtered = allPlans;
    if (search) {
      const q = search.toLowerCase();
      filtered = filtered.filter(p => (p.title || '').toLowerCase().includes(q) || (p.description || '').toLowerCase().includes(q));
    }
    if (status) {
      filtered = filtered.filter(p => p.status === status);
    }

    // Sort
    if (sortBy === 'alphabetical') {
      filtered.sort((a, b) => (a.title || '').localeCompare(b.title || ''));
    } else if (sortBy === 'completion') {
      // default order is fine for now
    } else {
      filtered.sort((a, b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt));
    }

    const total = filtered.length;
    const totalPages = Math.ceil(total / limit);
    const offset = (page - 1) * limit;
    const paginated = filtered.slice(offset, offset + limit);

    const results = await Promise.all(paginated.map(async (p) => {
      const owner = await dal.usersDal.findById(p.ownerId);
      const nodes = await dal.nodesDal.listByPlan(p.id);
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

    res.json({
      plans: results,
      total,
      page,
      limit,
      total_pages: totalPages,
    });
  } catch (error) { next(error); }
};

const getPublicPlan = async (req, res, next) => {
  try {
    const { id: planId } = req.params;
    const plan = await dal.plansDal.findById(planId);
    if (!plan || (plan.visibility !== 'public' && !plan.isPublic)) {
      return res.status(404).json({ error: 'Plan not found' });
    }

    const [nodes, owner] = await Promise.all([
      dal.nodesDal.getTree(planId),
      dal.usersDal.findById(plan.ownerId),
    ]);

    res.json({
      ...snakePlan(plan),
      owner: owner ? { id: owner.id, name: owner.name } : null,
      nodes,
    });
  } catch (error) { next(error); }
};

const getPublicPlanById = getPublicPlan; // alias

const updatePlanVisibility = async (req, res, next) => {
  try {
    const { id: planId } = req.params;
    const { visibility } = req.body;
    const userId = req.user.id;

    if (!(await checkPlanAccess(planId, userId, ['owner']))) {
      return res.status(403).json({ error: 'Only the plan owner can change visibility' });
    }

    const validValues = ['private', 'public', 'unlisted'];
    if (!validValues.includes(visibility)) {
      return res.status(400).json({ error: `Invalid visibility. Valid: ${validValues.join(', ')}` });
    }

    const plan = await dal.plansDal.update(planId, {
      visibility, isPublic: visibility === 'public',
    });

    res.json(snakePlan(plan));
  } catch (error) { next(error); }
};

const incrementViewCount = async (req, res, next) => {
  try {
    const { id: planId } = req.params;
    await dal.plansDal.incrementViewCount(planId);
    res.json({ success: true });
  } catch (error) { next(error); }
};

const linkGitHubRepo = async (req, res, next) => {
  try {
    const { id: planId } = req.params;
    const { owner, repo, url } = req.body;
    const userId = req.user.id;

    if (!(await checkPlanAccess(planId, userId, ['owner', 'admin']))) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }

    const plan = await dal.plansDal.update(planId, {
      githubRepoOwner: owner || null,
      githubRepoName: repo || null,
      githubRepoUrl: url || null,
      githubRepoFullName: owner && repo ? `${owner}/${repo}` : null,
    });

    res.json(snakePlan(plan));
  } catch (error) { next(error); }
};

module.exports = {
  listPlans, createPlan, getPlan, updatePlan, deletePlan,
  listCollaborators, addCollaborator, removeCollaborator,
  getPlanContext, getPlanProgress, checkPlanAccess,
  listPublicPlans, getPublicPlan, getPublicPlanById,
  updatePlanVisibility, incrementViewCount, linkGitHubRepo,
};
