/**
 * Organization Routes — v2 (DAL layer)
 */

const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth.middleware');
const { organizationsDal, usersDal } = require('../db/dal.cjs');
const logger = require('../utils/logger');

// ─── Helper: slug from name ──────────────────────────────────────
function generateSlug(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, 50);
}

// ─── List user's organizations ───────────────────────────────────
router.get('/', authenticate, async (req, res) => {
  try {
    const orgs = await organizationsDal.listForUser(req.user.id);
    return res.json({ organizations: orgs });
  } catch (error) {
    await logger.error('List organizations error:', error);
    return res.status(500).json({ error: 'Failed to list organizations' });
  }
});

// ─── Get organization details ────────────────────────────────────
router.get('/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const membership = await organizationsDal.getMembership(id, req.user.id);
    if (!membership) return res.status(403).json({ error: 'Access denied' });

    const org = await organizationsDal.findById(id);
    if (!org) return res.status(404).json({ error: 'Organization not found' });

    const [memberCount, planCount] = await Promise.all([
      organizationsDal.getMemberCount(id),
      organizationsDal.getPlanCount(id),
    ]);

    return res.json({ ...org, role: membership.role, memberCount, planCount });
  } catch (error) {
    await logger.error('Get organization error:', error);
    return res.status(500).json({ error: 'Failed to get organization' });
  }
});

// ─── Create organization ─────────────────────────────────────────
router.post('/', authenticate, async (req, res) => {
  try {
    const { name, description, slug } = req.body;
    if (!name) return res.status(400).json({ error: 'Name is required' });

    const orgSlug = slug || generateSlug(name);

    const existing = await organizationsDal.findBySlug(orgSlug);
    if (existing) return res.status(400).json({ error: 'Organization slug already exists' });

    const org = await organizationsDal.create({ name, slug: orgSlug, description: description || '' });
    await organizationsDal.addMember(org.id, req.user.id, 'owner');

    await logger.api(`Organization created: ${org.id} by user ${req.user.id}`);
    return res.status(201).json({ ...org, role: 'owner' });
  } catch (error) {
    await logger.error('Create organization error:', error);
    return res.status(500).json({ error: 'Failed to create organization' });
  }
});

// ─── Update organization ─────────────────────────────────────────
router.put('/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, avatarUrl } = req.body;

    const membership = await organizationsDal.getMembership(id, req.user.id);
    if (!membership || membership.role !== 'owner') {
      return res.status(403).json({ error: 'Only owners can update organization' });
    }

    const updates = {};
    if (name !== undefined) updates.name = name;
    if (description !== undefined) updates.description = description;
    if (avatarUrl !== undefined) updates.avatarUrl = avatarUrl;

    const org = await organizationsDal.update(id, updates);
    return res.json(org);
  } catch (error) {
    await logger.error('Update organization error:', error);
    return res.status(500).json({ error: 'Failed to update organization' });
  }
});

// ─── Delete organization ─────────────────────────────────────────
router.delete('/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const org = await organizationsDal.findById(id);
    if (!org) return res.status(404).json({ error: 'Organization not found' });
    if (org.isPersonal) return res.status(400).json({ error: 'Cannot delete personal organization' });

    const membership = await organizationsDal.getMembership(id, req.user.id);
    if (!membership || membership.role !== 'owner') {
      return res.status(403).json({ error: 'Only owners can delete organization' });
    }

    await organizationsDal.delete(id);
    await logger.api(`Organization deleted: ${id}`);
    return res.json({ success: true, message: 'Organization deleted' });
  } catch (error) {
    await logger.error('Delete organization error:', error);
    return res.status(500).json({ error: 'Failed to delete organization' });
  }
});

// ─── List members ────────────────────────────────────────────────
router.get('/:id/members', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const membership = await organizationsDal.getMembership(id, req.user.id);
    if (!membership) return res.status(403).json({ error: 'Access denied' });

    const members = await organizationsDal.listMembers(id);
    return res.json({
      members: members.map(m => ({
        id: m.id, role: m.role, joinedAt: m.joinedAt,
        user: { id: m.userId, email: m.userEmail, name: m.userName, avatarUrl: m.userAvatarUrl }
      }))
    });
  } catch (error) {
    await logger.error('List members error:', error);
    return res.status(500).json({ error: 'Failed to list members' });
  }
});

// ─── Add member ──────────────────────────────────────────────────
router.post('/:id/members', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const { user_id, email, role = 'member' } = req.body;

    const membership = await organizationsDal.getMembership(id, req.user.id);
    if (!membership || !['owner', 'admin'].includes(membership.role)) {
      return res.status(403).json({ error: 'Only owners and admins can add members' });
    }
    if (role === 'owner') return res.status(400).json({ error: 'Cannot add additional owners' });

    let targetUserId = user_id;
    if (!targetUserId && email) {
      const user = await usersDal.findByEmail(email.toLowerCase());
      if (!user) return res.status(404).json({ error: 'User not found' });
      targetUserId = user.id;
    }
    if (!targetUserId) return res.status(400).json({ error: 'user_id or email required' });

    const existing = await organizationsDal.getMembership(id, targetUserId);
    if (existing) return res.status(400).json({ error: 'User is already a member' });

    const m = await organizationsDal.addMember(id, targetUserId, role);
    const targetUser = await usersDal.findById(targetUserId);

    await logger.api(`Member ${targetUserId} added to org ${id}`);
    return res.status(201).json({
      id: m.id, role: m.role, joinedAt: m.joinedAt,
      user: { id: targetUser?.id, email: targetUser?.email, name: targetUser?.name }
    });
  } catch (error) {
    await logger.error('Add member error:', error);
    return res.status(500).json({ error: 'Failed to add member' });
  }
});

// ─── Remove member ───────────────────────────────────────────────
router.delete('/:orgId/members/:memberId', authenticate, async (req, res) => {
  try {
    const { orgId, memberId } = req.params;

    const membership = await organizationsDal.getMembership(orgId, req.user.id);
    if (!membership || !['owner', 'admin'].includes(membership.role)) {
      return res.status(403).json({ error: 'Only owners and admins can remove members' });
    }

    const members = await organizationsDal.listMembers(orgId);
    const target = members.find(m => m.id === memberId);
    if (!target) return res.status(404).json({ error: 'Member not found' });
    if (target.role === 'owner') return res.status(400).json({ error: 'Cannot remove organization owner' });
    if (membership.role === 'admin' && target.role === 'admin') {
      return res.status(403).json({ error: 'Admins cannot remove other admins' });
    }

    await organizationsDal.removeMember(orgId, memberId);
    await logger.api(`Member ${memberId} removed from org ${orgId}`);
    return res.json({ success: true, message: 'Member removed' });
  } catch (error) {
    await logger.error('Remove member error:', error);
    return res.status(500).json({ error: 'Failed to remove member' });
  }
});

// ─── Update member role ──────────────────────────────────────────
router.put('/:orgId/members/:memberId/role', authenticate, async (req, res) => {
  try {
    const { orgId, memberId } = req.params;
    const { role } = req.body;

    if (!['admin', 'member'].includes(role)) {
      return res.status(400).json({ error: 'Role must be admin or member' });
    }

    const membership = await organizationsDal.getMembership(orgId, req.user.id);
    if (!membership || membership.role !== 'owner') {
      return res.status(403).json({ error: 'Only owners can change member roles' });
    }

    const members = await organizationsDal.listMembers(orgId);
    const target = members.find(m => m.id === memberId);
    if (!target) return res.status(404).json({ error: 'Member not found' });
    if (target.role === 'owner') return res.status(400).json({ error: 'Cannot change owner role' });

    const updated = await organizationsDal.updateMemberRole(orgId, memberId, role);
    return res.json({ id: updated.id, role: updated.role });
  } catch (error) {
    await logger.error('Update role error:', error);
    return res.status(500).json({ error: 'Failed to update role' });
  }
});

// ─── List org plans ──────────────────────────────────────────────
router.get('/:id/plans', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const membership = await organizationsDal.getMembership(id, req.user.id);
    if (!membership) return res.status(403).json({ error: 'Access denied' });

    const orgPlans = await organizationsDal.listPlans(id);
    return res.json({ plans: orgPlans });
  } catch (error) {
    await logger.error('List org plans error:', error);
    return res.status(500).json({ error: 'Failed to list organization plans' });
  }
});

// ─── Create personal org (exported for auth) ─────────────────────
async function createPersonalOrganization(userId, userName, userEmail) {
  try {
    const name = `${userName || userEmail.split('@')[0]}'s Workspace`;
    const slug = `personal-${userId.substring(0, 8)}`;

    const org = await organizationsDal.create({
      name, slug, description: 'Personal workspace', isPersonal: true,
    });
    await organizationsDal.addMember(org.id, userId, 'owner');
    return org;
  } catch (error) {
    await logger.error('Create personal org error:', error);
    return null;
  }
}

module.exports = router;
module.exports.createPersonalOrganization = createPersonalOrganization;
