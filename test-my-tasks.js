const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY;

console.log('Testing against:', supabaseUrl);

const supabase = createClient(supabaseUrl, supabaseKey);

async function testQuery() {
  // Get any user from auth
  console.log('\nGetting users...');
  const { data: authUsers, error: authErr } = await supabase.auth.admin.listUsers();
  
  if (authErr || !authUsers?.users?.length) {
    console.log('No users found, creating test data...');
    
    // Create a test user
    const { data: newUser, error: createErr } = await supabase.auth.admin.createUser({
      email: 'test@example.com',
      password: 'testpassword123',
      email_confirm: true
    });
    
    if (createErr) {
      console.error('Could not create user:', createErr);
      return;
    }
    console.log('Created user:', newUser.user.id);
  }
  
  const userId = authUsers?.users?.[0]?.id;
  console.log('Using user ID:', userId);
  
  // Check plans table
  console.log('\n--- Checking plans table ---');
  const { data: plans, error: planErr } = await supabase
    .from('plans')
    .select('id, title, owner_id')
    .limit(5);
  
  console.log('Plans error:', planErr?.message);
  console.log('Plans count:', plans?.length);
  
  if (plans?.length > 0) {
    console.log('Sample plan:', JSON.stringify(plans[0], null, 2));
    
    const planIds = plans.map(p => p.id);
    
    // Test query WITH join
    console.log('\n--- Testing query WITH plans!inner join ---');
    const { data: tasks1, error: err1 } = await supabase
      .from('plan_nodes')
      .select(`
        id, title, node_type, status, plan_id,
        plans!inner(id, title)
      `)
      .in('plan_id', planIds)
      .limit(3);
    
    console.log('With join - Error:', err1?.message, err1?.code, err1?.details);
    console.log('With join - Count:', tasks1?.length);
    
    // Test query WITHOUT join
    console.log('\n--- Testing query WITHOUT join ---');
    const { data: tasks2, error: err2 } = await supabase
      .from('plan_nodes')
      .select('id, title, node_type, status, plan_id')
      .in('plan_id', planIds)
      .limit(3);
    
    console.log('Without join - Error:', err2?.message);
    console.log('Without join - Count:', tasks2?.length);
    
    // Test alternative join syntax
    console.log('\n--- Testing with plans(id, title) syntax ---');
    const { data: tasks3, error: err3 } = await supabase
      .from('plan_nodes')
      .select(`
        id, title, node_type, status, plan_id,
        plans(id, title)
      `)
      .in('plan_id', planIds)
      .limit(3);
    
    console.log('Alternative join - Error:', err3?.message, err3?.code);
    console.log('Alternative join - Count:', tasks3?.length);
    if (tasks3?.length > 0) {
      console.log('Sample:', JSON.stringify(tasks3[0], null, 2));
    }
  }
}

testQuery().catch(console.error);
