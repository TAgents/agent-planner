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

module.exports = router;
