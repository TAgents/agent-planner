/**
 * Migration script to create personal organizations for existing users
 * Uses direct SQL since organizations table is not in the DAL yet.
 * 
 * Run with: node src/db/fix-user-organizations.js
 */

require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const generateSlug = (name, suffix = '') => {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return suffix ? `${base}-${suffix}` : base;
};

const fixUserOrganizations = async () => {
  const client = await pool.connect();
  try {
    console.log('Starting user organization fix...\n');

    const { rows: users } = await client.query('SELECT id, email, name FROM users');
    console.log(`Found ${users.length} users\n`);

    const { rows: memberships } = await client.query('SELECT user_id, organization_id, role FROM organization_members');
    const { rows: personalOrgs } = await client.query("SELECT id, name, slug FROM organizations WHERE is_personal = true");
    const { rows: allOrgs } = await client.query('SELECT slug FROM organizations');

    const existingSlugs = new Set(allOrgs.map(o => o.slug));
    const userMembershipMap = new Map();
    for (const m of memberships) {
      if (!userMembershipMap.has(m.user_id)) userMembershipMap.set(m.user_id, []);
      userMembershipMap.get(m.user_id).push(m);
    }

    const usersNeedingOrgs = users.filter(user => {
      const userMemberships = userMembershipMap.get(user.id) || [];
      return !userMemberships.some(m => {
        const org = personalOrgs.find(o => o.id === m.organization_id);
        return org && m.role === 'owner';
      });
    });

    if (usersNeedingOrgs.length === 0) {
      console.log('✅ All users already have personal organizations!');
      return;
    }

    console.log(`Found ${usersNeedingOrgs.length} users without personal organizations\n`);

    let created = 0;
    for (const user of usersNeedingOrgs) {
      const displayName = user.name || user.email.split('@')[0];
      const orgName = `${displayName}'s Space`;

      let slug = generateSlug(displayName);
      let suffix = 1;
      while (existingSlugs.has(slug)) { slug = generateSlug(displayName, String(suffix++)); }
      existingSlugs.add(slug);

      try {
        const { rows: [newOrg] } = await client.query(
          `INSERT INTO organizations (name, slug, description, is_personal) VALUES ($1, $2, $3, true) RETURNING id`,
          [orgName, slug, `Personal workspace for ${displayName}`]
        );

        await client.query(
          `INSERT INTO organization_members (organization_id, user_id, role) VALUES ($1, $2, 'owner')`,
          [newOrg.id, user.id]
        );

        console.log(`  ✓ Created org for ${user.email}`);
        created++;
      } catch (e) {
        console.error(`  ❌ Failed for ${user.email}: ${e.message}`);
      }
    }

    console.log(`\n✅ Created: ${created} organizations`);
  } finally {
    client.release();
    await pool.end();
  }
};

fixUserOrganizations().then(() => process.exit(0)).catch(err => { console.error('Failed:', err); process.exit(1); });
