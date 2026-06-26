const { plansDal, searchDal, collaboratorsDal } = require('../db/dal.cjs');

// searchNodes removed (API v1 consolidation Phase 5 — its route
// /search/plans/:id/nodes/search had no consumers).

/**
 * Search for artifacts (deprecated - returns empty array)
 */
const searchArtifacts = async (_req, res, _next) => {
  res.json([]);
};

/**
 * Search across all resources (plans, nodes, comments, logs)
 */
const globalSearch = async (req, res, next) => {
  try {
    const { query } = req.query;
    const userId = req.user.id;

    if (!query || query.trim().length < 3) {
      return res.status(400).json({ error: 'Search query must be at least 3 characters' });
    }

    // Get all plan IDs user has access to
    const ownedPlans = await plansDal.listByOwner(userId);
    const collabPlanIds = await collaboratorsDal.listPlanIdsForUser(userId);

    const allPlanIds = [
      ...ownedPlans.map(p => p.id),
      ...collabPlanIds
    ];

    // Search each accessible plan
    const allResults = [];
    for (const planId of allPlanIds) {
      try {
        const results = await searchDal.searchPlan(planId, query);
        allResults.push(...results.map(r => ({ ...r, planId })));
      } catch (e) {
        // Skip plans with search errors
      }
    }

    // Categorize results. Plan title/description match is tokenized (all query
    // words must appear), consistent with searchDal — a single whole-phrase
    // includes() matched almost nothing for multi-word queries.
    const ql = query.toLowerCase().trim();
    const tokens = ql.split(/\s+/).filter(t => t.length >= 2);
    const planMatches = (p) => {
      const hay = `${p.title || ''} ${p.description || ''}`.toLowerCase();
      return tokens.length ? tokens.every(t => hay.includes(t)) : hay.includes(ql);
    };
    const plans = ownedPlans
      .filter(planMatches)
      .map(p => ({ id: p.id, type: 'plan', title: p.title, description: p.description, status: p.status, created_at: p.createdAt }));

    const nodes = allResults.filter(r => r.type === 'node');
    const comments = allResults.filter(r => r.type === 'comment');
    const logs = allResults.filter(r => r.type === 'log');

    res.json({
      query,
      results: { plans, nodes, comments, logs },
      counts: {
        plans: plans.length,
        nodes: nodes.length,
        comments: comments.length,
        logs: logs.length,
        total: plans.length + nodes.length + comments.length + logs.length
      }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Search within a plan using the DAL search function
 */
const searchPlan = async (req, res, next) => {
  try {
    const { plan_id: planId } = req.params;
    const { query } = req.query;
    const userId = req.user.id;

    if (!query || query.trim().length < 2) {
      return res.status(400).json({ error: 'Search query must be at least 2 characters' });
    }

    const { hasAccess } = await plansDal.userHasAccess(planId, userId);
    if (!hasAccess) {
      return res.status(403).json({ error: 'You do not have access to this plan' });
    }

    const searchResults = await searchDal.searchPlan(planId, query);

    res.json({
      query,
      results: searchResults,
      count: searchResults.length
    });
  } catch (error) {
    console.error('Error in searchPlan:', error);
    next(error);
  }
};

module.exports = {
  searchArtifacts,
  globalSearch,
  searchPlan
};
