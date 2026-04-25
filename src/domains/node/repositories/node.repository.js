/**
 * Node Repository — data access for the node domain.
 *
 * Wraps DAL modules into a single domain-specific interface.
 * Service layer calls repository methods — never imports DAL directly.
 */
const dal = require('../../../db/dal.cjs');

// ── Node queries ───────────────────────────────────────────

const findById = (nodeId) => dal.nodesDal.findById(nodeId);
const listByPlan = (planId, filters) => dal.nodesDal.listByPlan(planId, filters);
const getRoot = (planId) => dal.nodesDal.getRoot(planId);
const getChildren = (parentId) => dal.nodesDal.getChildren(parentId);
const create = (data) => dal.nodesDal.create(data);
const update = (nodeId, updates) => dal.nodesDal.update(nodeId, updates);
const updateStatus = (nodeId, status) => dal.nodesDal.updateStatus(nodeId, status);
const deleteWithChildren = (nodeId) => dal.nodesDal.deleteWithChildren(nodeId);
const move = (nodeId, newParentId) => dal.nodesDal.move(nodeId, newParentId);
const reorder = (nodeId, newOrderIndex) => dal.nodesDal.reorder(nodeId, newOrderIndex);
const setAgentRequest = (nodeId, data) => dal.nodesDal.setAgentRequest(nodeId, data);
const clearAgentRequest = (nodeId) => dal.nodesDal.clearAgentRequest(nodeId);
const assignAgent = (nodeId, data) => dal.nodesDal.assignAgent(nodeId, data);

// ── Log queries ────────────────────────────────────────────

const createLog = (data) => dal.logsDal.create(data);
const listLogsByNode = (nodeId, opts) => dal.logsDal.listByNode(nodeId, opts);

// ── Cross-domain lookups (used by node service) ────────────

const findPlanById = (planId) => dal.plansDal.findById(planId);
const updatePlan = (planId, updates) => dal.plansDal.update(planId, updates);
const createDependency = (data) => dal.dependenciesDal.create(data);
const findUserById = (userId) => dal.usersDal.findById(userId);
const listUsers = (opts) => dal.usersDal.list(opts);

module.exports = {
  // Node CRUD
  findById,
  listByPlan,
  getRoot,
  getChildren,
  create,
  update,
  updateStatus,
  deleteWithChildren,
  move,
  reorder,
  setAgentRequest,
  clearAgentRequest,
  assignAgent,
  // Logs
  createLog,
  listLogsByNode,
  // Cross-domain
  findPlanById,
  updatePlan,
  createDependency,
  findUserById,
  listUsers,
};
