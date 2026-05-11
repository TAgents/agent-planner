/**
 * Personal scope helper — ensures every user has at least one org + workspace.
 *
 * Used by:
 *   - auth.controller.register (after a successful signup)
 *   - scripts/backfill-personal-workspaces.mjs (for existing org-less users)
 *
 * Idempotent: if the user already belongs to any org, this is a no-op.
 * Naming follows the same rules in both call sites:
 *   - org name = user.name || email local part
 *   - org slug = `personal-${user.id.slice(0, 8)}`
 *   - workspace title = 'Default' (slug 'default'), is_default=true
 *
 * Failures are non-fatal for signup — we log and return null so registration
 * still succeeds even if the personal-scope provisioning hiccups. The
 * standalone backfill script can fill in any gaps later.
 */
const dal = require('../db/dal.cjs');
const logger = require('../utils/logger');

function deriveOrgName(user) {
  if (user.name && user.name.trim()) return user.name.trim();
  const local = (user.email || '').split('@')[0] || 'personal';
  return local;
}

/**
 * Provision a personal org + Default workspace for the given user if
 * they don't already belong to one. Returns { orgId, workspaceId } on
 * create, null when skipped or on (logged) failure.
 */
async function ensurePersonalScope(user) {
  try {
    // Skip if user is already in any org — caller stays in that org.
    const existingMemberships = await dal.organizationsDal.listForUser(user.id);
    if (existingMemberships && existingMemberships.length > 0) return null;

    const orgSlug = `personal-${user.id.slice(0, 8)}`;
    const orgName = deriveOrgName(user);

    // Re-attach if a prior partial run created the org but not the workspace.
    let org = await dal.organizationsDal.findBySlug(orgSlug);
    if (!org) {
      org = await dal.organizationsDal.create({
        name: orgName,
        slug: orgSlug,
        isPersonal: true,
        description: 'Personal workspace.',
      });
    }

    await dal.organizationsDal.addMember(org.id, user.id, 'owner');

    // Workspace creation through the DAL (idempotent on unique slug per org).
    const existing = await dal.workspacesDal.findBySlug(org.id, 'default');
    const workspace = existing ?? await dal.workspacesDal.create({
      organizationId: org.id,
      ownerId: user.id,
      title: 'Default',
      slug: 'default',
      isDefault: true,
      description: 'Default workspace — created with your account.',
    });

    await logger.auth(`Personal scope provisioned for ${user.email}: org=${org.id} ws=${workspace.id}`);
    return { orgId: org.id, workspaceId: workspace.id };
  } catch (err) {
    // Soft failure — log and let signup continue. The standalone backfill
    // can mop up any missed users later.
    await logger.error(`ensurePersonalScope failed for ${user.email}: ${err.message}`);
    return null;
  }
}

module.exports = { ensurePersonalScope };
