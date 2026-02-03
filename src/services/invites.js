/**
 * Invite Service
 * 
 * Handles converting pending invites to collaborators when users sign up or log in.
 */

const { supabaseAdmin } = require('../config/supabase');
const logger = require('../utils/logger');
const { sendInviteAcceptedEmail } = require('./email');

/**
 * Convert pending invites to collaborators for a user
 * Called after successful registration or first login
 * 
 * @param {string} userId - The user's ID
 * @param {string} userEmail - The user's email address
 * @param {string} userName - The user's name (optional)
 * @returns {Promise<{converted: number, invites: Array}>}
 */
const convertPendingInvites = async (userId, userEmail, userName) => {
  try {
    if (!userEmail) {
      return { converted: 0, invites: [] };
    }

    // Find all pending invites for this email
    const { data: pendingInvites, error: fetchError } = await supabaseAdmin
      .from('pending_invites')
      .select(`
        id,
        plan_id,
        role,
        invited_by,
        plans(id, title),
        users!pending_invites_invited_by_fkey(email, name)
      `)
      .eq('email', userEmail.toLowerCase())
      .gt('expires_at', new Date().toISOString());

    if (fetchError) {
      await logger.error('Failed to fetch pending invites:', fetchError);
      return { converted: 0, invites: [], error: fetchError.message };
    }

    if (!pendingInvites || pendingInvites.length === 0) {
      return { converted: 0, invites: [] };
    }

    await logger.api(`Found ${pendingInvites.length} pending invites for ${userEmail}`);

    const convertedInvites = [];

    for (const invite of pendingInvites) {
      try {
        // Check if already a collaborator (shouldn't happen, but safety check)
        const { data: existingCollab } = await supabaseAdmin
          .from('plan_collaborators')
          .select('id')
          .eq('plan_id', invite.plan_id)
          .eq('user_id', userId)
          .single();

        if (existingCollab) {
          await logger.api(`User ${userEmail} already collaborator on plan ${invite.plan_id}, skipping`);
          continue;
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
          await logger.error(`Failed to convert invite for plan ${invite.plan_id}:`, collabError);
          continue;
        }

        // Delete the pending invite
        await supabaseAdmin
          .from('pending_invites')
          .delete()
          .eq('id', invite.id);

        convertedInvites.push({
          plan_id: invite.plan_id,
          plan_title: invite.plans?.title,
          role: invite.role
        });

        // Notify the inviter
        if (invite.users?.email) {
          await sendInviteAcceptedEmail({
            to: invite.users.email,
            accepterName: userName || userEmail,
            planTitle: invite.plans?.title || 'Unknown Plan',
            planId: invite.plan_id
          });
        }

        await logger.api(`Converted invite: ${userEmail} -> plan ${invite.plan_id} as ${invite.role}`);

      } catch (inviteError) {
        await logger.error(`Error converting invite ${invite.id}:`, inviteError);
      }
    }

    return {
      converted: convertedInvites.length,
      invites: convertedInvites
    };

  } catch (error) {
    await logger.error('Error in convertPendingInvites:', error);
    return { converted: 0, invites: [], error: error.message };
  }
};

/**
 * Clean up expired invites
 * Can be called periodically (e.g., daily cron job)
 */
const cleanupExpiredInvites = async () => {
  try {
    const { data, error } = await supabaseAdmin
      .from('pending_invites')
      .delete()
      .lt('expires_at', new Date().toISOString())
      .select('id');

    if (error) {
      await logger.error('Failed to cleanup expired invites:', error);
      return { deleted: 0, error: error.message };
    }

    const deletedCount = data?.length || 0;
    if (deletedCount > 0) {
      await logger.api(`Cleaned up ${deletedCount} expired invites`);
    }

    return { deleted: deletedCount };

  } catch (error) {
    await logger.error('Error in cleanupExpiredInvites:', error);
    return { deleted: 0, error: error.message };
  }
};

module.exports = {
  convertPendingInvites,
  cleanupExpiredInvites
};
