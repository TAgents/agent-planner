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

/**
 * Render an Open Graph share-card SVG for a public plan.
 * Static, no auth, cacheable. 404s on private plans so titles never leak.
 */
const escapeXml = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&apos;');

const wrapText = (text, maxCharsPerLine, maxLines) => {
  const words = String(text || '').split(/\s+/).filter(Boolean);
  const lines = [];
  let current = '';
  for (const word of words) {
    if ((current + ' ' + word).trim().length <= maxCharsPerLine) {
      current = (current ? current + ' ' : '') + word;
    } else {
      if (current) lines.push(current);
      if (lines.length >= maxLines) break;
      current = word;
    }
  }
  if (current && lines.length < maxLines) lines.push(current);
  if (lines.length === maxLines && words.join(' ').length > lines.join(' ').length) {
    lines[lines.length - 1] = lines[lines.length - 1].replace(/\s+\S*$/, '') + '…';
  }
  return lines;
};

const getPublicPlanOgSvg = async (req, res, next) => {
  try {
    const plan = await planService.getPublicPlan(req.params.id);
    const titleLines = wrapText(plan.title, 32, 3);
    const ownerName = plan.owner?.name || 'AgentPlanner user';
    const nodeCount = Array.isArray(plan.nodes)
      ? plan.nodes.reduce(function count(acc, n) {
          return acc + 1 + (Array.isArray(n.children) ? n.children.reduce(count, 0) : 0);
        }, 0)
      : 0;

    const titleY = 200 + (3 - titleLines.length) * 40;
    const titleSvg = titleLines
      .map((line, i) => `<text x="80" y="${titleY + i * 76}" font-family="'Bricolage Grotesque', system-ui, sans-serif" font-size="64" font-weight="700" fill="#f5f1e9">${escapeXml(line)}</text>`)
      .join('\n');

    const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#0e0c0a"/>
      <stop offset="100%" stop-color="#1a1612"/>
    </linearGradient>
  </defs>
  <rect width="1200" height="630" fill="url(#bg)"/>
  <text x="80" y="100" font-family="'JetBrains Mono', monospace" font-size="20" font-weight="500" letter-spacing="3" fill="#9ca3af">◆ AGENTPLANNER</text>
  ${titleSvg}
  <text x="80" y="500" font-family="'Inter', system-ui, sans-serif" font-size="22" fill="#a1a1aa">by ${escapeXml(ownerName)}</text>
  <text x="80" y="540" font-family="'JetBrains Mono', monospace" font-size="18" letter-spacing="2" fill="#6b7280">${nodeCount} ${nodeCount === 1 ? 'NODE' : 'NODES'}</text>
  <text x="1120" y="580" font-family="'JetBrains Mono', monospace" font-size="16" letter-spacing="2" fill="#6b7280" text-anchor="end">agentplanner.io</text>
</svg>`;

    res.set('Content-Type', 'image/svg+xml; charset=utf-8');
    res.set('Cache-Control', 'public, max-age=600, s-maxage=3600');
    res.send(svg);
  } catch (error) {
    if (error instanceof planService.ServiceError && error.statusCode === 404) {
      res.status(404).set('Content-Type', 'image/svg+xml; charset=utf-8').send(
        '<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630"><rect width="1200" height="630" fill="#0e0c0a"/></svg>',
      );
      return;
    }
    next(error);
  }
};

const getPublicPlansSitemap = async (req, res, next) => {
  try {
    const result = await planService.listPublicPlans({ page: 1, limit: 50, sortBy: 'recent' });
    const plans = result.plans || result.data || [];
    const urls = plans.map((p) => {
      const raw = p.updatedAt || p.updated_at || new Date();
      const iso = (raw instanceof Date ? raw : new Date(raw)).toISOString();
      return `  <url>
    <loc>https://agentplanner.io/public/plans/${escapeXml(p.id)}</loc>
    <lastmod>${escapeXml(iso.slice(0, 10))}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.6</priority>
  </url>`;
    }).join('\n');
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>`;
    res.set('Content-Type', 'application/xml; charset=utf-8');
    res.set('Cache-Control', 'public, max-age=3600');
    res.send(xml);
  } catch (error) { next(error); }
};

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
  listPublicPlans, getPublicPlan, getPublicPlanById, getPublicPlanOgSvg, getPublicPlansSitemap,
  updatePlanVisibility, incrementViewCount, linkGitHubRepo,
};
