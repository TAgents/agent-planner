/**
 * Admin routes — system-level stats and management.
 * All routes require authenticate + requireAdmin.
 */
const express = require('express');
const router = express.Router();
const { authenticate, requireAdmin } = require('../middleware/auth.middleware.v2');
const dal = require('../db/dal.cjs');

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
 *     responses:
 *       200:
 *         description: List of recent activity entries
 *       403:
 *         description: Admin access required
 */
router.get('/activity', authenticate, requireAdmin, async (req, res) => {
  try {
    const type = req.query.type === 'tools' ? 'tools' : 'audit';
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);

    const entries = type === 'tools'
      ? await dal.toolCallsDal.listRecentAll({ limit })
      : await dal.auditDal.listRecent({ limit });

    res.json({ type, entries, limit, generated_at: new Date().toISOString() });
  } catch (error) {
    console.error('Admin activity error:', error);
    res.status(500).json({ error: 'Failed to fetch activity' });
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

module.exports = router;
