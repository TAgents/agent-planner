-- Check if required tables and views exist for activities endpoint

-- Check for logs table (different naming conventions)
SELECT 'logs table' as check_item,
       EXISTS(SELECT 1 FROM information_schema.tables 
              WHERE table_name = 'logs') as exists;

SELECT 'plan_node_logs table' as check_item,
       EXISTS(SELECT 1 FROM information_schema.tables 
              WHERE table_name = 'plan_node_logs') as exists;

-- Check for comments table
SELECT 'comments table' as check_item,
       EXISTS(SELECT 1 FROM information_schema.tables 
              WHERE table_name = 'comments') as exists;

SELECT 'plan_comments table' as check_item,
       EXISTS(SELECT 1 FROM information_schema.tables 
              WHERE table_name = 'plan_comments') as exists;

-- Check for artifacts table  
SELECT 'artifacts table' as check_item,
       EXISTS(SELECT 1 FROM information_schema.tables 
              WHERE table_name = 'artifacts') as exists;

SELECT 'plan_node_artifacts table' as check_item,
       EXISTS(SELECT 1 FROM information_schema.tables 
              WHERE table_name = 'plan_node_artifacts') as exists;

-- Check for assignments view
SELECT 'node_assignments_with_users view' as check_item,
       EXISTS(SELECT 1 FROM information_schema.views 
              WHERE table_name = 'node_assignments_with_users') as exists;

SELECT 'node_assignments table' as check_item,
       EXISTS(SELECT 1 FROM information_schema.tables 
              WHERE table_name = 'node_assignments') as exists;

-- Check for audit_logs table
SELECT 'audit_logs table' as check_item,
       EXISTS(SELECT 1 FROM information_schema.tables 
              WHERE table_name = 'audit_logs') as exists;

-- Show actual table structure for logs
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'plan_node_logs'
ORDER BY ordinal_position;

-- Show actual table structure for comments
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'plan_comments'
ORDER BY ordinal_position;

-- Show actual table structure for artifacts
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'plan_node_artifacts'
ORDER BY ordinal_position;

-- Check if auth.users can be accessed
SELECT 'auth.users accessible' as check_item,
       EXISTS(SELECT 1 FROM information_schema.tables 
              WHERE table_schema = 'auth' AND table_name = 'users') as exists;
