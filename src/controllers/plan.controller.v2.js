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
    const workspaceId = req.query.workspace_id || undefined;
    const result = await planService.listPlans(req.user.id, req.user.organizationId || null, { statusFilter, workspaceId });
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
      workspaceId: req.body.workspace_id || null,
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
      workspaceId: req.body.workspace_id === null ? null : (req.body.workspace_id || undefined),
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

const getPublicPlanKnowledgeDigest = async (req, res, next) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 5, 20);
    const result = await planService.getPublicPlanKnowledgeDigest(req.params.id, { limit });
    res.json(result);
  } catch (error) {
    if (error instanceof planService.ServiceError) return res.status(error.statusCode).json({ error: error.message });
    next(error);
  }
};

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

// Status → subway block colors for the share card.
const CARD_STATUS = {
  completed:   { fill: '#6cbf93', ink: '#0c0a09' },
  in_progress: { fill: '#e0a96d', ink: '#0c0a09' },
  blocked:     { fill: '#d98b7a', ink: '#0c0a09' },
  plan_ready:  { fill: '#caa9e0', ink: '#0c0a09' },
  not_started: { fill: 'none',    ink: '#8a8170', outline: '#3c352e' },
};

// Derive the card's data (top-level phases + their status, task progress) from
// the plan's node tree. Handles a [root]-wrapped tree or a flat top-level array.
function planCardData(plan) {
  const all = [];
  const walk = (ns) => (ns || []).forEach((n) => { all.push(n); if (n.children) walk(n.children); });
  walk(plan.nodes);
  const roots = plan.nodes || [];
  const topLevel = roots.length === 1 && roots[0].nodeType === 'root' ? (roots[0].children || []) : roots;
  // Prefer top-level phases; fall back to any phase nodes (so a flat plan that
  // nests phases still shows them).
  let phases = topLevel.filter((n) => n.nodeType === 'phase');
  if (!phases.length) phases = all.filter((n) => n.nodeType === 'phase');
  const tasks = all.filter((n) => n.nodeType === 'task' || n.nodeType === 'milestone');
  const doneTasks = tasks.filter((n) => n.status === 'completed').length;
  const donePhases = phases.filter((p) => p.status === 'completed').length;
  const pct = tasks.length
    ? Math.round((doneTasks / tasks.length) * 100)
    : (phases.length ? Math.round((donePhases / phases.length) * 100) : 0);
  const counts = { completed: 0, in_progress: 0, blocked: 0, plan_ready: 0, not_started: 0 };
  for (const t of tasks) if (t.status in counts) counts[t.status] += 1;
  return { phases, donePhases, taskTotal: tasks.length, doneTasks, pct, counts };
}

function buildPlanCardSvg(plan) {
    const ownerName = plan.owner?.name || 'AgentPlanner user';
    const { phases: allPhases, donePhases, taskTotal, doneTasks, pct, counts } = planCardData(plan);
    const phases = allPhases.slice(0, 6);
    const hasPhases = phases.length > 0;
    const n = phases.length || 1;

    const M = 72, W = 1200, H = 630, innerW = W - M * 2;
    const DISPLAY = "'Bricolage Grotesque', 'Arial Black', 'Helvetica Neue', system-ui, sans-serif";
    const MONO = "'JetBrains Mono', ui-monospace, 'SFMono-Regular', monospace";

    const title = wrapText(plan.title, 23, 3);
    const titleSize = title.length >= 3 ? 50 : title.length === 2 ? 58 : 66;
    const titleLH = Math.round(titleSize * 1.16);
    const titleSvg = title
      .map((l, i) => `<text x="${M}" y="${188 + i * titleLH}" font-family="${DISPLAY}" font-size="${titleSize}" font-weight="800" letter-spacing="-1.5" fill="#f4eee2">${escapeXml(l)}</text>`)
      .join('\n');

    const barY = 430, barH = 14, barFill = Math.max((innerW * pct) / 100, pct > 0 ? barH : 0);
    const subY = 510, blockH = 46, gap = 12, bw = (innerW - gap * (n - 1)) / n;
    const subway = phases.map((p, i) => {
      const s = CARD_STATUS[p.status] || CARD_STATUS.not_started;
      const x = M + i * (bw + gap);
      const rect = s.fill !== 'none'
        ? `<rect x="${x}" y="${subY}" width="${bw}" height="${blockH}" rx="9" fill="${s.fill}"/>`
        : `<rect x="${x + 0.75}" y="${subY + 0.75}" width="${bw - 1.5}" height="${blockH - 1.5}" rx="9" fill="none" stroke="${s.outline}" stroke-width="1.5"/>`;
      const label = (p.title || `Phase ${i + 1}`).replace(/^Phase\s*\d+[,:]?\s*/i, '') || `P${i + 1}`;
      const max = Math.max(4, Math.floor(bw / 9));
      const short = label.length > max ? label.slice(0, max - 1) + '…' : label;
      return `${rect}
  <text x="${x + bw / 2}" y="${subY + blockH / 2 + 5}" text-anchor="middle" font-family="${MONO}" font-size="13" letter-spacing="0.5" fill="${s.ink}">${escapeXml(short)}</text>`;
    }).join('\n');

    // Flat plans (no phases): a status-breakdown chip row instead of the subway.
    let cx = M;
    const chips = [['completed', 'DONE'], ['in_progress', 'ACTIVE'], ['blocked', 'BLOCKED'], ['plan_ready', 'REVIEW'], ['not_started', 'TODO']]
      .filter(([k]) => counts[k] > 0)
      .map(([k, lbl]) => {
        const s = CARD_STATUS[k] || CARD_STATUS.not_started;
        const dot = s.fill !== 'none' ? s.fill : (s.outline || '#3c352e');
        const text = `${counts[k]} ${lbl}`;
        const w = 40 + text.length * 9.5;
        const chip = `<rect x="${cx}" y="${subY}" width="${w}" height="${blockH}" rx="9" fill="#19140f" stroke="#2a2420" stroke-width="1"/>
  <circle cx="${cx + 19}" cy="${subY + blockH / 2}" r="5" fill="${dot}"/>
  <text x="${cx + 33}" y="${subY + blockH / 2 + 5}" font-family="${MONO}" font-size="14" letter-spacing="0.5" fill="#cfc6b6">${escapeXml(text)}</text>`;
        cx += w + gap;
        return chip;
      }).join('\n');
    const band = hasPhases ? subway : chips;

    const grid = Array.from({ length: 30 }, (_, i) => i * 40)
      .map((v) => `<line x1="${v}" y1="0" x2="${v}" y2="${H}" stroke="#fff" stroke-opacity="0.018"/><line x1="0" y1="${v}" x2="${W}" y2="${v}" stroke="#fff" stroke-opacity="0.018"/>`)
      .join('');

    const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#100d0b"/><stop offset="55%" stop-color="#0c0a09"/><stop offset="100%" stop-color="#181311"/></linearGradient>
    <radialGradient id="glow" cx="14%" cy="8%" r="55%"><stop offset="0%" stop-color="#e0a96d" stop-opacity="0.10"/><stop offset="100%" stop-color="#e0a96d" stop-opacity="0"/></radialGradient>
    <linearGradient id="amber" x1="0" y1="0" x2="1" y2="0"><stop offset="0%" stop-color="#c98a4e"/><stop offset="100%" stop-color="#f0c187"/></linearGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#bg)"/>
  <rect width="${W}" height="${H}" fill="url(#glow)"/>
  ${grid}
  <g stroke="#e0a96d" stroke-opacity="0.5" stroke-width="2"><path d="M40 40 h22 M40 40 v22"/><path d="M1160 40 h-22 M1160 40 v22"/><path d="M40 590 h22 M40 590 v-22"/><path d="M1160 590 h-22 M1160 590 v-22"/></g>
  <text x="${M}" y="100" font-family="${MONO}" font-size="21" font-weight="500" letter-spacing="5" fill="#e0a96d">◆ AGENTPLANNER</text>
  <text x="${W - M}" y="100" text-anchor="end" font-family="${MONO}" font-size="15" letter-spacing="3" fill="#6f675b">PLAN · ${hasPhases ? `${donePhases}/${allPhases.length} PHASES` : `${taskTotal} ${taskTotal === 1 ? 'TASK' : 'TASKS'}`}</text>
  <line x1="${M}" y1="122" x2="${W - M}" y2="122" stroke="#2a2420" stroke-width="1"/>
  ${titleSvg}
  <text x="${M}" y="${barY - 26}" font-family="${MONO}" font-size="16" letter-spacing="2" fill="#7a7264">PROGRESS</text>
  <text x="${W - M}" y="${barY - 24}" text-anchor="end" font-family="${DISPLAY}" font-size="34" font-weight="800" fill="#e0a96d">${pct}<tspan font-family="${MONO}" font-size="16" font-weight="400" fill="#8a8170" dx="4">%</tspan></text>
  <rect x="${M}" y="${barY}" width="${innerW}" height="${barH}" rx="7" fill="#221d19"/>
  <rect x="${M}" y="${barY}" width="${barFill}" height="${barH}" rx="7" fill="url(#amber)"/>
  ${band}
  <text x="${M}" y="600" font-family="${MONO}" font-size="16" letter-spacing="1" fill="#8a8170">by ${escapeXml(ownerName)}${taskTotal ? `  ·  ${doneTasks}/${taskTotal} tasks` : ''}</text>
  <text x="${W - M}" y="600" text-anchor="end" font-family="${MONO}" font-size="15" letter-spacing="2" fill="#6f675b">agentplanner.io</text>
</svg>`;
  return svg;
}

// Rasterize the share-card SVG to PNG — Slack/Twitter don't render SVG og:image.
// Bundled fonts (assets/fonts) make the output identical in the font-less
// production container. Resvg is required lazily so startup never loads it.
let _Resvg;
function renderCardPng(svg) {
  const path = require('path');
  if (!_Resvg) _Resvg = require('@resvg/resvg-js').Resvg;
  const fontDir = path.join(__dirname, '..', '..', 'assets', 'fonts');
  return new _Resvg(svg, {
    fitTo: { mode: 'width', value: 1200 },
    font: {
      loadSystemFonts: false,
      defaultFontFamily: 'Bricolage Grotesque',
      fontFiles: [
        path.join(fontDir, 'BricolageGrotesque-ExtraBold.ttf'),
        path.join(fontDir, 'JetBrainsMono-Medium.ttf'),
      ],
    },
  }).render().asPng();
}

const getPublicPlanOgSvg = async (req, res, next) => {
  try {
    const svg = buildPlanCardSvg(await planService.getPlanForUnfurl(req.params.id));
    res.set('Content-Type', 'image/svg+xml; charset=utf-8');
    res.set('Cache-Control', 'public, max-age=600, s-maxage=3600');
    res.send(svg);
  } catch (error) {
    if (error instanceof planService.ServiceError && error.statusCode === 404) {
      return res.status(404).set('Content-Type', 'image/svg+xml; charset=utf-8').send(
        '<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630"><rect width="1200" height="630" fill="#0e0c0a"/></svg>',
      );
    }
    next(error);
  }
};

const getPublicPlanOgPng = async (req, res, next) => {
  try {
    const png = renderCardPng(buildPlanCardSvg(await planService.getPlanForUnfurl(req.params.id)));
    res.set('Content-Type', 'image/png');
    res.set('Cache-Control', 'public, max-age=600, s-maxage=3600');
    res.send(png);
  } catch (error) {
    if (error instanceof planService.ServiceError && error.statusCode === 404) {
      return res.status(404).end();
    }
    next(error);
  }
};

/**
 * Server-rendered OpenGraph/Twitter meta for a plan link, for unfurler bots
 * (Slack, Twitter, etc.) that don't run the SPA's JS. Unauthenticated and
 * VISIBILITY-SAFE: only public/unlisted plans expose a title/description; a
 * private or missing plan returns generic AgentPlanner meta so nothing leaks.
 * nginx routes crawler User-Agents on /app/plans/:id here; humans get the SPA.
 */
const escapeHtml = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const PUBLIC_URL = (process.env.PUBLIC_URL || process.env.FRONTEND_URL || 'https://agentplanner.io').replace(/\/$/, '');

function previewHtml({ title, description, url, image }) {
  const t = escapeHtml(title);
  const d = escapeHtml(description);
  const u = escapeHtml(url);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>${t}</title>
<meta name="description" content="${d}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="AgentPlanner">
<meta property="og:title" content="${t}">
<meta property="og:description" content="${d}">
<meta property="og:url" content="${u}">
${image ? `<meta property="og:image" content="${escapeHtml(image)}">` : ''}
<meta name="twitter:card" content="${image ? 'summary_large_image' : 'summary'}">
<meta name="twitter:title" content="${t}">
<meta name="twitter:description" content="${d}">
<meta http-equiv="refresh" content="0; url=${u}">
</head><body><p>Redirecting to <a href="${u}">${t}</a>…</p></body></html>`;
}

const getPlanPreviewMeta = async (req, res) => {
  const appUrl = `${PUBLIC_URL}/app/plans/${encodeURIComponent(req.params.id)}`;
  res.set('Content-Type', 'text/html; charset=utf-8');
  res.set('Cache-Control', 'public, max-age=300, s-maxage=900');
  try {
    // optionalAuthenticate may have set req.user — authorized viewers get the
    // real preview even for private plans; anonymous bots stay leak-safe.
    const plan = await planService.getPlanForUnfurl(req.params.id, { userId: req.user?.id });
    const nodeWord = plan.node_count === 1 ? 'node' : 'nodes';
    const desc = (plan.description && plan.description.trim())
      || `${plan.node_count} ${nodeWord}${plan.owner?.name ? ` · by ${plan.owner.name}` : ''} on AgentPlanner`;
    // The card image renders for public AND unlisted (anyone-with-link). Private
    // stays imageless — even an authorized private preview omits it, since the
    // og.png endpoint is anonymous (Slack can't auth) and would 404.
    const image = (plan.visibility === 'public' || plan.visibility === 'unlisted')
      ? `${PUBLIC_URL}/api/plans/public/${encodeURIComponent(req.params.id)}/og.png`
      : null;
    res.send(previewHtml({ title: plan.title || 'AgentPlanner plan', description: desc, url: appUrl, image }));
  } catch (error) {
    // Private / missing / any error → generic, leak-safe meta (no plan content).
    res.send(previewHtml({
      title: 'AgentPlanner',
      description: 'Agent-first planning — agents drive, humans steer.',
      url: appUrl,
      image: null,
    }));
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
  listPublicPlans, getPublicPlan, getPublicPlanById, getPublicPlanKnowledgeDigest, getPublicPlanOgSvg, getPublicPlanOgPng, getPublicPlansSitemap,
  getPlanPreviewMeta,
  updatePlanVisibility, incrementViewCount, linkGitHubRepo,
};
