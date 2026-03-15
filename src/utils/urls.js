/**
 * URL builder utility — constructs frontend URLs for tasks, plans, etc.
 * Uses APP_URL env var for the base domain.
 */

const APP_URL = (process.env.APP_URL || 'https://agentplanner.io').replace(/\/$/, '');

function planUrl(planId) {
  return `${APP_URL}/app/plans/${planId}`;
}

function taskUrl(planId, nodeId) {
  return `${APP_URL}/app/plans/${planId}?node=${nodeId}`;
}

function publicPlanUrl(planId) {
  return `${APP_URL}/public/plans/${planId}`;
}

module.exports = { planUrl, taskUrl, publicPlanUrl, APP_URL };
