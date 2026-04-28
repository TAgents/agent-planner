/**
 * Plan Repository — data access for the plan domain.
 *
 * Wraps DAL modules into a single domain-specific interface.
 * Service layer calls repository methods — never imports DAL directly.
 */
const dal = require('../../../db/dal.cjs');

// ── Plan queries ───────────────────────────────────────────

const findById = (planId) => dal.plansDal.findById(planId);
const create = (data) => dal.plansDal.create(data);
const update = (planId, updates) => dal.plansDal.update(planId, updates);
const deletePlan = (planId) => dal.plansDal.delete(planId);
const listForUser = (userId, opts) => dal.plansDal.listForUser(userId, opts);
const listPublic = () => dal.plansDal.listPublic();
const incrementViewCount = (planId) => dal.plansDal.incrementViewCount(planId);

// ── Node queries (used by plan service) ────────────────────

const listNodesByPlan = (planId) => dal.nodesDal.listByPlan(planId);
const createNode = (data) => dal.nodesDal.create(data);
const getNodeTree = (planId) => dal.nodesDal.getTree(planId);

// ── Collaborator queries ───────────────────────────────────

const listCollaborators = (planId) => dal.collaboratorsDal.listByPlan(planId);
const addCollaborator = (planId, userId, role) => dal.collaboratorsDal.add(planId, userId, role);
const removeCollaborator = (planId, userId) => dal.collaboratorsDal.remove(planId, userId);

// ── User lookups ───────────────────────────────────────────

const findUserById = (userId) => dal.usersDal.findById(userId);
const findUserByEmail = (email) => dal.usersDal.findByEmail(email);

// Bulk decorators used by Plans Index row ornaments
const listGoalTethersForPlanIds = (planIds) =>
  dal.goalsDal.listGoalTethersForPlanIds(planIds);
const latestLogTimestampsByPlanIds = (planIds) =>
  dal.logsDal.latestLogTimestampsByPlanIds(planIds);

module.exports = {
  // Plan CRUD
  findById,
  create,
  update,
  delete: deletePlan,
  listForUser,
  listPublic,
  incrementViewCount,
  // Nodes
  listNodesByPlan,
  createNode,
  getNodeTree,
  // Collaborators
  listCollaborators,
  addCollaborator,
  removeCollaborator,
  // Users
  findUserById,
  findUserByEmail,
  // Bulk decorators
  listGoalTethersForPlanIds,
  latestLogTimestampsByPlanIds,
};
