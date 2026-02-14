/**
 * Share Routes - using DAL layer
 */

const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth.middleware');
const { plansDal, usersDal, collaboratorsDal, invitesDal } = require('../db/dal.cjs');
const { sendPlanInviteEmail, sendCollaboratorAddedEmail, sendInviteAcceptedEmail } = require('../services/email');
const logger = require('../utils/logger');

// ─── Share plan by email ─────────────────────────────────────────
router.post('/:id/share', authenticate, async (req, res) => {
  try {
    const { id: planId } = req.params;
    const { email, role = 'viewer' } = req.body;
    const userId = req.user.id;

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: 'Valid email address required' });
    }
    if (!['viewer', 'editor', 'admin'].includes(role)) {
      return res.status(400).json({ error: 'Role must be viewer, editor, or admin' });
    }

    const { hasAccess, role: userRole, plan } = await plansDal.userHasAccess(planId, userId);
    if (!plan) return res.status(404).json({ error: 'Plan not found' });
    if (userRole !== 'owner' && userRole !== 'admin') {
      return res.status(403).json({ error: 'Only plan owners and admins can share' });
    }

    const inviter = await usersDal.findById(userId);
    const inviterName = inviter?.name || inviter?.email || 'Someone';

    // Check if email belongs to existing user
    const existingUser = await usersDal.findByEmail(email.toLowerCase());

    if (existingUser) {
      // Check if already a collaborator
      const existingCollab = await collaboratorsDal.isCollaborator(planId, existingUser.id);
      if (existingCollab) {
        return res.status(400).json({ error: 'User is already a collaborator', type: 'existing_collaborator' });
      }
      if (existingUser.id === plan.ownerId) {
        return res.status(400).json({ error: 'Cannot invite the plan owner', type: 'is_owner' });
      }

      await collaboratorsDal.add(planId, existingUser.id, role);

      await sendCollaboratorAddedEmail({ to: email, inviterName, planTitle: plan.title, planId: plan.id, role });

      return res.json({
        success: true, message: 'User added as collaborator', type: 'existing_user',
        collaborator: { user_id: existingUser.id, email: existingUser.email, role }
      });
    }

    // User doesn't exist - create pending invite
    const existingInvite = await invitesDal.findByPlanAndEmail(planId, email);
    if (existingInvite) {
      return res.status(400).json({ error: 'An invitation has already been sent', type: 'existing_invite', invited_at: existingInvite.createdAt });
    }

    const invite = await invitesDal.create({
      planId, email: email.toLowerCase(), role, invitedBy: userId
    });

    const emailResult = await sendPlanInviteEmail({
      to: email, inviterName, planTitle: plan.title, planId: plan.id, role, token: invite.id
    });

    return res.json({
      success: true, message: 'Invitation sent', type: 'new_invite',
      invite: { id: invite.id, email: invite.email, role: invite.role, expires_at: invite.expiresAt, email_sent: emailResult.success }
    });
  } catch (error) {
    await logger.error('Share plan error:', error);
    return res.status(500).json({ error: 'Failed to share plan' });
  }
});

// ─── List pending invites ────────────────────────────────────────
router.get('/:id/invites', authenticate, async (req, res) => {
  try {
    const { id: planId } = req.params;
    const userId = req.user.id;

    const { role: userRole, plan } = await plansDal.userHasAccess(planId, userId);
    if (!plan) return res.status(404).json({ error: 'Plan not found' });
    if (userRole !== 'owner' && userRole !== 'admin') {
      return res.status(403).json({ error: 'Access denied' });
    }

    const invites = await invitesDal.listByPlan(planId);

    return res.json({
      invites: invites.map(inv => ({
        id: inv.id, email: inv.email, role: inv.role,
        created_at: inv.createdAt, expires_at: inv.expiresAt
      }))
    });
  } catch (error) {
    await logger.error('List invites error:', error);
    return res.status(500).json({ error: 'Failed to list invites' });
  }
});

// ─── Revoke invite ───────────────────────────────────────────────
router.delete('/:planId/invites/:inviteId', authenticate, async (req, res) => {
  try {
    const { planId, inviteId } = req.params;
    const userId = req.user.id;

    const { role: userRole, plan } = await plansDal.userHasAccess(planId, userId);
    if (!plan) return res.status(404).json({ error: 'Plan not found' });
    if (userRole !== 'owner' && userRole !== 'admin') {
      return res.status(403).json({ error: 'Access denied' });
    }

    await invitesDal.deleteByPlanAndId(planId, inviteId);
    return res.json({ success: true, message: 'Invitation revoked' });
  } catch (error) {
    await logger.error('Revoke invite error:', error);
    return res.status(500).json({ error: 'Failed to revoke invite' });
  }
});

// ─── Accept invite ───────────────────────────────────────────────
router.post('/accept/:token', authenticate, async (req, res) => {
  try {
    const { token } = req.params;
    const userId = req.user.id;

    const user = await usersDal.findById(userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const invite = await invitesDal.findByToken(token);
    if (!invite) return res.status(404).json({ error: 'Invalid or expired invitation' });
    if (invite.expiresAt && new Date(invite.expiresAt) < new Date()) {
      return res.status(400).json({ error: 'This invitation has expired' });
    }
    if (invite.email.toLowerCase() !== user.email.toLowerCase()) {
      return res.status(403).json({ error: 'This invitation was sent to a different email address' });
    }

    await collaboratorsDal.add(invite.planId, userId, invite.role);
    await invitesDal.delete(invite.id);

    const plan = await plansDal.findById(invite.planId);

    return res.json({
      success: true, message: 'Invitation accepted',
      plan: { id: invite.planId, title: plan?.title, role: invite.role }
    });
  } catch (error) {
    await logger.error('Accept invite error:', error);
    return res.status(500).json({ error: 'Failed to accept invitation' });
  }
});

// ─── Get invite info ─────────────────────────────────────────────
router.get('/info/:token', async (req, res) => {
  try {
    const { token } = req.params;
    const invite = await invitesDal.findByToken(token);
    if (!invite) return res.status(404).json({ error: 'Invalid or expired invitation' });
    if (invite.expiresAt && new Date(invite.expiresAt) < new Date()) {
      return res.status(400).json({ error: 'This invitation has expired' });
    }

    const plan = await plansDal.findById(invite.planId);
    const inviter = await usersDal.findById(invite.invitedBy);

    return res.json({
      email: invite.email, role: invite.role, expires_at: invite.expiresAt,
      plan_title: plan?.title, invited_by: inviter?.name || inviter?.email || 'Someone'
    });
  } catch (error) {
    await logger.error('Get invite info error:', error);
    return res.status(500).json({ error: 'Failed to get invite details' });
  }
});

module.exports = router;
