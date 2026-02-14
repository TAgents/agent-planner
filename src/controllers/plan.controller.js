const { v4: uuidv4 } = require('uuid');
const { plansDal, nodesDal, collaboratorsDal, usersDal } = require('../db/dal.cjs');
const { broadcastPlanUpdate, broadcastToAll } = require('../websocket/broadcast');
const {
  createPlanCreatedMessage,
  createPlanUpdatedMessage,
  createPlanDeletedMessage
} = require('../websocket/message-schema');

/**
 * Calculate progress percentage for a plan based on node completion
 */
const calculatePlanProgress = async (planId) => {
  try {
    const nodes = await nodesDal.listByPlan(planId);
    if (!nodes || nodes.length === 0) return 0;
    const completedNodes = nodes.filter(node => node.status === 'completed').length;
    return Math.round((completedNodes / nodes.length) * 100);
  } catch (error) {
    return 0;
  }
};

/**
 * List all plans accessible to the user
 */
const listPlans = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { owned: ownedPlans, shared: sharedPlans } = await plansDal.listForUser(userId);

    const ownedWithRole = ownedPlans.map(plan => ({ ...plan, role: 'owner' }));
    const allPlans = [...ownedWithRole, ...sharedPlans];

    const plansWithProgress = await Promise.all(
      allPlans.map(async (plan) => {
        const progress = await calculatePlanProgress(plan.id);
        return { ...plan, progress };
      })
    );

    res.json(plansWithProgress);
  } catch (error) {
    next(error);
  }
};

/**
 * Create a new plan
 */
const createPlan = async (req, res, next) => {
  try {
    const { title, description, status, metadata, organization_id } = req.body;
    const userId = req.user.id;

    if (!title) return res.status(400).json({ error: 'Title is required' });

    let validOrgId = null;
    if (organization_id) validOrgId = organization_id;

    const planId = uuidv4();
    const now = new Date();

    const newPlan = await plansDal.create({
      id: planId,
      title,
      description: description || '',
      ownerId: userId,
      createdAt: now,
      updatedAt: now,
      status: status || 'draft',
      metadata: metadata || {},
      organizationId: validOrgId,
    });

    await nodesDal.create({
      id: uuidv4(),
      planId,
      parentId: null,
      nodeType: 'root',
      title,
      description: description || '',
      status: 'not_started',
      orderIndex: 0,
      createdAt: now,
      updatedAt: now,
      context: description || '',
    });

    const planWithProgress = { ...newPlan, progress: 0 };

    const userName = req.user.name || req.user.email;
    const message = createPlanCreatedMessage(planWithProgress, req.user.id, userName);
    await broadcastToAll(message);

    res.status(201).json(planWithProgress);
  } catch (error) {
    next(error);
  }
};

/**
 * Get a specific plan with its root node
 */
const getPlan = async (req, res, next) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const hasAccess = await checkPlanAccess(id, userId);
    if (!hasAccess) return res.status(403).json({ error: 'You do not have access to this plan' });

    const plan = await plansDal.findById(id);
    if (!plan) return res.status(404).json({ error: 'Plan not found' });

    const rootNode = await nodesDal.getRoot(id);
    if (!rootNode) return res.status(500).json({ error: 'Root node not found for plan' });

    const progress = await calculatePlanProgress(id);

    res.json({
      ...plan,
      root_node: rootNode,
      is_owner: plan.ownerId === userId,
      visibility: plan.visibility || 'private',
      is_public: plan.isPublic || false,
      progress
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Update a plan's properties
 */
const updatePlan = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { title, description, status, metadata, organization_id } = req.body;
    const userId = req.user.id;

    const hasAccess = await checkPlanAccess(id, userId, ['owner', 'admin']);
    if (!hasAccess) return res.status(403).json({ error: 'You do not have permission to update this plan' });

    const updates = { updatedAt: new Date() };
    if (title !== undefined) updates.title = title;
    if (description !== undefined) updates.description = description;
    if (status !== undefined) updates.status = status;
    if (metadata !== undefined) updates.metadata = metadata;
    if (organization_id !== undefined) updates.organizationId = organization_id === null ? null : organization_id;

    const updatedPlan = await plansDal.update(id, updates);
    if (!updatedPlan) return res.status(404).json({ error: 'Plan not found' });

    // Update root node if title/description changed
    if (title !== undefined || description !== undefined) {
      const rootNode = await nodesDal.getRoot(id);
      if (rootNode) {
        const nodeUpdates = { updatedAt: new Date() };
        if (title !== undefined) nodeUpdates.title = title;
        if (description !== undefined) {
          nodeUpdates.description = description;
          nodeUpdates.context = description;
        }
        await nodesDal.update(rootNode.id, nodeUpdates);
      }
    }

    const progress = await calculatePlanProgress(id);
    updatedPlan.progress = progress;

    const userName = req.user.name || req.user.email;
    const message = createPlanUpdatedMessage(updatedPlan, req.user.id, userName);
    await broadcastPlanUpdate(id, message);

    res.json(updatedPlan);
  } catch (error) {
    next(error);
  }
};

/**
 * Delete a plan (or archive it)
 */
const deletePlan = async (req, res, next) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    const { archive } = req.query;

    const plan = await plansDal.findById(id);
    if (!plan) return res.status(404).json({ error: 'Plan not found' });
    if (plan.ownerId !== userId) return res.status(403).json({ error: 'Only the plan owner can delete this plan' });

    if (archive === 'true') {
      const archivedPlan = await plansDal.update(id, { status: 'archived', updatedAt: new Date() });
      if (archivedPlan) {
        const userName = req.user.name || req.user.email;
        const message = createPlanUpdatedMessage(archivedPlan, userId, userName);
        await broadcastPlanUpdate(id, message);
      }
      return res.status(200).json({ message: 'Plan archived successfully' });
    }

    await collaboratorsDal.deleteByPlan(id);
    await plansDal.delete(id);

    const userName = req.user.name || req.user.email;
    const message = createPlanDeletedMessage(id, userId, userName);
    await broadcastToAll(message);

    res.status(204).send();
  } catch (error) {
    next(error);
  }
};

/**
 * List collaborators on a plan
 */
const listCollaborators = async (req, res, next) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const hasAccess = await checkPlanAccess(id, userId);
    if (!hasAccess) return res.status(403).json({ error: 'You do not have access to this plan' });

    const collabs = await collaboratorsDal.listByPlan(id);
    const plan = await plansDal.findById(id);
    if (!plan) return res.status(404).json({ error: 'Plan not found' });

    const owner = await usersDal.findById(plan.ownerId);

    const collaborators = collabs.map((collab) => ({
      id: collab.id,
      user: { id: collab.userId, name: collab.userName, email: collab.userEmail },
      role: collab.role,
      created_at: collab.createdAt,
    }));

    res.json({
      owner: owner ? { id: owner.id, name: owner.name, email: owner.email } : { id: plan.ownerId },
      collaborators,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Add a collaborator to a plan
 */
const addCollaborator = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { user_id, email, role } = req.body;
    const userId = req.user.id;

    if (!user_id && !email) return res.status(400).json({ error: 'Either user_id or email is required' });
    if (!role) return res.status(400).json({ error: 'Role is required' });

    const hasAccess = await checkPlanAccess(id, userId, ['owner', 'admin']);
    if (!hasAccess) return res.status(403).json({ error: 'You do not have permission to add collaborators' });

    let targetUserId = user_id;
    if (!targetUserId && email) {
      const user = await usersDal.findByEmail(email);
      if (!user) return res.status(404).json({ error: 'User not found with this email' });
      targetUserId = user.id;
    }

    const existing = await collaboratorsDal.findByPlanAndUser(id, targetUserId);
    if (existing) {
      const updated = await collaboratorsDal.update(existing.id, { role });
      return res.json(updated);
    }

    const newCollab = await collaboratorsDal.create({
      id: uuidv4(),
      planId: id,
      userId: targetUserId,
      role,
      createdAt: new Date(),
    });

    res.status(201).json(newCollab);
  } catch (error) {
    next(error);
  }
};

/**
 * Remove a collaborator from a plan
 */
const removeCollaborator = async (req, res, next) => {
  try {
    const { id, userId: collaboratorId } = req.params;
    const currentUserId = req.user.id;

    const hasAccess = await checkPlanAccess(id, currentUserId, ['owner', 'admin']);
    const isSelf = currentUserId === collaboratorId;

    if (!hasAccess && !isSelf) {
      return res.status(403).json({ error: 'You do not have permission to remove collaborators' });
    }

    await collaboratorsDal.deleteByPlanAndUser(id, collaboratorId);
    res.status(204).send();
  } catch (error) {
    next(error);
  }
};

/**
 * Get a compiled context of the entire plan suitable for agents
 */
const getPlanContext = async (req, res, next) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const hasAccess = await checkPlanAccess(id, userId);
    if (!hasAccess) return res.status(403).json({ error: 'You do not have access to this plan' });

    const plan = await plansDal.findById(id);
    if (!plan) return res.status(404).json({ error: 'Plan not found' });

    const nodes = await nodesDal.listByPlan(id);

    const rootNode = nodes.find(node => node.nodeType === 'root');
    if (!rootNode) return res.status(500).json({ error: 'Plan structure is invalid (no root node)' });

    // Build hierarchy
    const nodeMap = {};
    nodes.forEach(node => { nodeMap[node.id] = { ...node, children: [] }; });
    nodes.forEach(node => {
      if (node.parentId && nodeMap[node.parentId]) {
        nodeMap[node.parentId].children.push(nodeMap[node.id]);
      }
    });

    const progress = await calculatePlanProgress(id);

    res.json({
      plan: {
        id: plan.id,
        title: plan.title,
        description: plan.description,
        status: plan.status,
        created_at: plan.createdAt,
        updated_at: plan.updatedAt,
        metadata: plan.metadata,
        github_repo_owner: plan.githubRepoOwner,
        github_repo_name: plan.githubRepoName,
        github_repo_url: plan.githubRepoUrl,
        github_repo_full_name: plan.githubRepoFullName,
        progress,
      },
      structure: nodeMap[rootNode.id],
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get plan progress
 */
const getPlanProgress = async (req, res, next) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const hasAccess = await checkPlanAccess(id, userId);
    if (!hasAccess) return res.status(403).json({ error: 'You do not have access to this plan' });

    const nodes = await nodesDal.listByPlan(id);
    const totalNodes = nodes.length;
    const completedNodes = nodes.filter(n => n.status === 'completed').length;
    const progress = totalNodes > 0 ? Math.round((completedNodes / totalNodes) * 100) : 0;

    res.json({
      progress,
      total_nodes: totalNodes,
      completed_nodes: completedNodes,
      in_progress_nodes: nodes.filter(n => n.status === 'in_progress').length,
      not_started_nodes: nodes.filter(n => n.status === 'not_started').length,
      blocked_nodes: nodes.filter(n => n.status === 'blocked').length,
      completion_percentage: progress,
      totalNodes,
      completedNodes,
      inProgress: nodes.filter(n => n.status === 'in_progress').length,
      notStarted: nodes.filter(n => n.status === 'not_started').length,
      blocked: nodes.filter(n => n.status === 'blocked').length
    });
  } catch (error) {
    console.error('Error calculating plan progress:', error);
    res.status(500).json({ error: 'Failed to calculate progress' });
  }
};

/**
 * Helper: check plan access
 */
const checkPlanAccess = async (planId, userId, roles = []) => {
  try {
    const { hasAccess, role } = await plansDal.userHasAccess(planId, userId);
    if (!hasAccess) return false;
    if (roles.length > 0) return roles.includes(role);
    return true;
  } catch (error) {
    return false;
  }
};

/**
 * List all public plans (no authentication required)
 */
const listPublicPlans = async (req, res, next) => {
  try {
    const {
      sortBy = 'recent',
      limit = 12,
      page = 1,
      status,
      hasGithubLink,
      owner,
      updatedAfter,
      updatedBefore,
      search
    } = req.query;

    const limitNum = Math.min(parseInt(limit) || 12, 100);
    const pageNum = Math.max(parseInt(page) || 1, 1);
    const offsetNum = (pageNum - 1) * limitNum;

    if (!['recent', 'alphabetical', 'completion'].includes(sortBy)) {
      return res.status(400).json({ error: 'Invalid sortBy value. Must be one of: recent, alphabetical, completion' });
    }
    if (status && !['active', 'completed', 'draft', 'archived'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status value. Must be one of: active, completed, draft, archived' });
    }
    if (hasGithubLink && !['true', 'false'].includes(hasGithubLink)) {
      return res.status(400).json({ error: 'Invalid hasGithubLink value. Must be "true" or "false"' });
    }
    if (updatedAfter && isNaN(new Date(updatedAfter).getTime())) {
      return res.status(400).json({ error: 'Invalid updatedAfter value. Must be a valid ISO date string' });
    }
    if (updatedBefore && isNaN(new Date(updatedBefore).getTime())) {
      return res.status(400).json({ error: 'Invalid updatedBefore value. Must be a valid ISO date string' });
    }

    // For completion sort, fetch all then sort in memory
    const fetchLimit = sortBy === 'completion' ? 1000 : limitNum;
    const fetchOffset = sortBy === 'completion' ? 0 : offsetNum;

    const { data: plans, total: totalCount } = await plansDal.listPublicFiltered({
      sortBy, limit: fetchLimit, offset: fetchOffset, status, hasGithubLink, owner, updatedAfter, updatedBefore
    });

    // Enrich with owner info and stats
    let plansWithMetadata = await Promise.all(
      plans.map(async (plan) => {
        const ownerUser = await usersDal.findById(plan.ownerId);
        const nodes = await nodesDal.listByPlan(plan.id);
        const taskNodes = nodes.filter(n => n.nodeType !== 'root');
        const task_count = taskNodes.length;
        const completed_count = taskNodes.filter(n => n.status === 'completed').length;
        const completion_percentage = task_count > 0 ? Math.round((completed_count / task_count) * 100) : 0;

        // Star count not available in DAL yet — return 0
        return {
          id: plan.id,
          title: plan.title,
          description: plan.description,
          status: plan.status,
          view_count: plan.viewCount,
          created_at: plan.createdAt,
          updated_at: plan.updatedAt,
          github_repo_owner: plan.githubRepoOwner,
          github_repo_name: plan.githubRepoName,
          owner: ownerUser
            ? { id: ownerUser.id, name: ownerUser.name, email: ownerUser.email, github_username: ownerUser.githubUsername, avatar_url: ownerUser.avatarUrl }
            : { id: plan.ownerId, name: 'Unknown', email: '', github_username: null, avatar_url: null },
          task_count,
          completed_count,
          completion_percentage,
          star_count: 0,
        };
      })
    );

    // Apply search filter
    if (search && search.trim()) {
      const searchLower = search.trim().toLowerCase();
      plansWithMetadata = plansWithMetadata.filter(plan => {
        return (plan.title && plan.title.toLowerCase().includes(searchLower))
          || (plan.description && plan.description.toLowerCase().includes(searchLower))
          || (plan.owner.github_username && plan.owner.github_username.toLowerCase().includes(searchLower))
          || (plan.owner.name && plan.owner.name.toLowerCase().includes(searchLower));
      });
    }

    let finalPlans = plansWithMetadata;
    let finalTotal = totalCount;

    if (sortBy === 'completion') {
      finalPlans.sort((a, b) => b.completion_percentage - a.completion_percentage);
      finalTotal = finalPlans.length;
      finalPlans = finalPlans.slice(offsetNum, offsetNum + limitNum);
    } else if (search && search.trim()) {
      finalTotal = finalPlans.length;
      finalPlans = finalPlans.slice(offsetNum, offsetNum + limitNum);
    }

    res.json({
      plans: finalPlans,
      total: finalTotal,
      limit: limitNum,
      page: pageNum,
      total_pages: finalTotal ? Math.ceil(finalTotal / limitNum) : 0
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get a public plan (no authentication required)
 */
const getPublicPlan = async (req, res, next) => {
  try {
    const { id } = req.params;

    const plan = await plansDal.findById(id);
    if (!plan) return res.status(404).json({ error: 'Plan not found' });
    if (plan.visibility !== 'public') return res.status(403).json({ error: 'This plan is not public' });

    const rootNode = await nodesDal.getRoot(id);
    if (!rootNode) return res.status(500).json({ error: 'Root node not found' });

    const owner = await usersDal.findById(plan.ownerId);
    const progress = await calculatePlanProgress(id);

    res.json({
      id: plan.id,
      title: plan.title,
      description: plan.description,
      status: plan.status,
      view_count: plan.viewCount,
      created_at: plan.createdAt,
      updated_at: plan.updatedAt,
      github_repo_owner: plan.githubRepoOwner,
      github_repo_name: plan.githubRepoName,
      github_repo_url: plan.githubRepoUrl,
      github_repo_full_name: plan.githubRepoFullName,
      metadata: plan.metadata,
      owner: owner
        ? { id: owner.id, name: owner.name, email: owner.email, github_username: owner.githubUsername, avatar_url: owner.avatarUrl }
        : { id: plan.ownerId, name: 'Unknown', email: '', github_username: null, avatar_url: null },
      root_node: rootNode,
      progress
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get a public plan with full node hierarchy (no authentication required)
 */
const getPublicPlanById = async (req, res, next) => {
  try {
    const { id } = req.params;

    const plan = await plansDal.findById(id);
    if (!plan) return res.status(404).json({ error: 'Plan not found' });
    if (plan.visibility !== 'public') return res.status(404).json({ error: 'Plan not found' });

    const nodes = await nodesDal.listByPlan(id);
    const rootNode = nodes.find(node => node.nodeType === 'root');
    if (!rootNode) return res.status(500).json({ error: 'Plan structure is invalid (no root node)' });

    const nodeMap = {};
    nodes.forEach(node => { nodeMap[node.id] = { ...node, children: [] }; });
    nodes.forEach(node => {
      if (node.parentId && nodeMap[node.parentId]) {
        nodeMap[node.parentId].children.push(nodeMap[node.id]);
      }
    });

    const owner = await usersDal.findById(plan.ownerId);
    const progress = await calculatePlanProgress(id);

    res.json({
      plan: {
        id: plan.id,
        title: plan.title,
        description: plan.description,
        status: plan.status,
        view_count: plan.viewCount,
        created_at: plan.createdAt,
        updated_at: plan.updatedAt,
        github_repo_owner: plan.githubRepoOwner,
        github_repo_name: plan.githubRepoName,
        github_repo_url: plan.githubRepoUrl,
        github_repo_full_name: plan.githubRepoFullName,
        metadata: plan.metadata,
        progress,
        owner: owner
          ? { id: owner.id, name: owner.name, email: owner.email, github_username: owner.githubUsername, avatar_url: owner.avatarUrl }
          : { id: plan.ownerId, name: 'Unknown', email: '', github_username: null, avatar_url: null }
      },
      structure: nodeMap[rootNode.id],
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Update plan visibility settings (public/private)
 */
const updatePlanVisibility = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { visibility, github_repo_owner, github_repo_name } = req.body;
    const userId = req.user.id;

    let visibilityValue = visibility;
    if (visibility === undefined && req.body.is_public !== undefined) {
      visibilityValue = req.body.is_public ? 'public' : 'private';
    }

    if (!visibilityValue) return res.status(400).json({ error: 'visibility field is required (or is_public for backward compatibility)' });
    if (!['public', 'private'].includes(visibilityValue)) return res.status(400).json({ error: 'visibility must be either "public" or "private"' });

    const plan = await plansDal.findById(id);
    if (!plan) return res.status(404).json({ error: 'Plan not found' });
    if (plan.ownerId !== userId) return res.status(403).json({ error: 'Only the plan owner can change visibility settings' });

    const updates = {
      visibility: visibilityValue,
      isPublic: visibilityValue === 'public',
      updatedAt: new Date()
    };
    if (github_repo_owner !== undefined) updates.githubRepoOwner = github_repo_owner || null;
    if (github_repo_name !== undefined) updates.githubRepoName = github_repo_name || null;

    const updatedPlan = await plansDal.update(id, updates);
    if (!updatedPlan) return res.status(404).json({ error: 'Plan not found' });

    res.json({
      id: updatedPlan.id,
      visibility: updatedPlan.visibility,
      is_public: updatedPlan.isPublic,
      github_repo_owner: updatedPlan.githubRepoOwner,
      github_repo_name: updatedPlan.githubRepoName,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Increment view count for a public plan
 */
const incrementViewCount = async (req, res, next) => {
  try {
    const { id } = req.params;

    const plan = await plansDal.findById(id);
    if (!plan) return res.status(404).json({ error: 'Plan not found' });
    if (plan.visibility !== 'public') return res.status(403).json({ error: 'This plan is not public' });

    await plansDal.incrementViewCount(id);
    res.json({ view_count: (plan.viewCount || 0) + 1 });
  } catch (error) {
    next(error);
  }
};

/**
 * Link a GitHub repository to a plan
 */
const linkGitHubRepo = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { github_repo_owner, github_repo_name } = req.body;
    const userId = req.user.id;

    if (!github_repo_owner || !github_repo_name) {
      return res.status(400).json({ error: 'github_repo_owner and github_repo_name are required' });
    }

    const repoRegex = /^[a-zA-Z0-9._-]+$/;
    if (!repoRegex.test(github_repo_owner) || !repoRegex.test(github_repo_name)) {
      return res.status(400).json({ error: 'Invalid repository owner or name format' });
    }

    const plan = await plansDal.findById(id);
    if (!plan) return res.status(404).json({ error: 'Plan not found' });
    if (plan.ownerId !== userId) return res.status(403).json({ error: 'Only plan owner can link repository' });

    const github_repo_full_name = `${github_repo_owner}/${github_repo_name}`;
    const github_repo_url = `https://github.com/${github_repo_full_name}`;

    const updated = await plansDal.update(id, {
      githubRepoOwner: github_repo_owner,
      githubRepoName: github_repo_name,
      githubRepoUrl: github_repo_url,
      githubRepoFullName: github_repo_full_name,
      updatedAt: new Date(),
    });

    res.json({ message: 'GitHub repository linked successfully', plan: updated });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  listPlans,
  createPlan,
  getPlan,
  updatePlan,
  deletePlan,
  listCollaborators,
  addCollaborator,
  removeCollaborator,
  getPlanContext,
  getPlanProgress,
  listPublicPlans,
  getPublicPlan,
  getPublicPlanById,
  updatePlanVisibility,
  incrementViewCount,
  linkGitHubRepo,
  calculatePlanProgress,
};
