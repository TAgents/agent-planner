/**
 * Plan Controller v2 — Thin HTTP layer
 *
 * Parses requests, delegates to plan.service, returns responses.
 * All business logic lives in src/domains/plan/services/plan.service.js
 */
const planService = require('../domains/plan/services/plan.service');

const listPlans = async (req, res, next) => {
  try {
    const statusFilter = req.query.status ? req.query.status.split(',') : undefined;
    const result = await planService.listPlans(req.user.id, req.user.organizationId || null, { statusFilter });
    res.json(result);
  } catch (error) {
    if (error instanceof planService.ServiceError) return res.status(error.statusCode).json({ error: error.message });
    next(error);
  }
};

const createPlan = async (req, res, next) => {
  try {
    const userName = req.user.name || req.user.email;
    const organizationId = req.body.organization_id || req.user.organizationId || null;
    const result = await planService.createPlan(req.user.id, userName, {
      title: req.body.title,
      description: req.body.description,
      status: req.body.status,
      visibility: req.body.visibility,
      metadata: req.body.metadata,
      organizationId,
    });
    res.status(201).json(result);
  } catch (error) {
    if (error instanceof planService.ServiceError) return res.status(error.statusCode).json({ error: error.message });
    next(error);
  }
};

const getPlan = async (req, res, next) => {
  try {
    const result = await planService.getPlan(req.params.id, req.user.id);
    res.json(result);
  } catch (error) {
    if (error instanceof planService.ServiceError) return res.status(error.statusCode).json({ error: error.message });
    next(error);
  }
};

const updatePlan = async (req, res, next) => {
  try {
    const userName = req.user.name || req.user.email;
    const result = await planService.updatePlan(req.params.id, req.user.id, userName, {
      title: req.body.title,
      description: req.body.description,
      status: req.body.status,
      metadata: req.body.metadata,
      qualityScore: req.body.quality_score,
      qualityAssessedAt: req.body.quality_assessed_at,
      qualityRationale: req.body.quality_rationale,
    });
    res.json(result);
  } catch (error) {
    if (error instanceof planService.ServiceError) return res.status(error.statusCode).json({ error: error.message });
    next(error);
  }
};

const deletePlan = async (req, res, next) => {
  try {
    const userName = req.user.name || req.user.email;
    await planService.deletePlan(req.params.id, req.user.id, userName);
    res.status(204).send();
  } catch (error) {
    if (error instanceof planService.ServiceError) return res.status(error.statusCode).json({ error: error.message });
    next(error);
  }
};

const listCollaborators = async (req, res, next) => {
  try {
    const result = await planService.listCollaborators(req.params.id, req.user.id);
    res.json(result);
  } catch (error) {
    if (error instanceof planService.ServiceError) return res.status(error.statusCode).json({ error: error.message });
    next(error);
  }
};

const addCollaborator = async (req, res, next) => {
  try {
    const result = await planService.addCollaborator(req.params.id, req.user.id, {
      targetUserId: req.body.user_id,
      email: req.body.email,
      role: req.body.role,
    });
    res.status(201).json(result);
  } catch (error) {
    if (error instanceof planService.ServiceError) return res.status(error.statusCode).json({ error: error.message });
    next(error);
  }
};

const removeCollaborator = async (req, res, next) => {
  try {
    await planService.removeCollaborator(req.params.id, req.user.id, req.params.userId);
    res.status(204).send();
  } catch (error) {
    if (error instanceof planService.ServiceError) return res.status(error.statusCode).json({ error: error.message });
    next(error);
  }
};

const getPlanContext = async (req, res, next) => {
  try {
    const result = await planService.getPlanContext(req.params.id, req.user.id);
    res.json(result);
  } catch (error) {
    if (error instanceof planService.ServiceError) return res.status(error.statusCode).json({ error: error.message });
    next(error);
  }
};

const getPlanProgress = async (req, res, next) => {
  try {
    const result = await planService.getPlanProgress(req.params.id, req.user.id);
    res.json(result);
  } catch (error) {
    if (error instanceof planService.ServiceError) return res.status(error.statusCode).json({ error: error.message });
    next(error);
  }
};

const listPublicPlans = async (req, res, next) => {
  try {
    const result = await planService.listPublicPlans({
      page: parseInt(req.query.page) || 1,
      limit: Math.min(parseInt(req.query.limit) || 12, 50),
      search: req.query.search || undefined,
      status: req.query.status || undefined,
      sortBy: req.query.sortBy || 'recent',
    });
    res.json(result);
  } catch (error) {
    if (error instanceof planService.ServiceError) return res.status(error.statusCode).json({ error: error.message });
    next(error);
  }
};

const getPublicPlan = async (req, res, next) => {
  try {
    const result = await planService.getPublicPlan(req.params.id);
    res.json(result);
  } catch (error) {
    if (error instanceof planService.ServiceError) return res.status(error.statusCode).json({ error: error.message });
    next(error);
  }
};

const getPublicPlanById = getPublicPlan;

const updatePlanVisibility = async (req, res, next) => {
  try {
    const result = await planService.updatePlanVisibility(req.params.id, req.user.id, req.body.visibility);
    res.json(result);
  } catch (error) {
    if (error instanceof planService.ServiceError) return res.status(error.statusCode).json({ error: error.message });
    next(error);
  }
};

const incrementViewCount = async (req, res, next) => {
  try {
    await planService.incrementViewCount(req.params.id);
    res.json({ success: true });
  } catch (error) { next(error); }
};

const linkGitHubRepo = async (req, res, next) => {
  try {
    const result = await planService.linkGitHubRepo(req.params.id, req.user.id, {
      owner: req.body.owner,
      repo: req.body.repo,
      url: req.body.url,
    });
    res.json(result);
  } catch (error) {
    if (error instanceof planService.ServiceError) return res.status(error.statusCode).json({ error: error.message });
    next(error);
  }
};

module.exports = {
  listPlans, createPlan, getPlan, updatePlan, deletePlan,
  listCollaborators, addCollaborator, removeCollaborator,
  getPlanContext, getPlanProgress,
  listPublicPlans, getPublicPlan, getPublicPlanById,
  updatePlanVisibility, incrementViewCount, linkGitHubRepo,
};
