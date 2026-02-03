/**
 * Organization Routes
 * 
 * Manage organizations, members, and org-scoped resources.
 */

const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth.middleware');
const { supabaseAdmin } = require('../config/supabase');
const logger = require('../utils/logger');

/**
 * @swagger
 * /organizations:
 *   get:
 *     summary: List user's organizations
 *     tags: [Organizations]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of organizations
 */
router.get('/', authenticate, async (req, res) => {
  try {
    const userId = req.user.id;

    const { data: memberships, error } = await supabaseAdmin
      .from('organization_members')
      .select(`
        role,
        joined_at,
        organizations (
          id,
          name,
          slug,
          description,
          is_personal,
          avatar_url,
          created_at
        )
      `)
      .eq('user_id', userId)
      .order('joined_at', { ascending: true });

    if (error) {
      await logger.error('Failed to fetch organizations:', error);
      return res.status(500).json({ error: 'Failed to fetch organizations' });
    }

    const organizations = memberships.map(m => ({
      ...m.organizations,
      role: m.role,
      joined_at: m.joined_at
    }));

    return res.json({ organizations });

  } catch (error) {
    await logger.error('List organizations error:', error);
    return res.status(500).json({ error: 'Failed to list organizations' });
  }
});

/**
 * @swagger
 * /organizations/{id}:
 *   get:
 *     summary: Get organization details
 *     tags: [Organizations]
 *     security:
 *       - bearerAuth: []
 */
router.get('/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    // Check membership
    const { data: membership } = await supabaseAdmin
      .from('organization_members')
      .select('role')
      .eq('organization_id', id)
      .eq('user_id', userId)
      .single();

    if (!membership) {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Get org details
    const { data: org, error } = await supabaseAdmin
      .from('organizations')
      .select('*')
      .eq('id', id)
      .single();

    if (error || !org) {
      return res.status(404).json({ error: 'Organization not found' });
    }

    // Get member count
    const { count: memberCount } = await supabaseAdmin
      .from('organization_members')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', id);

    // Get plan count
    const { count: planCount } = await supabaseAdmin
      .from('plans')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', id);

    return res.json({
      ...org,
      role: membership.role,
      member_count: memberCount || 0,
      plan_count: planCount || 0
    });

  } catch (error) {
    await logger.error('Get organization error:', error);
    return res.status(500).json({ error: 'Failed to get organization' });
  }
});

/**
 * @swagger
 * /organizations:
 *   post:
 *     summary: Create organization
 *     tags: [Organizations]
 *     security:
 *       - bearerAuth: []
 */
router.post('/', authenticate, async (req, res) => {
  try {
    const { name, description, slug } = req.body;
    const userId = req.user.id;

    if (!name) {
      return res.status(400).json({ error: 'Name is required' });
    }

    // Generate slug if not provided
    const orgSlug = slug || generateSlug(name);

    // Check slug uniqueness
    const { data: existing } = await supabaseAdmin
      .from('organizations')
      .select('id')
      .eq('slug', orgSlug)
      .single();

    if (existing) {
      return res.status(400).json({ error: 'Organization slug already exists' });
    }

    // Create organization
    const { data: org, error: orgError } = await supabaseAdmin
      .from('organizations')
      .insert({
        name,
        slug: orgSlug,
        description: description || '',
        is_personal: false
      })
      .select()
      .single();

    if (orgError) {
      await logger.error('Failed to create organization:', orgError);
      return res.status(500).json({ error: 'Failed to create organization' });
    }

    // Add creator as owner
    const { error: memberError } = await supabaseAdmin
      .from('organization_members')
      .insert({
        organization_id: org.id,
        user_id: userId,
        role: 'owner'
      });

    if (memberError) {
      await logger.error('Failed to add owner to organization:', memberError);
      // Rollback org creation
      await supabaseAdmin.from('organizations').delete().eq('id', org.id);
      return res.status(500).json({ error: 'Failed to create organization' });
    }

    await logger.api(`Organization created: ${org.id} by user ${userId}`);

    return res.status(201).json({
      ...org,
      role: 'owner'
    });

  } catch (error) {
    await logger.error('Create organization error:', error);
    return res.status(500).json({ error: 'Failed to create organization' });
  }
});

/**
 * @swagger
 * /organizations/{id}:
 *   put:
 *     summary: Update organization
 *     tags: [Organizations]
 *     security:
 *       - bearerAuth: []
 */
router.put('/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, avatar_url } = req.body;
    const userId = req.user.id;

    // Check ownership
    const { data: membership } = await supabaseAdmin
      .from('organization_members')
      .select('role')
      .eq('organization_id', id)
      .eq('user_id', userId)
      .single();

    if (!membership || membership.role !== 'owner') {
      return res.status(403).json({ error: 'Only owners can update organization' });
    }

    const updates = { updated_at: new Date().toISOString() };
    if (name !== undefined) updates.name = name;
    if (description !== undefined) updates.description = description;
    if (avatar_url !== undefined) updates.avatar_url = avatar_url;

    const { data: org, error } = await supabaseAdmin
      .from('organizations')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      await logger.error('Failed to update organization:', error);
      return res.status(500).json({ error: 'Failed to update organization' });
    }

    return res.json(org);

  } catch (error) {
    await logger.error('Update organization error:', error);
    return res.status(500).json({ error: 'Failed to update organization' });
  }
});

/**
 * @swagger
 * /organizations/{id}:
 *   delete:
 *     summary: Delete organization
 *     tags: [Organizations]
 *     security:
 *       - bearerAuth: []
 */
router.delete('/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    // Get org and check ownership
    const { data: org } = await supabaseAdmin
      .from('organizations')
      .select('is_personal')
      .eq('id', id)
      .single();

    if (!org) {
      return res.status(404).json({ error: 'Organization not found' });
    }

    if (org.is_personal) {
      return res.status(400).json({ error: 'Cannot delete personal organization' });
    }

    const { data: membership } = await supabaseAdmin
      .from('organization_members')
      .select('role')
      .eq('organization_id', id)
      .eq('user_id', userId)
      .single();

    if (!membership || membership.role !== 'owner') {
      return res.status(403).json({ error: 'Only owners can delete organization' });
    }

    // Delete organization (cascade deletes members)
    const { error } = await supabaseAdmin
      .from('organizations')
      .delete()
      .eq('id', id);

    if (error) {
      await logger.error('Failed to delete organization:', error);
      return res.status(500).json({ error: 'Failed to delete organization' });
    }

    await logger.api(`Organization deleted: ${id}`);

    return res.json({ success: true, message: 'Organization deleted' });

  } catch (error) {
    await logger.error('Delete organization error:', error);
    return res.status(500).json({ error: 'Failed to delete organization' });
  }
});

/**
 * @swagger
 * /organizations/{id}/members:
 *   get:
 *     summary: List organization members
 *     tags: [Organizations]
 *     security:
 *       - bearerAuth: []
 */
router.get('/:id/members', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    // Check membership
    const { data: membership } = await supabaseAdmin
      .from('organization_members')
      .select('role')
      .eq('organization_id', id)
      .eq('user_id', userId)
      .single();

    if (!membership) {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Get members
    const { data: members, error } = await supabaseAdmin
      .from('organization_members')
      .select(`
        id,
        role,
        joined_at,
        users (
          id,
          email,
          name,
          github_username,
          github_avatar_url
        )
      `)
      .eq('organization_id', id)
      .order('joined_at', { ascending: true });

    if (error) {
      await logger.error('Failed to fetch members:', error);
      return res.status(500).json({ error: 'Failed to fetch members' });
    }

    return res.json({
      members: members.map(m => ({
        id: m.id,
        role: m.role,
        joined_at: m.joined_at,
        user: m.users
      }))
    });

  } catch (error) {
    await logger.error('List members error:', error);
    return res.status(500).json({ error: 'Failed to list members' });
  }
});

/**
 * @swagger
 * /organizations/{id}/members:
 *   post:
 *     summary: Add member to organization
 *     tags: [Organizations]
 *     security:
 *       - bearerAuth: []
 */
router.post('/:id/members', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const { user_id, email, role = 'member' } = req.body;
    const userId = req.user.id;

    // Check admin/owner access
    const { data: membership } = await supabaseAdmin
      .from('organization_members')
      .select('role')
      .eq('organization_id', id)
      .eq('user_id', userId)
      .single();

    if (!membership || !['owner', 'admin'].includes(membership.role)) {
      return res.status(403).json({ error: 'Only owners and admins can add members' });
    }

    // Can't add owners (only one owner per org)
    if (role === 'owner') {
      return res.status(400).json({ error: 'Cannot add additional owners' });
    }

    // Find user by ID or email
    let targetUserId = user_id;
    if (!targetUserId && email) {
      const { data: user } = await supabaseAdmin
        .from('users')
        .select('id')
        .eq('email', email.toLowerCase())
        .single();
      
      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }
      targetUserId = user.id;
    }

    if (!targetUserId) {
      return res.status(400).json({ error: 'user_id or email required' });
    }

    // Check if already a member
    const { data: existingMember } = await supabaseAdmin
      .from('organization_members')
      .select('id')
      .eq('organization_id', id)
      .eq('user_id', targetUserId)
      .single();

    if (existingMember) {
      return res.status(400).json({ error: 'User is already a member' });
    }

    // Add member
    const { data: newMember, error } = await supabaseAdmin
      .from('organization_members')
      .insert({
        organization_id: id,
        user_id: targetUserId,
        role
      })
      .select(`
        id,
        role,
        joined_at,
        users (id, email, name)
      `)
      .single();

    if (error) {
      await logger.error('Failed to add member:', error);
      return res.status(500).json({ error: 'Failed to add member' });
    }

    await logger.api(`Member ${targetUserId} added to org ${id}`);

    return res.status(201).json({
      id: newMember.id,
      role: newMember.role,
      joined_at: newMember.joined_at,
      user: newMember.users
    });

  } catch (error) {
    await logger.error('Add member error:', error);
    return res.status(500).json({ error: 'Failed to add member' });
  }
});

/**
 * @swagger
 * /organizations/{orgId}/members/{memberId}:
 *   delete:
 *     summary: Remove member from organization
 *     tags: [Organizations]
 *     security:
 *       - bearerAuth: []
 */
router.delete('/:orgId/members/:memberId', authenticate, async (req, res) => {
  try {
    const { orgId, memberId } = req.params;
    const userId = req.user.id;

    // Check admin/owner access
    const { data: membership } = await supabaseAdmin
      .from('organization_members')
      .select('role')
      .eq('organization_id', orgId)
      .eq('user_id', userId)
      .single();

    if (!membership || !['owner', 'admin'].includes(membership.role)) {
      return res.status(403).json({ error: 'Only owners and admins can remove members' });
    }

    // Get target member
    const { data: targetMember } = await supabaseAdmin
      .from('organization_members')
      .select('role, user_id')
      .eq('id', memberId)
      .eq('organization_id', orgId)
      .single();

    if (!targetMember) {
      return res.status(404).json({ error: 'Member not found' });
    }

    // Can't remove owner
    if (targetMember.role === 'owner') {
      return res.status(400).json({ error: 'Cannot remove organization owner' });
    }

    // Admins can only remove regular members
    if (membership.role === 'admin' && targetMember.role === 'admin') {
      return res.status(403).json({ error: 'Admins cannot remove other admins' });
    }

    // Remove member
    const { error } = await supabaseAdmin
      .from('organization_members')
      .delete()
      .eq('id', memberId);

    if (error) {
      await logger.error('Failed to remove member:', error);
      return res.status(500).json({ error: 'Failed to remove member' });
    }

    await logger.api(`Member ${memberId} removed from org ${orgId}`);

    return res.json({ success: true, message: 'Member removed' });

  } catch (error) {
    await logger.error('Remove member error:', error);
    return res.status(500).json({ error: 'Failed to remove member' });
  }
});

/**
 * @swagger
 * /organizations/{orgId}/members/{memberId}/role:
 *   put:
 *     summary: Update member role
 *     tags: [Organizations]
 *     security:
 *       - bearerAuth: []
 */
router.put('/:orgId/members/:memberId/role', authenticate, async (req, res) => {
  try {
    const { orgId, memberId } = req.params;
    const { role } = req.body;
    const userId = req.user.id;

    if (!['admin', 'member'].includes(role)) {
      return res.status(400).json({ error: 'Role must be admin or member' });
    }

    // Only owners can change roles
    const { data: membership } = await supabaseAdmin
      .from('organization_members')
      .select('role')
      .eq('organization_id', orgId)
      .eq('user_id', userId)
      .single();

    if (!membership || membership.role !== 'owner') {
      return res.status(403).json({ error: 'Only owners can change member roles' });
    }

    // Get target member
    const { data: targetMember } = await supabaseAdmin
      .from('organization_members')
      .select('role')
      .eq('id', memberId)
      .eq('organization_id', orgId)
      .single();

    if (!targetMember) {
      return res.status(404).json({ error: 'Member not found' });
    }

    // Can't change owner role
    if (targetMember.role === 'owner') {
      return res.status(400).json({ error: 'Cannot change owner role' });
    }

    // Update role
    const { data: updated, error } = await supabaseAdmin
      .from('organization_members')
      .update({ role })
      .eq('id', memberId)
      .select()
      .single();

    if (error) {
      await logger.error('Failed to update role:', error);
      return res.status(500).json({ error: 'Failed to update role' });
    }

    return res.json({ id: updated.id, role: updated.role });

  } catch (error) {
    await logger.error('Update role error:', error);
    return res.status(500).json({ error: 'Failed to update role' });
  }
});

/**
 * Helper: Generate URL-safe slug from name
 */
function generateSlug(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, 50);
}

/**
 * Create personal organization for a user
 * Called from auth controller on signup
 */
async function createPersonalOrganization(userId, userName, userEmail) {
  try {
    const name = `${userName || userEmail.split('@')[0]}'s Workspace`;
    // Use full UUID to avoid collisions at scale
    const slug = `personal-${userId}`;

    const { data: org, error: orgError } = await supabaseAdmin
      .from('organizations')
      .insert({
        name,
        slug,
        description: 'Personal workspace',
        is_personal: true
      })
      .select()
      .single();

    if (orgError) {
      await logger.error('Failed to create personal org:', orgError);
      return null;
    }

    const { error: memberError } = await supabaseAdmin
      .from('organization_members')
      .insert({
        organization_id: org.id,
        user_id: userId,
        role: 'owner'
      });

    if (memberError) {
      await logger.error('Failed to add user to personal org:', memberError);
      await supabaseAdmin.from('organizations').delete().eq('id', org.id);
      return null;
    }

    await logger.api(`Personal organization created for user ${userId}`);
    return org;

  } catch (error) {
    await logger.error('Create personal org error:', error);
    return null;
  }
}

module.exports = router;
module.exports.createPersonalOrganization = createPersonalOrganization;
