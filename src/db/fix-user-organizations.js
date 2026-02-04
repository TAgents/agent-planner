/**
 * Migration script to create personal organizations for existing users
 * 
 * Run with: node src/db/fix-user-organizations.js
 */

require('dotenv').config();
const { supabaseAdmin } = require('../config/supabase');

/**
 * Generate a unique slug from name
 */
const generateSlug = (name, suffix = '') => {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return suffix ? `${base}-${suffix}` : base;
};

/**
 * Create personal organizations for users who don't have one
 */
const fixUserOrganizations = async () => {
  try {
    console.log('Starting user organization fix...\n');

    // Get all users
    const { data: users, error: usersError } = await supabaseAdmin
      .from('users')
      .select('id, email, name');

    if (usersError) {
      console.error('Error fetching users:', usersError);
      process.exit(1);
    }

    console.log(`Found ${users.length} users in database\n`);

    // Get all organization memberships
    const { data: memberships, error: membershipsError } = await supabaseAdmin
      .from('organization_members')
      .select('user_id, organization_id, role');

    if (membershipsError) {
      console.error('Error fetching memberships:', membershipsError);
      process.exit(1);
    }

    // Get all personal orgs
    const { data: personalOrgs, error: orgsError } = await supabaseAdmin
      .from('organizations')
      .select('id, name, slug')
      .eq('is_personal', true);

    if (orgsError) {
      console.error('Error fetching organizations:', orgsError);
      process.exit(1);
    }

    console.log(`Found ${personalOrgs?.length || 0} existing personal organizations`);
    console.log(`Found ${memberships?.length || 0} organization memberships\n`);

    // Find users who don't have a personal org (as owner)
    const userMembershipMap = new Map();
    for (const m of memberships || []) {
      if (!userMembershipMap.has(m.user_id)) {
        userMembershipMap.set(m.user_id, []);
      }
      userMembershipMap.get(m.user_id).push(m);
    }

    const usersNeedingOrgs = [];
    for (const user of users) {
      const userMemberships = userMembershipMap.get(user.id) || [];
      
      // Check if user has any membership with owner role in a personal org
      const hasPersonalOrg = userMemberships.some(m => {
        const org = personalOrgs?.find(o => o.id === m.organization_id);
        return org && m.role === 'owner';
      });

      if (!hasPersonalOrg) {
        usersNeedingOrgs.push(user);
      }
    }

    if (usersNeedingOrgs.length === 0) {
      console.log('✅ All users already have personal organizations!');
      process.exit(0);
    }

    console.log(`Found ${usersNeedingOrgs.length} users without personal organizations:\n`);
    for (const user of usersNeedingOrgs) {
      console.log(`  - ${user.email} (${user.name || 'no name'})`);
    }
    console.log('');

    // Get existing slugs to avoid duplicates
    const { data: allOrgs } = await supabaseAdmin
      .from('organizations')
      .select('slug');
    const existingSlugs = new Set((allOrgs || []).map(o => o.slug));

    // Create personal organizations for users who need them
    let created = 0;
    let failed = 0;

    for (const user of usersNeedingOrgs) {
      const displayName = user.name || user.email.split('@')[0];
      const orgName = `${displayName}'s Space`;
      
      // Generate unique slug
      let slug = generateSlug(displayName);
      let suffix = 1;
      while (existingSlugs.has(slug)) {
        slug = generateSlug(displayName, String(suffix));
        suffix++;
      }
      existingSlugs.add(slug);

      console.log(`Creating organization for ${user.email}...`);
      console.log(`  Name: ${orgName}`);
      console.log(`  Slug: ${slug}`);

      // Create the organization
      const { data: newOrg, error: createError } = await supabaseAdmin
        .from('organizations')
        .insert({
          name: orgName,
          slug: slug,
          description: `Personal workspace for ${displayName}`,
          is_personal: true,
        })
        .select()
        .single();

      if (createError) {
        console.error(`  ❌ Failed to create org: ${createError.message}`);
        failed++;
        continue;
      }

      console.log(`  ✓ Created organization: ${newOrg.id}`);

      // Add user as owner
      const { error: memberError } = await supabaseAdmin
        .from('organization_members')
        .insert({
          organization_id: newOrg.id,
          user_id: user.id,
          role: 'owner',
        });

      if (memberError) {
        console.error(`  ❌ Failed to add membership: ${memberError.message}`);
        failed++;
        continue;
      }

      console.log(`  ✓ Added ${user.email} as owner\n`);
      created++;
    }

    console.log('='.repeat(50));
    console.log(`\nSummary:`);
    console.log(`  ✅ Successfully created: ${created} organizations`);
    if (failed > 0) {
      console.log(`  ❌ Failed: ${failed}`);
    }
    console.log('');

  } catch (error) {
    console.error('Unexpected error:', error);
    process.exit(1);
  }
};

// Run the fix
fixUserOrganizations().then(() => {
  console.log('Done!');
  process.exit(0);
}).catch(err => {
  console.error('Failed:', err);
  process.exit(1);
});
