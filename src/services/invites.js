/**
 * Invite Service - using DAL layer
 */

const { invitesDal, collaboratorsDal, plansDal, usersDal } = require('../db/dal.cjs');
const logger = require('../utils/logger');
const { sendInviteAcceptedEmail } = require('./email');

/**
 * Convert pending invites to collaborators for a user
 */
const convertPendingInvites = async (userId, userEmail, userName) => {
  try {
    if (!userEmail) return { converted: 0, invites: [] };

    const pendingInvites = await invitesDal.findPendingByEmail(userEmail);
    if (!pendingInvites || pendingInvites.length === 0) return { converted: 0, invites: [] };

    await logger.api(`Found ${pendingInvites.length} pending invites for ${userEmail}`);

    const convertedInvites = [];

    for (const invite of pendingInvites) {
      try {
        const existingCollab = await collaboratorsDal.isCollaborator(invite.planId, userId);
        if (existingCollab) continue;

        await collaboratorsDal.add(invite.planId, userId, invite.role);
        await invitesDal.delete(invite.id);

        const plan = await plansDal.findById(invite.planId);
        convertedInvites.push({
          plan_id: invite.planId,
          plan_title: plan?.title,
          role: invite.role
        });

        // Notify the inviter
        const inviter = await usersDal.findById(invite.invitedBy);
        if (inviter?.email) {
          await sendInviteAcceptedEmail({
            to: inviter.email,
            accepterName: userName || userEmail,
            planTitle: plan?.title || 'Unknown Plan',
            planId: invite.planId
          });
        }

        await logger.api(`Converted invite: ${userEmail} -> plan ${invite.planId} as ${invite.role}`);
      } catch (inviteError) {
        await logger.error(`Error converting invite ${invite.id}:`, inviteError);
      }
    }

    return { converted: convertedInvites.length, invites: convertedInvites };
  } catch (error) {
    await logger.error('Error in convertPendingInvites:', error);
    return { converted: 0, invites: [], error: error.message };
  }
};

/**
 * Clean up expired invites
 */
const cleanupExpiredInvites = async () => {
  try {
    const deletedCount = await invitesDal.deleteExpired();
    if (deletedCount > 0) {
      await logger.api(`Cleaned up ${deletedCount} expired invites`);
    }
    return { deleted: deletedCount };
  } catch (error) {
    await logger.error('Error in cleanupExpiredInvites:', error);
    return { deleted: 0, error: error.message };
  }
};

module.exports = { convertPendingInvites, cleanupExpiredInvites };
