/**
 * Plan Access — shared helper for checking plan access.
 *
 * Centralised from duplicated definitions across controllers and routes.
 * Use `checkPlanAccess` as a helper function from services/controllers,
 * or `requirePlanAccess` as Express middleware on routes.
 */
const dal = require('../db/dal.cjs');

/**
 * Check if a user has access to a plan (optionally with specific roles).
 * @param {string} planId
 * @param {string} userId
 * @param {string[]} roles - If empty, any access is sufficient
 * @returns {Promise<boolean>}
 */
const checkPlanAccess = async (planId, userId, roles = []) => {
  const { hasAccess, role } = await dal.plansDal.userHasAccess(planId, userId);
  if (!hasAccess) return false;
  if (roles.length === 0) return true;
  return roles.includes(role);
};

/**
 * Express middleware factory — returns 403 if user lacks access.
 * @param {string[]} roles - Required roles (empty = any access)
 * @returns {Function} Express middleware
 */
const requirePlanAccess = (roles = []) => async (req, res, next) => {
  try {
    const planId = req.params.id || req.params.planId;
    const userId = req.user?.id;

    if (!planId || !userId) {
      return res.status(400).json({ error: 'Plan ID and authentication required' });
    }

    if (!(await checkPlanAccess(planId, userId, roles))) {
      return res.status(403).json({ error: 'You do not have access to this plan' });
    }

    next();
  } catch (error) {
    next(error);
  }
};

module.exports = { checkPlanAccess, requirePlanAccess };
