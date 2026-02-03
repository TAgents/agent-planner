/**
 * Share Routes
 * 
 * Handle sharing plans by email address.
 * Supports both existing users and new invites.
 */

const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth.middleware');
const { supabaseAdmin } = require('../config/supabase');
const { sendPlanInviteEmail, sendCollaboratorAddedEmail, sendInviteAcceptedEmail } = require('../services/email');
const logger = require('../utils/logger');

/**
 * @swagger
 * /plans/{id}/share:
 *   post:
 *     summary: Share plan by email
 *     description: Share a plan with a user by email address. Creates a pending invite if user doesn't exist.
 *     tags: [Sharing]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Plan ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *               role:
 *                 type: string
 *                 enum: [viewer, editor, admin]
 *                 default: viewer
 *     responses:
 *       200:
 *         description: Share successful
 *       400:
 *         description: Invalid request
 *       403:
 *         description: Not authorized to share this plan
 *       404:
 *         description: Plan not found
 */
router.post('/:id/share', authenticate, async (req, res) => {
  try {
    const { id: planId } = req.params;
    const { email, role = 'viewer' } = req.body;
    const userId = req.user.id;

    // Validate email
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: 'Valid email address required' });
    }

    // Validate role
    if (!['viewer', 'editor', 'admin'].includes(role)) {
      return res.status(400).json({ error: 'Role must be viewer, editor, or admin' });
    }

    // Get plan and verify ownership/admin rights
    const { data: plan, error: planError } = await supabaseAdmin
      .from('plans')
      .select('id, title, owner_id')
      .eq('id', planId)
      .single();

    if (planError || !plan) {
      return res.status(404).json({ error: 'Plan not found' });
    }

    // Check if user can share (owner or admin collaborator)
    const isOwner = plan.owner_id === userId;
    
    if (!isOwner) {
      const { data: collab } = await supabaseAdmin
        .from('plan_collaborators')
        .select('role')
        .eq('plan_id', planId)
        .eq('user_id', userId)
        .single();
      
      if (!collab || collab.role !== 'admin') {
        return res.status(403).json({ error: 'Only plan owners and admins can share' });
      }
    }

    // Get inviter info
    const { data: inviter } = await supabaseAdmin
      .from('users')
      .select('name, email')
      .eq('id', userId)
      .single();

    const inviterName = inviter?.name || inviter?.email || 'Someone';

    // Check if email belongs to existing user
    const { data: existingUser } = await supabaseAdmin
      .from('users')
      .select('id, email')
      .eq('email', email.toLowerCase())
      .single();

    if (existingUser) {
      // User exists - add as collaborator directly
      
      // Check if already a collaborator
      const { data: existingCollab } = await supabaseAdmin
        .from('plan_collaborators')
        .select('id')
        .eq('plan_id', planId)
        .eq('user_id', existingUser.id)
        .single();

      if (existingCollab) {
        return res.status(400).json({ 
          error: 'User is already a collaborator on this plan',
          type: 'existing_collaborator'
        });
      }

      // Check if user is the owner
      if (existingUser.id === plan.owner_id) {
        return res.status(400).json({ 
          error: 'Cannot invite the plan owner',
          type: 'is_owner'
        });
      }

      // Add as collaborator
      const { error: collabError } = await supabaseAdmin
        .from('plan_collaborators')
        .insert({
          plan_id: planId,
          user_id: existingUser.id,
          role: role,
          added_by: userId
        });

      if (collabError) {
        await logger.error('Failed to add collaborator:', collabError);
        return res.status(500).json({ error: 'Failed to add collaborator' });
      }

      // Send notification email (different template for existing users - no invite token)
      await sendCollaboratorAddedEmail({
        to: email,
        inviterName,
        planTitle: plan.title,
        planId: plan.id,
        role
      });

      await logger.api(`User ${email} added as ${role} to plan ${planId}`);

      return res.json({
        success: true,
        message: 'User added as collaborator',
        type: 'existing_user',
        collaborator: {
          user_id: existingUser.id,
          email: existingUser.email,
          role
        }
      });
    }

    // User doesn't exist - create pending invite
    
    // Check for existing pending invite
    const { data: existingInvite } = await supabaseAdmin
      .from('pending_invites')
      .select('id, created_at')
      .eq('plan_id', planId)
      .eq('email', email.toLowerCase())
      .single();

    if (existingInvite) {
      return res.status(400).json({ 
        error: 'An invitation has already been sent to this email',
        type: 'existing_invite',
        invited_at: existingInvite.created_at
      });
    }

    // Create pending invite
    const { data: invite, error: inviteError } = await supabaseAdmin
      .from('pending_invites')
      .insert({
        plan_id: planId,
        email: email.toLowerCase(),
        role,
        invited_by: userId
      })
      .select()
      .single();

    if (inviteError) {
      await logger.error('Failed to create invite:', inviteError);
      return res.status(500).json({ error: 'Failed to create invitation' });
    }

    // Send invitation email
    const emailResult = await sendPlanInviteEmail({
      to: email,
      inviterName,
      planTitle: plan.title,
      planId: plan.id,
      role,
      token: invite.token
    });

    await logger.api(`Invitation sent to ${email} for plan ${planId}`);

    return res.json({
      success: true,
      message: 'Invitation sent',
      type: 'new_invite',
      invite: {
        id: invite.id,
        email: invite.email,
        role: invite.role,
        expires_at: invite.expires_at,
        email_sent: emailResult.success
      }
    });

  } catch (error) {
    await logger.error('Share plan error:', error);
    return res.status(500).json({ error: 'Failed to share plan' });
  }
});

/**
 * @swagger
 * /plans/{id}/invites:
 *   get:
 *     summary: List pending invites
 *     description: Get all pending invitations for a plan
 *     tags: [Sharing]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: List of pending invites
 */
router.get('/:id/invites', authenticate, async (req, res) => {
  try {
    const { id: planId } = req.params;
    const userId = req.user.id;

    // Verify access to plan
    const { data: plan } = await supabaseAdmin
      .from('plans')
      .select('id, owner_id')
      .eq('id', planId)
      .single();

    if (!plan) {
      return res.status(404).json({ error: 'Plan not found' });
    }

    const isOwner = plan.owner_id === userId;
    
    if (!isOwner) {
      const { data: collab } = await supabaseAdmin
        .from('plan_collaborators')
        .select('role')
        .eq('plan_id', planId)
        .eq('user_id', userId)
        .single();
      
      if (!collab || collab.role !== 'admin') {
        return res.status(403).json({ error: 'Access denied' });
      }
    }

    // Get pending invites
    const { data: invites, error } = await supabaseAdmin
      .from('pending_invites')
      .select(`
        id,
        email,
        role,
        created_at,
        expires_at,
        invited_by,
        users!pending_invites_invited_by_fkey(name, email)
      `)
      .eq('plan_id', planId)
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false });

    if (error) {
      await logger.error('Failed to fetch invites:', error);
      return res.status(500).json({ error: 'Failed to fetch invites' });
    }

    return res.json({
      invites: invites.map(inv => ({
        id: inv.id,
        email: inv.email,
        role: inv.role,
        created_at: inv.created_at,
        expires_at: inv.expires_at,
        invited_by: inv.users?.name || inv.users?.email || 'Unknown'
      }))
    });

  } catch (error) {
    await logger.error('List invites error:', error);
    return res.status(500).json({ error: 'Failed to list invites' });
  }
});

/**
 * @swagger
 * /plans/{planId}/invites/{inviteId}:
 *   delete:
 *     summary: Revoke a pending invite
 *     description: Cancel a pending invitation
 *     tags: [Sharing]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: planId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *       - in: path
 *         name: inviteId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Invite revoked
 */
router.delete('/:planId/invites/:inviteId', authenticate, async (req, res) => {
  try {
    const { planId, inviteId } = req.params;
    const userId = req.user.id;

    // Verify access to plan
    const { data: plan } = await supabaseAdmin
      .from('plans')
      .select('id, owner_id')
      .eq('id', planId)
      .single();

    if (!plan) {
      return res.status(404).json({ error: 'Plan not found' });
    }

    const isOwner = plan.owner_id === userId;
    
    if (!isOwner) {
      const { data: collab } = await supabaseAdmin
        .from('plan_collaborators')
        .select('role')
        .eq('plan_id', planId)
        .eq('user_id', userId)
        .single();
      
      if (!collab || collab.role !== 'admin') {
        return res.status(403).json({ error: 'Access denied' });
      }
    }

    // Delete the invite
    const { error } = await supabaseAdmin
      .from('pending_invites')
      .delete()
      .eq('id', inviteId)
      .eq('plan_id', planId);

    if (error) {
      await logger.error('Failed to revoke invite:', error);
      return res.status(500).json({ error: 'Failed to revoke invite' });
    }

    await logger.api(`Invite ${inviteId} revoked for plan ${planId}`);

    return res.json({ success: true, message: 'Invitation revoked' });

  } catch (error) {
    await logger.error('Revoke invite error:', error);
    return res.status(500).json({ error: 'Failed to revoke invite' });
  }
});

/**
 * @swagger
 * /invites/{token}/accept:
 *   post:
 *     summary: Accept an invitation
 *     description: Accept a pending invitation using the invite token
 *     tags: [Sharing]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: token
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Invitation accepted
 */
router.post('/accept/:token', authenticate, async (req, res) => {
  try {
    const { token } = req.params;
    const userId = req.user.id;

    // Get user email
    const { data: user } = await supabaseAdmin
      .from('users')
      .select('id, email, name')
      .eq('id', userId)
      .single();

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Find the invite
    const { data: invite, error: inviteError } = await supabaseAdmin
      .from('pending_invites')
      .select(`
        id,
        plan_id,
        email,
        role,
        invited_by,
        expires_at,
        plans(id, title, owner_id),
        users!pending_invites_invited_by_fkey(email)
      `)
      .eq('token', token)
      .single();

    if (inviteError || !invite) {
      return res.status(404).json({ error: 'Invalid or expired invitation' });
    }

    // Check if invite is expired
    if (new Date(invite.expires_at) < new Date()) {
      return res.status(400).json({ error: 'This invitation has expired' });
    }

    // Verify email matches (case-insensitive)
    if (invite.email.toLowerCase() !== user.email.toLowerCase()) {
      return res.status(403).json({ 
        error: 'This invitation was sent to a different email address',
        invited_email: invite.email
      });
    }

    // Add as collaborator
    const { error: collabError } = await supabaseAdmin
      .from('plan_collaborators')
      .insert({
        plan_id: invite.plan_id,
        user_id: userId,
        role: invite.role,
        added_by: invite.invited_by
      });

    if (collabError) {
      // Check if already a collaborator
      if (collabError.code === '23505') { // Unique violation
        return res.status(400).json({ error: 'You are already a collaborator on this plan' });
      }
      await logger.error('Failed to add collaborator:', collabError);
      return res.status(500).json({ error: 'Failed to accept invitation' });
    }

    // Delete the invite
    await supabaseAdmin
      .from('pending_invites')
      .delete()
      .eq('id', invite.id);

    // Notify the inviter
    if (invite.users?.email) {
      await sendInviteAcceptedEmail({
        to: invite.users.email,
        accepterName: user.name || user.email,
        planTitle: invite.plans?.title || 'Unknown Plan',
        planId: invite.plan_id
      });
    }

    await logger.api(`User ${user.email} accepted invite to plan ${invite.plan_id}`);

    return res.json({
      success: true,
      message: 'Invitation accepted',
      plan: {
        id: invite.plan_id,
        title: invite.plans?.title,
        role: invite.role
      }
    });

  } catch (error) {
    await logger.error('Accept invite error:', error);
    return res.status(500).json({ error: 'Failed to accept invitation' });
  }
});

/**
 * @swagger
 * /invites/{token}:
 *   get:
 *     summary: Get invite details
 *     description: Get details about an invitation (public endpoint)
 *     tags: [Sharing]
 *     parameters:
 *       - in: path
 *         name: token
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Invite details
 */
router.get('/info/:token', async (req, res) => {
  try {
    const { token } = req.params;

    const { data: invite, error } = await supabaseAdmin
      .from('pending_invites')
      .select(`
        email,
        role,
        expires_at,
        plans(title),
        users!pending_invites_invited_by_fkey(name, email)
      `)
      .eq('token', token)
      .single();

    if (error || !invite) {
      return res.status(404).json({ error: 'Invalid or expired invitation' });
    }

    if (new Date(invite.expires_at) < new Date()) {
      return res.status(400).json({ error: 'This invitation has expired' });
    }

    return res.json({
      email: invite.email,
      role: invite.role,
      expires_at: invite.expires_at,
      plan_title: invite.plans?.title,
      invited_by: invite.users?.name || invite.users?.email || 'Someone'
    });

  } catch (error) {
    await logger.error('Get invite info error:', error);
    return res.status(500).json({ error: 'Failed to get invite details' });
  }
});

module.exports = router;
