/**
 * Admin routes — system-level stats and management.
 * All routes require authenticate + requireAdmin.
 */
const express = require('express');
const router = express.Router();
const { authenticate, requireAdmin } = require('../middleware/auth.middleware.v2');
const dal = require('../db/dal.cjs');
const graphitiBridge = require('../services/graphitiBridge');
const pkg = require('../../package.json');

/**
 * @swagger
 * /admin/stats:
 *   get:
 *     summary: Get system-wide statistics
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: System statistics
 *       403:
 *         description: Admin access required
 */
router.get('/stats', authenticate, requireAdmin, async (req, res) => {
  try {
    const sql = await dal.rawSql();

    const [stats] = await sql`
      SELECT
        (SELECT count(*) FROM users)::int AS total_users,
        (SELECT count(*) FROM users WHERE created_at > now() - interval '30 days')::int AS users_last_30d,
        (SELECT count(*) FROM plans)::int AS total_plans,
        (SELECT count(*) FROM plans WHERE created_at > now() - interval '30 days')::int AS plans_last_30d,
        (SELECT count(*) FROM plan_nodes)::int AS total_nodes,
        (SELECT count(*) FROM plan_nodes WHERE status = 'completed')::int AS completed_nodes,
        (SELECT count(*) FROM plan_collaborators)::int AS total_collaborators,
        (SELECT count(*) FROM organizations)::int AS total_organizations
    `;

    const topUsers = await sql`
      SELECT u.id, u.email, u.name, count(p.id)::int AS plan_count, u.created_at
      FROM users u
      LEFT JOIN plans p ON p.owner_id = u.id
      GROUP BY u.id, u.email, u.name, u.created_at
      ORDER BY plan_count DESC
      LIMIT 20
    `;

    const plansByVisibility = await sql`
      SELECT visibility, count(*)::int AS count
      FROM plans
      GROUP BY visibility
      ORDER BY count DESC
    `;

    res.json({
      counts: stats,
      users: topUsers,
      plans_by_visibility: plansByVisibility,
      generated_at: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Admin stats error:', error);
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

/**
 * @swagger
 * /admin/users:
 *   get:
 *     summary: List all users
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 50
 *       - in: query
 *         name: offset
 *         schema:
 *           type: integer
 *           default: 0
 *     responses:
 *       200:
 *         description: List of users
 *       403:
 *         description: Admin access required
 */
router.get('/users', authenticate, requireAdmin, async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    const offset = parseInt(req.query.offset) || 0;
    const sql = await dal.rawSql();

    const users = await sql`
      SELECT
        u.id, u.email, u.name, u.is_admin,
        u.github_username, u.created_at, u.updated_at,
        count(DISTINCT p.id)::int AS plan_count,
        count(DISTINCT pc.id)::int AS collaboration_count
      FROM users u
      LEFT JOIN plans p ON p.owner_id = u.id
      LEFT JOIN plan_collaborators pc ON pc.user_id = u.id
      GROUP BY u.id
      ORDER BY u.created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `;

    const [{ count }] = await sql`SELECT count(*)::int AS count FROM users`;

    res.json({
      users,
      total: count,
      limit,
      offset,
    });
  } catch (error) {
    console.error('Admin users error:', error);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

/**
 * @swagger
 * /admin/users/{userId}/admin:
 *   put:
 *     summary: Grant or revoke admin access
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               is_admin:
 *                 type: boolean
 *     responses:
 *       200:
 *         description: Admin status updated
 *       403:
 *         description: Admin access required
 */
router.put('/users/:userId/admin', authenticate, requireAdmin, async (req, res) => {
  try {
    const { userId } = req.params;
    const { is_admin } = req.body;

    if (typeof is_admin !== 'boolean') {
      return res.status(400).json({ error: 'is_admin must be a boolean' });
    }

    // Prevent removing your own admin access
    if (userId === req.user.id && !is_admin) {
      return res.status(400).json({ error: 'Cannot remove your own admin access' });
    }

    const sql = await dal.rawSql();
    const result = await sql`
      UPDATE users SET is_admin = ${is_admin}, updated_at = now()
      WHERE id = ${userId}
      RETURNING id, email, name, is_admin
    `;

    if (result.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json(result[0]);
  } catch (error) {
    console.error('Admin update error:', error);
    res.status(500).json({ error: 'Failed to update admin status' });
  }
});

/**
 * @swagger
 * /admin/users/{userId}:
 *   get:
 *     summary: User detail — profile, owned plans, org memberships, collaborations, recent activity
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: User detail
 *       404:
 *         description: User not found
 *       403:
 *         description: Admin access required
 */
router.get('/users/:userId', authenticate, requireAdmin, async (req, res) => {
  try {
    const { userId } = req.params;
    const sql = await dal.rawSql();

    const [user] = await sql`
      SELECT
        u.id, u.email, u.name, u.is_admin,
        COALESCE(u.avatar_url, u.github_avatar_url, u.google_avatar_url) AS avatar_url,
        u.github_username, u.github_profile_url, u.capability_tags,
        u.created_at, u.updated_at,
        (SELECT count(*)::int FROM plans p WHERE p.owner_id = u.id) AS plan_count,
        (SELECT count(*)::int FROM plan_collaborators pc WHERE pc.user_id = u.id) AS collaboration_count,
        (SELECT count(*)::int FROM organization_members m WHERE m.user_id = u.id) AS organization_count
      FROM users u
      WHERE u.id = ${userId}
    `;

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const ownedPlans = await sql`
      SELECT p.id, p.title, p.status, p.visibility, p.updated_at,
        o.id AS org_id, o.name AS org_name,
        (SELECT count(*)::int FROM plan_nodes n WHERE n.plan_id = p.id AND n.node_type <> 'root') AS node_count,
        (SELECT count(*)::int FROM plan_nodes n WHERE n.plan_id = p.id AND n.status = 'completed') AS completed_count
      FROM plans p
      LEFT JOIN organizations o ON o.id = p.organization_id
      WHERE p.owner_id = ${userId}
      ORDER BY p.updated_at DESC
      LIMIT 100
    `;

    const organizations = await sql`
      SELECT o.id, o.name, o.slug, o.is_personal, m.role, m.joined_at
      FROM organization_members m
      JOIN organizations o ON o.id = m.organization_id
      WHERE m.user_id = ${userId}
      ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, o.name ASC
    `;

    const collaborations = await sql`
      SELECT p.id, p.title, p.status, p.visibility, pc.role, pc.created_at,
        ou.name AS owner_name, ou.email AS owner_email
      FROM plan_collaborators pc
      JOIN plans p ON p.id = pc.plan_id
      JOIN users ou ON ou.id = p.owner_id
      WHERE pc.user_id = ${userId}
      ORDER BY pc.created_at DESC
      LIMIT 100
    `;

    const activity = await sql`
      SELECT id, action, resource_type, resource_id, details, created_at
      FROM audit_logs
      WHERE user_id = ${userId}
      ORDER BY created_at DESC
      LIMIT 25
    `;

    res.json({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        is_admin: user.is_admin,
        avatar_url: user.avatar_url,
        github_username: user.github_username,
        github_profile_url: user.github_profile_url,
        capability_tags: user.capability_tags || [],
        created_at: user.created_at,
        updated_at: user.updated_at,
        plan_count: user.plan_count,
        collaboration_count: user.collaboration_count,
        organization_count: user.organization_count,
      },
      plans: ownedPlans.map((p) => ({
        id: p.id,
        title: p.title,
        status: p.status,
        visibility: p.visibility,
        updated_at: p.updated_at,
        node_count: p.node_count,
        completed_count: p.completed_count,
        organization: p.org_id ? { id: p.org_id, name: p.org_name } : null,
      })),
      organizations: organizations.map((o) => ({
        id: o.id,
        name: o.name,
        slug: o.slug,
        is_personal: o.is_personal,
        role: o.role,
        joined_at: o.joined_at,
      })),
      collaborations: collaborations.map((c) => ({
        id: c.id,
        title: c.title,
        status: c.status,
        visibility: c.visibility,
        role: c.role,
        created_at: c.created_at,
        owner: { name: c.owner_name, email: c.owner_email },
      })),
      recent_activity: activity.map((a) => ({
        id: a.id,
        action: a.action,
        resourceType: a.resource_type,
        resourceId: a.resource_id,
        details: a.details,
        createdAt: a.created_at,
      })),
    });
  } catch (error) {
    console.error('Admin user detail error:', error);
    res.status(500).json({ error: 'Failed to fetch user' });
  }
});

/**
 * @swagger
 * /admin/activity:
 *   get:
 *     summary: Recent system-wide activity (audit log or tool calls)
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: type
 *         schema:
 *           type: string
 *           enum: [audit, tools]
 *           default: audit
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 50
 *       - in: query
 *         name: offset
 *         schema:
 *           type: integer
 *           default: 0
 *       - in: query
 *         name: action
 *         schema:
 *           type: string
 *         description: (audit) exact match on the action column
 *       - in: query
 *         name: toolName
 *         schema:
 *           type: string
 *         description: (tools) exact match on the tool name
 *       - in: query
 *         name: responseStatus
 *         schema:
 *           type: integer
 *         description: (tools) exact match on the HTTP-equivalent response status
 *       - in: query
 *         name: since
 *         schema:
 *           type: string
 *           format: date-time
 *         description: Only entries created at/after this timestamp
 *       - in: query
 *         name: until
 *         schema:
 *           type: string
 *           format: date-time
 *         description: Only entries created at/before this timestamp
 *     responses:
 *       200:
 *         description: List of recent activity entries (with total for pagination)
 *       403:
 *         description: Admin access required
 */
router.get('/activity', authenticate, requireAdmin, async (req, res) => {
  try {
    const type = req.query.type === 'tools' ? 'tools' : 'audit';
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    const offset = parseInt(req.query.offset) || 0;
    const since = req.query.since || undefined;
    const until = req.query.until || undefined;
    const hasStatus = req.query.responseStatus !== undefined && req.query.responseStatus !== '';

    const { entries, total } = type === 'tools'
      ? await dal.toolCallsDal.listRecentAll({
          limit,
          offset,
          toolName: req.query.toolName || undefined,
          responseStatus: hasStatus ? parseInt(req.query.responseStatus) : undefined,
          errorsOnly: req.query.errorsOnly === 'true',
          since,
          until,
        })
      : await dal.auditDal.listRecent({
          limit,
          offset,
          action: req.query.action || undefined,
          since,
          until,
        });

    res.json({ type, entries, total, limit, offset, generated_at: new Date().toISOString() });
  } catch (error) {
    console.error('Admin activity error:', error);
    res.status(500).json({ error: 'Failed to fetch activity' });
  }
});

/**
 * @swagger
 * /admin/activity/tools/stats:
 *   get:
 *     summary: MCP/REST tool-call aggregates (error rate, p95 duration, by tool/status)
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: since
 *         schema:
 *           type: string
 *           format: date-time
 *         description: Only aggregate calls created at/after this timestamp
 *     responses:
 *       200:
 *         description: Tool-call statistics
 *       403:
 *         description: Admin access required
 */
router.get('/activity/tools/stats', authenticate, requireAdmin, async (req, res) => {
  try {
    const since = req.query.since || null;
    const sql = await dal.rawSql();

    const [totals] = await sql`
      SELECT
        count(*)::int AS total,
        (count(*) FILTER (WHERE response_status >= 400))::int AS errors,
        percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms) AS p95_ms
      FROM tool_calls
      WHERE (${since}::timestamptz IS NULL OR created_at >= ${since}::timestamptz)
    `;

    const byTool = await sql`
      SELECT tool_name,
        count(*)::int AS count,
        (count(*) FILTER (WHERE response_status >= 400))::int AS errors,
        percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms) AS p95_ms
      FROM tool_calls
      WHERE (${since}::timestamptz IS NULL OR created_at >= ${since}::timestamptz)
      GROUP BY tool_name
      ORDER BY count DESC, tool_name ASC
      LIMIT 100
    `;

    const byStatus = await sql`
      SELECT response_status, count(*)::int AS count
      FROM tool_calls
      WHERE (${since}::timestamptz IS NULL OR created_at >= ${since}::timestamptz)
      GROUP BY response_status
      ORDER BY count DESC
    `;

    const round = (v) => (v == null ? null : Math.round(Number(v)));
    const rate = (errors, total) => (total > 0 ? errors / total : 0);

    res.json({
      since,
      totals: {
        total: totals.total,
        errors: totals.errors,
        error_rate: rate(totals.errors, totals.total),
        p95_ms: round(totals.p95_ms),
      },
      by_tool: byTool.map((t) => ({
        tool_name: t.tool_name,
        count: t.count,
        errors: t.errors,
        error_rate: rate(t.errors, t.count),
        p95_ms: round(t.p95_ms),
      })),
      by_status: byStatus,
      generated_at: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Admin tool-call stats error:', error);
    res.status(500).json({ error: 'Failed to fetch tool-call stats' });
  }
});

/**
 * @swagger
 * /admin/organizations:
 *   get:
 *     summary: List all organizations with member/workspace/plan counts
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: q
 *         schema:
 *           type: string
 *         description: Optional case-insensitive filter on name or slug
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 50
 *       - in: query
 *         name: offset
 *         schema:
 *           type: integer
 *           default: 0
 *     responses:
 *       200:
 *         description: List of organizations
 *       403:
 *         description: Admin access required
 */
router.get('/organizations', authenticate, requireAdmin, async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    const offset = parseInt(req.query.offset) || 0;
    const q = (req.query.q || '').trim();
    const like = `%${q}%`;
    const sql = await dal.rawSql();

    const orgs = q
      ? await sql`
          SELECT o.id, o.name, o.slug, o.is_personal, o.created_at,
            count(DISTINCT m.id)::int AS member_count,
            count(DISTINCT w.id)::int AS workspace_count,
            count(DISTINCT p.id)::int AS plan_count
          FROM organizations o
          LEFT JOIN organization_members m ON m.organization_id = o.id
          LEFT JOIN workspaces w ON w.organization_id = o.id
          LEFT JOIN plans p ON p.organization_id = o.id
          WHERE o.name ILIKE ${like} OR o.slug ILIKE ${like}
          GROUP BY o.id
          ORDER BY plan_count DESC, o.created_at DESC
          LIMIT ${limit} OFFSET ${offset}
        `
      : await sql`
          SELECT o.id, o.name, o.slug, o.is_personal, o.created_at,
            count(DISTINCT m.id)::int AS member_count,
            count(DISTINCT w.id)::int AS workspace_count,
            count(DISTINCT p.id)::int AS plan_count
          FROM organizations o
          LEFT JOIN organization_members m ON m.organization_id = o.id
          LEFT JOIN workspaces w ON w.organization_id = o.id
          LEFT JOIN plans p ON p.organization_id = o.id
          GROUP BY o.id
          ORDER BY plan_count DESC, o.created_at DESC
          LIMIT ${limit} OFFSET ${offset}
        `;

    const [{ count }] = q
      ? await sql`SELECT count(*)::int AS count FROM organizations WHERE name ILIKE ${like} OR slug ILIKE ${like}`
      : await sql`SELECT count(*)::int AS count FROM organizations`;

    res.json({ organizations: orgs, total: count, limit, offset });
  } catch (error) {
    console.error('Admin organizations error:', error);
    res.status(500).json({ error: 'Failed to fetch organizations' });
  }
});

/**
 * @swagger
 * /admin/organizations/{orgId}:
 *   get:
 *     summary: Organization detail — members and workspaces
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: orgId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Organization detail
 *       404:
 *         description: Organization not found
 *       403:
 *         description: Admin access required
 */
router.get('/organizations/:orgId', authenticate, requireAdmin, async (req, res) => {
  try {
    const { orgId } = req.params;
    const sql = await dal.rawSql();

    const [organization] = await sql`
      SELECT o.id, o.name, o.slug, o.description, o.is_personal, o.created_at,
        (SELECT count(*)::int FROM organization_members m WHERE m.organization_id = o.id) AS member_count,
        (SELECT count(*)::int FROM workspaces w WHERE w.organization_id = o.id) AS workspace_count,
        (SELECT count(*)::int FROM plans p WHERE p.organization_id = o.id) AS plan_count
      FROM organizations o
      WHERE o.id = ${orgId}
    `;

    if (!organization) {
      return res.status(404).json({ error: 'Organization not found' });
    }

    const members = await sql`
      SELECT u.id, u.email, u.name, u.is_admin, m.role, m.joined_at
      FROM organization_members m
      JOIN users u ON u.id = m.user_id
      WHERE m.organization_id = ${orgId}
      ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, m.joined_at ASC
    `;

    const workspaces = await sql`
      SELECT w.id, w.title, w.slug, w.is_default, w.archived_at, w.created_at, w.owner_id,
        count(p.id)::int AS plan_count
      FROM workspaces w
      LEFT JOIN plans p ON p.workspace_id = w.id
      WHERE w.organization_id = ${orgId}
      GROUP BY w.id
      ORDER BY w.is_default DESC, w.created_at ASC
    `;

    res.json({ organization, members, workspaces });
  } catch (error) {
    console.error('Admin organization detail error:', error);
    res.status(500).json({ error: 'Failed to fetch organization' });
  }
});

const ORG_ROLES = ['owner', 'admin', 'member'];

/**
 * @swagger
 * /admin/organizations/{orgId}:
 *   patch:
 *     summary: Rename an organization (name/description)
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: orgId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Updated organization
 *       404:
 *         description: Organization not found
 *       403:
 *         description: Admin access required
 */
router.patch('/organizations/:orgId', authenticate, requireAdmin, async (req, res) => {
  try {
    const { orgId } = req.params;
    const { name, description } = req.body;
    if (name !== undefined && (typeof name !== 'string' || !name.trim())) {
      return res.status(400).json({ error: 'name must be a non-empty string' });
    }
    const sql = await dal.rawSql();
    const [updated] = await sql`
      UPDATE organizations
      SET name = COALESCE(${name ?? null}, name),
          description = COALESCE(${description ?? null}, description),
          updated_at = now()
      WHERE id = ${orgId}
      RETURNING id, name, slug, description, is_personal
    `;
    if (!updated) return res.status(404).json({ error: 'Organization not found' });
    await dal.auditDal.log('admin.org.update', 'organization', orgId, {
      userId: req.user.id,
      details: { name, description },
    });
    res.json(updated);
  } catch (error) {
    console.error('Admin org update error:', error);
    res.status(500).json({ error: 'Failed to update organization' });
  }
});

/**
 * @swagger
 * /admin/organizations/{orgId}/members:
 *   post:
 *     summary: Add a user to an organization
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: orgId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       201:
 *         description: Member added
 *       404:
 *         description: Organization or user not found
 *       409:
 *         description: User is already a member
 *       403:
 *         description: Admin access required
 */
router.post('/organizations/:orgId/members', authenticate, requireAdmin, async (req, res) => {
  try {
    const { orgId } = req.params;
    const { userId, role = 'member' } = req.body;
    if (!userId) return res.status(400).json({ error: 'userId is required' });
    if (!ORG_ROLES.includes(role)) {
      return res.status(400).json({ error: `role must be one of ${ORG_ROLES.join(', ')}` });
    }
    const sql = await dal.rawSql();
    const [org] = await sql`SELECT id FROM organizations WHERE id = ${orgId}`;
    if (!org) return res.status(404).json({ error: 'Organization not found' });
    const [user] = await sql`SELECT id FROM users WHERE id = ${userId}`;
    if (!user) return res.status(404).json({ error: 'User not found' });

    let member;
    try {
      [member] = await sql`
        INSERT INTO organization_members (organization_id, user_id, role)
        VALUES (${orgId}, ${userId}, ${role})
        RETURNING id, organization_id, user_id, role, joined_at
      `;
    } catch (e) {
      if (e.code === '23505') return res.status(409).json({ error: 'User is already a member' });
      throw e;
    }
    await dal.auditDal.log('admin.org.member.add', 'organization', orgId, {
      userId: req.user.id,
      details: { targetUserId: userId, role },
    });
    res.status(201).json(member);
  } catch (error) {
    console.error('Admin org add-member error:', error);
    res.status(500).json({ error: 'Failed to add member' });
  }
});

/**
 * @swagger
 * /admin/organizations/{orgId}/members/{userId}:
 *   put:
 *     summary: Change an organization member's role
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: orgId
 *         required: true
 *         schema:
 *           type: string
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Role updated
 *       400:
 *         description: Invalid role or would remove the last owner
 *       404:
 *         description: Member not found
 *       403:
 *         description: Admin access required
 *   delete:
 *     summary: Remove a user from an organization
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: orgId
 *         required: true
 *         schema:
 *           type: string
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       204:
 *         description: Member removed
 *       400:
 *         description: Would remove the last owner
 *       404:
 *         description: Member not found
 *       403:
 *         description: Admin access required
 */
router.put('/organizations/:orgId/members/:userId', authenticate, requireAdmin, async (req, res) => {
  try {
    const { orgId, userId } = req.params;
    const { role } = req.body;
    if (!ORG_ROLES.includes(role)) {
      return res.status(400).json({ error: `role must be one of ${ORG_ROLES.join(', ')}` });
    }
    const sql = await dal.rawSql();
    const [member] = await sql`
      SELECT role FROM organization_members WHERE organization_id = ${orgId} AND user_id = ${userId}
    `;
    if (!member) return res.status(404).json({ error: 'Member not found' });

    // Last-owner protection: don't let the only owner be demoted.
    if (member.role === 'owner' && role !== 'owner') {
      const [{ owners }] = await sql`
        SELECT count(*)::int AS owners FROM organization_members
        WHERE organization_id = ${orgId} AND role = 'owner'
      `;
      if (owners <= 1) return res.status(400).json({ error: 'Cannot demote the last owner' });
    }

    const [updated] = await sql`
      UPDATE organization_members SET role = ${role}
      WHERE organization_id = ${orgId} AND user_id = ${userId}
      RETURNING id, organization_id, user_id, role
    `;
    await dal.auditDal.log('admin.org.member.role', 'organization', orgId, {
      userId: req.user.id,
      details: { targetUserId: userId, role },
    });
    res.json(updated);
  } catch (error) {
    console.error('Admin org member-role error:', error);
    res.status(500).json({ error: 'Failed to update member role' });
  }
});

router.delete('/organizations/:orgId/members/:userId', authenticate, requireAdmin, async (req, res) => {
  try {
    const { orgId, userId } = req.params;
    const sql = await dal.rawSql();
    const [member] = await sql`
      SELECT role FROM organization_members WHERE organization_id = ${orgId} AND user_id = ${userId}
    `;
    if (!member) return res.status(404).json({ error: 'Member not found' });

    if (member.role === 'owner') {
      const [{ owners }] = await sql`
        SELECT count(*)::int AS owners FROM organization_members
        WHERE organization_id = ${orgId} AND role = 'owner'
      `;
      if (owners <= 1) return res.status(400).json({ error: 'Cannot remove the last owner' });
    }

    await sql`
      DELETE FROM organization_members WHERE organization_id = ${orgId} AND user_id = ${userId}
    `;
    await dal.auditDal.log('admin.org.member.remove', 'organization', orgId, {
      userId: req.user.id,
      details: { targetUserId: userId },
    });
    res.status(204).send();
  } catch (error) {
    console.error('Admin org remove-member error:', error);
    res.status(500).json({ error: 'Failed to remove member' });
  }
});

/**
 * @swagger
 * /admin/plans:
 *   get:
 *     summary: List all plans system-wide with owner/org/workspace + node rollup
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: q
 *         schema:
 *           type: string
 *         description: Optional case-insensitive filter on plan title
 *       - in: query
 *         name: status
 *         schema:
 *           type: array
 *           items:
 *             type: string
 *         description: Filter by one or more plan statuses (draft|active|completed|archived)
 *       - in: query
 *         name: visibility
 *         schema:
 *           type: array
 *           items:
 *             type: string
 *         description: Filter by one or more visibilities (private|organization|public|unlisted)
 *       - in: query
 *         name: organization_id
 *         schema:
 *           type: string
 *         description: Filter to a single organization's plans
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 50
 *       - in: query
 *         name: offset
 *         schema:
 *           type: integer
 *           default: 0
 *     responses:
 *       200:
 *         description: List of plans
 *       403:
 *         description: Admin access required
 */
router.get('/plans', authenticate, requireAdmin, async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    const offset = parseInt(req.query.offset) || 0;
    const q = (req.query.q || '').trim();
    const like = `%${q}%`;
    const statusArr = [].concat(req.query.status || []);
    const visArr = [].concat(req.query.visibility || []);
    const orgId = req.query.organization_id || null;
    const sql = await dal.rawSql();

    const rows = await sql`
      SELECT p.id, p.title, p.status, p.visibility, p.updated_at,
        u.id AS owner_id, u.email AS owner_email, u.name AS owner_name,
        o.id AS org_id, o.name AS org_name,
        w.id AS ws_id, w.title AS ws_title,
        (SELECT count(*)::int FROM plan_nodes n WHERE n.plan_id = p.id AND n.node_type <> 'root') AS node_count,
        (SELECT count(*)::int FROM plan_nodes n WHERE n.plan_id = p.id AND n.status = 'completed') AS completed_count
      FROM plans p
      JOIN users u ON u.id = p.owner_id
      LEFT JOIN organizations o ON o.id = p.organization_id
      LEFT JOIN workspaces w ON w.id = p.workspace_id
      WHERE (${q} = '' OR p.title ILIKE ${like})
        AND (cardinality(${statusArr}::text[]) = 0 OR p.status = ANY(${statusArr}::text[]))
        AND (cardinality(${visArr}::text[]) = 0 OR p.visibility = ANY(${visArr}::text[]))
        AND (${orgId}::uuid IS NULL OR p.organization_id = ${orgId}::uuid)
      ORDER BY p.updated_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `;

    const [{ count }] = await sql`
      SELECT count(*)::int AS count
      FROM plans p
      WHERE (${q} = '' OR p.title ILIKE ${like})
        AND (cardinality(${statusArr}::text[]) = 0 OR p.status = ANY(${statusArr}::text[]))
        AND (cardinality(${visArr}::text[]) = 0 OR p.visibility = ANY(${visArr}::text[]))
        AND (${orgId}::uuid IS NULL OR p.organization_id = ${orgId}::uuid)
    `;

    const plans = rows.map((r) => ({
      id: r.id,
      title: r.title,
      status: r.status,
      visibility: r.visibility,
      updated_at: r.updated_at,
      node_count: r.node_count,
      completed_count: r.completed_count,
      owner: { id: r.owner_id, email: r.owner_email, name: r.owner_name },
      organization: r.org_id ? { id: r.org_id, name: r.org_name } : null,
      workspace: r.ws_id ? { id: r.ws_id, title: r.ws_title } : null,
    }));

    res.json({ plans, total: count, limit, offset });
  } catch (error) {
    console.error('Admin plans error:', error);
    res.status(500).json({ error: 'Failed to fetch plans' });
  }
});

/**
 * @swagger
 * /admin/plans/{planId}:
 *   get:
 *     summary: Plan detail — meta, owner, org/workspace, linked goals, collaborators, node breakdown
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: planId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Plan detail
 *       404:
 *         description: Plan not found
 *       403:
 *         description: Admin access required
 */
router.get('/plans/:planId', authenticate, requireAdmin, async (req, res) => {
  try {
    const { planId } = req.params;
    const sql = await dal.rawSql();

    const [plan] = await sql`
      SELECT p.id, p.title, p.description, p.status, p.visibility, p.created_at, p.updated_at,
        u.id AS owner_id, u.email AS owner_email, u.name AS owner_name,
        o.id AS org_id, o.name AS org_name,
        w.id AS ws_id, w.title AS ws_title
      FROM plans p
      JOIN users u ON u.id = p.owner_id
      LEFT JOIN organizations o ON o.id = p.organization_id
      LEFT JOIN workspaces w ON w.id = p.workspace_id
      WHERE p.id = ${planId}
    `;

    if (!plan) {
      return res.status(404).json({ error: 'Plan not found' });
    }

    const goals = await sql`
      SELECT g.id, g.title, g.status
      FROM goal_links gl
      JOIN goals g ON g.id = gl.goal_id
      WHERE gl.linked_type = 'plan' AND gl.linked_id = ${planId}
      ORDER BY g.title ASC
    `;

    const collaborators = await sql`
      SELECT u.id, u.email, u.name, pc.role, pc.created_at
      FROM plan_collaborators pc
      JOIN users u ON u.id = pc.user_id
      WHERE pc.plan_id = ${planId}
      ORDER BY pc.created_at ASC
    `;

    const nodeBreakdown = await sql`
      SELECT status, count(*)::int AS count
      FROM plan_nodes
      WHERE plan_id = ${planId} AND node_type <> 'root'
      GROUP BY status
      ORDER BY status
    `;

    res.json({
      plan: {
        id: plan.id,
        title: plan.title,
        description: plan.description,
        status: plan.status,
        visibility: plan.visibility,
        created_at: plan.created_at,
        updated_at: plan.updated_at,
        owner: { id: plan.owner_id, email: plan.owner_email, name: plan.owner_name },
        organization: plan.org_id ? { id: plan.org_id, name: plan.org_name } : null,
        workspace: plan.ws_id ? { id: plan.ws_id, title: plan.ws_title } : null,
      },
      goals,
      collaborators,
      node_breakdown: nodeBreakdown,
    });
  } catch (error) {
    console.error('Admin plan detail error:', error);
    res.status(500).json({ error: 'Failed to fetch plan' });
  }
});

/**
 * @swagger
 * /admin/health:
 *   get:
 *     summary: Subsystem health snapshot (DB, Graphiti, OpenAI key, version)
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Health snapshot (status 'ok' or 'degraded')
 *       403:
 *         description: Admin access required
 */
router.get('/health', authenticate, requireAdmin, async (req, res) => {
  try {
    const checks = {};

    // Database — direct ping.
    try {
      const sql = await dal.rawSql();
      await sql`SELECT 1`;
      checks.database = { ok: true, detail: 'SELECT 1 ok' };
    } catch (e) {
      checks.database = { ok: false, detail: e.message };
    }

    // Graphiti knowledge graph — reachability via the bridge's health probe.
    try {
      const g = await graphitiBridge.getStatus();
      checks.graphiti = { ok: !!g.available, available: !!g.available };
    } catch (e) {
      checks.graphiti = { ok: false, available: false, detail: e.message };
    }

    // OpenAI key — knowledge writes (Graphiti embeddings) silently no-op
    // without it, so surface its presence explicitly.
    const keyConfigured = Boolean(process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY.trim());
    checks.openai_key = {
      ok: keyConfigured,
      configured: keyConfigured,
      detail: keyConfigured
        ? 'OPENAI_API_KEY present'
        : 'OPENAI_API_KEY missing — knowledge writes silently no-op',
    };

    const ok = checks.database.ok && checks.graphiti.ok && checks.openai_key.ok;

    res.json({
      status: ok ? 'ok' : 'degraded',
      checks,
      version: pkg.version,
      commit: process.env.GIT_COMMIT || process.env.GIT_SHA || null,
      // message-bus + websocket presence are intentionally omitted: messageBus
      // exposes no status primitive, and ws presence is tracked in-process so a
      // count is per-instance and misleading under multiple replicas.
      generated_at: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Admin health error:', error);
    res.status(500).json({ error: 'Failed to compute health' });
  }
});

/**
 * @swagger
 * /admin/plans/{planId}/nodes:
 *   get:
 *     summary: Flat list of a plan's nodes (task tree) for the inspector
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: planId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Plan nodes (excludes root + archived)
 *       403:
 *         description: Admin access required
 */
router.get('/plans/:planId/nodes', authenticate, requireAdmin, async (req, res) => {
  try {
    const { planId } = req.params;
    const sql = await dal.rawSql();
    const nodes = await sql`
      SELECT id, parent_id, node_type, title, status, order_index, task_mode
      FROM plan_nodes
      WHERE plan_id = ${planId} AND node_type <> 'root' AND status <> 'archived'
      ORDER BY order_index ASC, created_at ASC
    `;
    res.json({ nodes });
  } catch (error) {
    console.error('Admin plan nodes error:', error);
    res.status(500).json({ error: 'Failed to fetch plan nodes' });
  }
});

const PLAN_ROLES = ['viewer', 'editor', 'admin'];

/**
 * @swagger
 * /admin/plans/{planId}/collaborators:
 *   post:
 *     summary: Share a plan with another member of the plan's organization
 *     description: >
 *       Adds a plan_collaborators row. Cross-tenant superadmin action — the
 *       target user must be a member of the plan's organization. Audit-logged.
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: planId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       201:
 *         description: Collaborator added
 *       400:
 *         description: Invalid role, owner cannot be a collaborator, plan has no org, or user is not an org member
 *       404:
 *         description: Plan or user not found
 *       409:
 *         description: User is already a collaborator
 *       403:
 *         description: Admin access required
 */
router.post('/plans/:planId/collaborators', authenticate, requireAdmin, async (req, res) => {
  try {
    const { planId } = req.params;
    const { userId, role = 'viewer' } = req.body;
    if (!userId) return res.status(400).json({ error: 'userId is required' });
    if (!PLAN_ROLES.includes(role)) {
      return res.status(400).json({ error: `role must be one of ${PLAN_ROLES.join(', ')}` });
    }

    const sql = await dal.rawSql();
    const [plan] = await sql`SELECT id, owner_id, organization_id FROM plans WHERE id = ${planId}`;
    if (!plan) return res.status(404).json({ error: 'Plan not found' });

    const [user] = await sql`SELECT id, email, name FROM users WHERE id = ${userId}`;
    if (!user) return res.status(404).json({ error: 'User not found' });

    if (userId === plan.owner_id) {
      return res.status(400).json({ error: 'Cannot add the plan owner as a collaborator' });
    }
    if (!plan.organization_id) {
      return res.status(400).json({ error: "Plan is not in an organization — sharing is limited to org members" });
    }

    const [member] = await sql`
      SELECT 1 AS ok FROM organization_members
      WHERE organization_id = ${plan.organization_id} AND user_id = ${userId}
    `;
    if (!member) {
      return res.status(400).json({ error: "User is not a member of the plan's organization" });
    }

    const [existing] = await sql`
      SELECT role FROM plan_collaborators WHERE plan_id = ${planId} AND user_id = ${userId}
    `;
    if (existing) return res.status(409).json({ error: 'User is already a collaborator' });

    const [collab] = await sql`
      INSERT INTO plan_collaborators (plan_id, user_id, role)
      VALUES (${planId}, ${userId}, ${role})
      RETURNING id, plan_id, user_id, role, created_at
    `;
    await dal.auditDal.log('admin.plan.collaborator.add', 'plan', planId, {
      userId: req.user.id,
      details: { targetUserId: userId, role },
    });
    res.status(201).json({ ...collab, email: user.email, name: user.name });
  } catch (error) {
    console.error('Admin plan share error:', error);
    res.status(500).json({ error: 'Failed to share plan' });
  }
});

/**
 * @swagger
 * /admin/plans/{planId}/collaborators/{userId}:
 *   put:
 *     summary: Change a plan collaborator's role
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: planId
 *         required: true
 *         schema:
 *           type: string
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Role updated
 *       400:
 *         description: Invalid role
 *       404:
 *         description: Collaborator not found
 *       403:
 *         description: Admin access required
 *   delete:
 *     summary: Remove a plan collaborator (unshare)
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: planId
 *         required: true
 *         schema:
 *           type: string
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       204:
 *         description: Collaborator removed
 *       404:
 *         description: Collaborator not found
 *       403:
 *         description: Admin access required
 */
router.put('/plans/:planId/collaborators/:userId', authenticate, requireAdmin, async (req, res) => {
  try {
    const { planId, userId } = req.params;
    const { role } = req.body;
    if (!PLAN_ROLES.includes(role)) {
      return res.status(400).json({ error: `role must be one of ${PLAN_ROLES.join(', ')}` });
    }
    const sql = await dal.rawSql();
    const [updated] = await sql`
      UPDATE plan_collaborators SET role = ${role}
      WHERE plan_id = ${planId} AND user_id = ${userId}
      RETURNING id, plan_id, user_id, role
    `;
    if (!updated) return res.status(404).json({ error: 'Collaborator not found' });
    await dal.auditDal.log('admin.plan.collaborator.role', 'plan', planId, {
      userId: req.user.id,
      details: { targetUserId: userId, role },
    });
    res.json(updated);
  } catch (error) {
    console.error('Admin plan collaborator-role error:', error);
    res.status(500).json({ error: 'Failed to update collaborator role' });
  }
});

router.delete('/plans/:planId/collaborators/:userId', authenticate, requireAdmin, async (req, res) => {
  try {
    const { planId, userId } = req.params;
    const sql = await dal.rawSql();
    const [removed] = await sql`
      DELETE FROM plan_collaborators WHERE plan_id = ${planId} AND user_id = ${userId}
      RETURNING id
    `;
    if (!removed) return res.status(404).json({ error: 'Collaborator not found' });
    await dal.auditDal.log('admin.plan.collaborator.remove', 'plan', planId, {
      userId: req.user.id,
      details: { targetUserId: userId },
    });
    res.status(204).send();
  } catch (error) {
    console.error('Admin plan unshare error:', error);
    res.status(500).json({ error: 'Failed to remove collaborator' });
  }
});

/**
 * @swagger
 * /admin/goals/{goalId}:
 *   get:
 *     summary: Goal detail with the plans connected to it
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: goalId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Goal + connected plans
 *       404:
 *         description: Goal not found
 *       403:
 *         description: Admin access required
 */
router.get('/goals/:goalId', authenticate, requireAdmin, async (req, res) => {
  try {
    const { goalId } = req.params;
    const sql = await dal.rawSql();
    const [goal] = await sql`
      SELECT id, title, description, type, status, promoted_at, created_at, updated_at
      FROM goals WHERE id = ${goalId}
    `;
    if (!goal) return res.status(404).json({ error: 'Goal not found' });

    const plans = await sql`
      SELECT p.id, p.title, p.status, p.visibility, p.updated_at
      FROM goal_links gl
      JOIN plans p ON p.id = gl.linked_id
      WHERE gl.goal_id = ${goalId} AND gl.linked_type = 'plan'
      ORDER BY p.updated_at DESC
    `;

    res.json({ goal: { ...goal, committed: goal.promoted_at != null }, plans });
  } catch (error) {
    console.error('Admin goal detail error:', error);
    res.status(500).json({ error: 'Failed to fetch goal' });
  }
});

/**
 * @swagger
 * /admin/tokens:
 *   get:
 *     summary: List all API tokens with owner/org + tool-call usage rollup
 *     description: Never returns token_hash. Powers the token-oversight surface.
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: q
 *         schema:
 *           type: string
 *         description: Case-insensitive filter on token name or owner email
 *       - in: query
 *         name: revoked
 *         schema:
 *           type: string
 *           enum: [true, false]
 *         description: Filter by revoked state (omit for all)
 *       - in: query
 *         name: organization_id
 *         schema:
 *           type: string
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 50
 *       - in: query
 *         name: offset
 *         schema:
 *           type: integer
 *           default: 0
 *     responses:
 *       200:
 *         description: List of tokens
 *       403:
 *         description: Admin access required
 */
router.get('/tokens', authenticate, requireAdmin, async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    const offset = parseInt(req.query.offset) || 0;
    const q = (req.query.q || '').trim();
    const like = `%${q}%`;
    const orgId = req.query.organization_id || null;
    const revoked = req.query.revoked === 'true' ? true : req.query.revoked === 'false' ? false : null;
    const sql = await dal.rawSql();

    const rows = await sql`
      SELECT t.id, t.name, t.permissions, t.created_at, t.last_used, t.revoked,
        u.id AS owner_id, u.email AS owner_email, u.name AS owner_name,
        o.id AS org_id, o.name AS org_name,
        (SELECT count(*)::int FROM tool_calls tc WHERE tc.token_id = t.id) AS call_count,
        (SELECT count(*)::int FROM tool_calls tc WHERE tc.token_id = t.id AND tc.response_status >= 400) AS error_count,
        (SELECT max(tc.created_at) FROM tool_calls tc WHERE tc.token_id = t.id) AS last_call_at
      FROM api_tokens t
      JOIN users u ON u.id = t.user_id
      LEFT JOIN organizations o ON o.id = t.organization_id
      WHERE (${q} = '' OR t.name ILIKE ${like} OR u.email ILIKE ${like})
        AND (${orgId}::uuid IS NULL OR t.organization_id = ${orgId}::uuid)
        AND (${revoked}::boolean IS NULL OR t.revoked = ${revoked}::boolean)
      ORDER BY t.last_used DESC NULLS LAST, t.created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `;

    const [{ count }] = await sql`
      SELECT count(*)::int AS count
      FROM api_tokens t
      JOIN users u ON u.id = t.user_id
      WHERE (${q} = '' OR t.name ILIKE ${like} OR u.email ILIKE ${like})
        AND (${orgId}::uuid IS NULL OR t.organization_id = ${orgId}::uuid)
        AND (${revoked}::boolean IS NULL OR t.revoked = ${revoked}::boolean)
    `;

    const tokens = rows.map((r) => ({
      id: r.id,
      name: r.name,
      permissions: r.permissions || [],
      created_at: r.created_at,
      last_used: r.last_used,
      revoked: r.revoked,
      owner: { id: r.owner_id, email: r.owner_email, name: r.owner_name },
      organization: r.org_id ? { id: r.org_id, name: r.org_name } : null,
      call_count: r.call_count,
      error_count: r.error_count,
      last_call_at: r.last_call_at,
    }));

    res.json({ tokens, total: count, limit, offset });
  } catch (error) {
    console.error('Admin tokens error:', error);
    res.status(500).json({ error: 'Failed to fetch tokens' });
  }
});

/**
 * @swagger
 * /admin/tokens/{tokenId}:
 *   get:
 *     summary: API token detail — owner/org, usage rollup, recent calls, by-tool breakdown
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: tokenId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Token detail
 *       404:
 *         description: Token not found
 *       403:
 *         description: Admin access required
 */
router.get('/tokens/:tokenId', authenticate, requireAdmin, async (req, res) => {
  try {
    const { tokenId } = req.params;
    const sql = await dal.rawSql();

    const [token] = await sql`
      SELECT t.id, t.name, t.permissions, t.created_at, t.last_used, t.revoked,
        u.id AS owner_id, u.email AS owner_email, u.name AS owner_name,
        o.id AS org_id, o.name AS org_name
      FROM api_tokens t
      JOIN users u ON u.id = t.user_id
      LEFT JOIN organizations o ON o.id = t.organization_id
      WHERE t.id = ${tokenId}
    `;
    if (!token) return res.status(404).json({ error: 'Token not found' });

    const recentCalls = await sql`
      SELECT id, tool_name, client_label, response_status, duration_ms, created_at
      FROM tool_calls
      WHERE token_id = ${tokenId}
      ORDER BY created_at DESC
      LIMIT 50
    `;

    const byTool = await sql`
      SELECT tool_name,
        count(*)::int AS count,
        (count(*) FILTER (WHERE response_status >= 400))::int AS errors
      FROM tool_calls
      WHERE token_id = ${tokenId}
      GROUP BY tool_name
      ORDER BY count DESC, tool_name ASC
      LIMIT 50
    `;

    res.json({
      token: {
        id: token.id,
        name: token.name,
        permissions: token.permissions || [],
        created_at: token.created_at,
        last_used: token.last_used,
        revoked: token.revoked,
        owner: { id: token.owner_id, email: token.owner_email, name: token.owner_name },
        organization: token.org_id ? { id: token.org_id, name: token.org_name } : null,
      },
      recent_calls: recentCalls.map((c) => ({
        id: c.id,
        toolName: c.tool_name,
        clientLabel: c.client_label,
        responseStatus: c.response_status,
        durationMs: c.duration_ms,
        createdAt: c.created_at,
      })),
      by_tool: byTool,
    });
  } catch (error) {
    console.error('Admin token detail error:', error);
    res.status(500).json({ error: 'Failed to fetch token' });
  }
});

/**
 * @swagger
 * /admin/decisions:
 *   get:
 *     summary: Cross-tenant human-decision queue (decision_requests) with plan/org context
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [pending, decided, expired, cancelled]
 *       - in: query
 *         name: urgency
 *         schema:
 *           type: string
 *           enum: [blocking, can_continue, informational]
 *       - in: query
 *         name: q
 *         schema:
 *           type: string
 *         description: Case-insensitive filter on decision title
 *       - in: query
 *         name: organization_id
 *         schema:
 *           type: string
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 50
 *       - in: query
 *         name: offset
 *         schema:
 *           type: integer
 *           default: 0
 *     responses:
 *       200:
 *         description: List of decision requests (pending first)
 *       403:
 *         description: Admin access required
 */
router.get('/decisions', authenticate, requireAdmin, async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    const offset = parseInt(req.query.offset) || 0;
    const q = (req.query.q || '').trim();
    const like = `%${q}%`;
    const status = req.query.status || null;
    const urgency = req.query.urgency || null;
    const orgId = req.query.organization_id || null;
    const sql = await dal.rawSql();

    const rows = await sql`
      SELECT d.id, d.title, d.urgency, d.status, d.created_at, d.expires_at, d.decided_at,
        d.requested_by_agent_name,
        p.id AS plan_id, p.title AS plan_title,
        o.id AS org_id, o.name AS org_name,
        ru.id AS req_user_id, ru.email AS req_user_email, ru.name AS req_user_name,
        du.id AS dec_user_id, du.email AS dec_user_email, du.name AS dec_user_name
      FROM decision_requests d
      JOIN plans p ON p.id = d.plan_id
      LEFT JOIN organizations o ON o.id = p.organization_id
      LEFT JOIN users ru ON ru.id = d.requested_by_user_id
      LEFT JOIN users du ON du.id = d.decided_by_user_id
      WHERE (${status}::text IS NULL OR d.status = ${status})
        AND (${urgency}::text IS NULL OR d.urgency = ${urgency})
        AND (${q} = '' OR d.title ILIKE ${like})
        AND (${orgId}::uuid IS NULL OR p.organization_id = ${orgId}::uuid)
      ORDER BY (d.status = 'pending') DESC, d.created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `;

    const [{ count }] = await sql`
      SELECT count(*)::int AS count
      FROM decision_requests d
      JOIN plans p ON p.id = d.plan_id
      WHERE (${status}::text IS NULL OR d.status = ${status})
        AND (${urgency}::text IS NULL OR d.urgency = ${urgency})
        AND (${q} = '' OR d.title ILIKE ${like})
        AND (${orgId}::uuid IS NULL OR p.organization_id = ${orgId}::uuid)
    `;

    const decisions = rows.map((r) => ({
      id: r.id,
      title: r.title,
      urgency: r.urgency,
      status: r.status,
      created_at: r.created_at,
      expires_at: r.expires_at,
      decided_at: r.decided_at,
      plan: { id: r.plan_id, title: r.plan_title },
      organization: r.org_id ? { id: r.org_id, name: r.org_name } : null,
      requested_by: r.req_user_id
        ? { id: r.req_user_id, email: r.req_user_email, name: r.req_user_name, agentName: r.requested_by_agent_name }
        : { id: null, email: null, name: null, agentName: r.requested_by_agent_name },
      decided_by: r.dec_user_id ? { id: r.dec_user_id, email: r.dec_user_email, name: r.dec_user_name } : null,
    }));

    res.json({ decisions, total: count, limit, offset });
  } catch (error) {
    console.error('Admin decisions error:', error);
    res.status(500).json({ error: 'Failed to fetch decisions' });
  }
});

/**
 * @swagger
 * /admin/decisions/{decisionId}:
 *   get:
 *     summary: Decision request detail — context, options, resolution
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: decisionId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Decision detail
 *       404:
 *         description: Decision not found
 *       403:
 *         description: Admin access required
 */
router.get('/decisions/:decisionId', authenticate, requireAdmin, async (req, res) => {
  try {
    const { decisionId } = req.params;
    const sql = await dal.rawSql();
    const [d] = await sql`
      SELECT d.id, d.title, d.context, d.options, d.urgency, d.status,
        d.created_at, d.updated_at, d.expires_at,
        d.decision, d.rationale, d.decided_at, d.requested_by_agent_name,
        p.id AS plan_id, p.title AS plan_title,
        n.id AS node_id, n.title AS node_title,
        o.id AS org_id, o.name AS org_name,
        ru.id AS req_user_id, ru.email AS req_user_email, ru.name AS req_user_name,
        du.id AS dec_user_id, du.email AS dec_user_email, du.name AS dec_user_name
      FROM decision_requests d
      JOIN plans p ON p.id = d.plan_id
      LEFT JOIN plan_nodes n ON n.id = d.node_id
      LEFT JOIN organizations o ON o.id = p.organization_id
      LEFT JOIN users ru ON ru.id = d.requested_by_user_id
      LEFT JOIN users du ON du.id = d.decided_by_user_id
      WHERE d.id = ${decisionId}
    `;
    if (!d) return res.status(404).json({ error: 'Decision not found' });

    res.json({
      decision: {
        id: d.id,
        title: d.title,
        context: d.context,
        options: d.options || [],
        urgency: d.urgency,
        status: d.status,
        created_at: d.created_at,
        updated_at: d.updated_at,
        expires_at: d.expires_at,
        resolution: { decision: d.decision, rationale: d.rationale, decided_at: d.decided_at },
        plan: { id: d.plan_id, title: d.plan_title },
        node: d.node_id ? { id: d.node_id, title: d.node_title } : null,
        organization: d.org_id ? { id: d.org_id, name: d.org_name } : null,
        requested_by: d.req_user_id
          ? { id: d.req_user_id, email: d.req_user_email, name: d.req_user_name, agentName: d.requested_by_agent_name }
          : { id: null, email: null, name: null, agentName: d.requested_by_agent_name },
        decided_by: d.dec_user_id ? { id: d.dec_user_id, email: d.dec_user_email, name: d.dec_user_name } : null,
      },
    });
  } catch (error) {
    console.error('Admin decision detail error:', error);
    res.status(500).json({ error: 'Failed to fetch decision' });
  }
});

/**
 * @swagger
 * /admin/knowledge:
 *   get:
 *     summary: Knowledge-graph oversight — task-linked episode counts + silent-fail signals
 *     description: >
 *       Counts task-linked Graphiti episodes (episode_node_links — the only
 *       Postgres bridge; episodes themselves live in Graphiti/Neo4j, so this
 *       undercounts unlinked knowledge). Surfaces the OPENAI_API_KEY silent-fail
 *       (knowledge writes no-op without it) and per-org linkage so orgs with
 *       tasks but zero linked knowledge stand out.
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Knowledge oversight snapshot
 *       403:
 *         description: Admin access required
 */
router.get('/knowledge', authenticate, requireAdmin, async (req, res) => {
  try {
    const sql = await dal.rawSql();

    // Graphiti reachability + OpenAI key (knowledge writes silently no-op without it).
    let graphiti;
    try {
      const g = await graphitiBridge.getStatus();
      graphiti = { ok: !!g.available, available: !!g.available };
    } catch (e) {
      graphiti = { ok: false, available: false, detail: e.message };
    }
    const keyConfigured = Boolean(process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY.trim());
    const openaiKey = {
      ok: keyConfigured,
      configured: keyConfigured,
      detail: keyConfigured
        ? 'OPENAI_API_KEY present'
        : 'OPENAI_API_KEY missing — knowledge writes silently no-op',
    };

    const [totals] = await sql`
      SELECT count(DISTINCT episode_id)::int AS distinct_episodes, count(*)::int AS total_links
      FROM episode_node_links
    `;

    const byLinkType = await sql`
      SELECT link_type, count(*)::int AS count, count(DISTINCT episode_id)::int AS episodes
      FROM episode_node_links
      GROUP BY link_type
      ORDER BY count DESC
    `;

    // Per-org linkage. LEFT JOINs from organizations so orgs with tasks but no
    // linked episodes (silent-fail candidates) still appear with zero counts.
    const byOrg = await sql`
      SELECT o.id, o.name,
        count(DISTINCT enl.episode_id)::int AS episode_count,
        count(enl.id)::int AS link_count,
        max(enl.created_at) AS last_linked_at,
        (SELECT count(*)::int FROM plans p2 WHERE p2.organization_id = o.id) AS plan_count,
        (SELECT count(*)::int FROM plan_nodes n2
           JOIN plans p3 ON p3.id = n2.plan_id
          WHERE p3.organization_id = o.id AND n2.node_type <> 'root') AS node_count
      FROM organizations o
      LEFT JOIN plans p ON p.organization_id = o.id
      LEFT JOIN plan_nodes n ON n.plan_id = p.id
      LEFT JOIN episode_node_links enl ON enl.node_id = n.id
      GROUP BY o.id, o.name
      ORDER BY episode_count DESC, o.name ASC
      LIMIT 200
    `;

    res.json({
      status: { graphiti, openai_key: openaiKey },
      totals: { distinct_episodes: totals.distinct_episodes, total_links: totals.total_links },
      by_link_type: byLinkType,
      by_org: byOrg.map((r) => ({
        id: r.id,
        name: r.name,
        episode_count: r.episode_count,
        link_count: r.link_count,
        last_linked_at: r.last_linked_at,
        plan_count: r.plan_count,
        node_count: r.node_count,
      })),
      generated_at: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Admin knowledge error:', error);
    res.status(500).json({ error: 'Failed to compute knowledge snapshot' });
  }
});

module.exports = router;
