const fs = require('fs');
const path = require('path');

async function validateDocs() {
  try {
    const docsPath = path.join(__dirname, '../docs/openapi.json');
    
    // Check if documentation exists
    if (!fs.existsSync(docsPath)) {
      console.error('❌ Documentation not found. Run npm run docs:generate first.');
      process.exit(1);
    }
    
    // Load the OpenAPI spec
    const spec = JSON.parse(fs.readFileSync(docsPath, 'utf8'));
    
    console.log('📋 API Documentation Validation Report\n');
    console.log(`API: ${spec.info.title} v${spec.info.version}`);
    console.log(`Servers: ${spec.servers.length}`);
    
    // Count endpoints
    let endpointCount = 0;
    let undocumentedCount = 0;
    const pathIssues = [];
    
    Object.entries(spec.paths).forEach(([path, methods]) => {
      Object.entries(methods).forEach(([method, details]) => {
        endpointCount++;
        
        // Check for missing summaries
        if (!details.summary) {
          undocumentedCount++;
          pathIssues.push(`${method.toUpperCase()} ${path}: Missing summary`);
        }
        
        // Check for missing response descriptions
        if (!details.responses || Object.keys(details.responses).length === 0) {
          pathIssues.push(`${method.toUpperCase()} ${path}: No responses defined`);
        }
      });
    });
    
    console.log(`\nTotal Endpoints: ${endpointCount}`);
    console.log(`Fully Documented: ${endpointCount - undocumentedCount}`);
    console.log(`Missing Documentation: ${undocumentedCount}`);
    
    if (pathIssues.length > 0) {
      console.log('\n⚠️  Issues found:');
      pathIssues.forEach(issue => console.log(`  - ${issue}`));
    } else {
      console.log('\n✅ All endpoints are properly documented!');
    }
    
    // Check schemas
    const schemas = spec.components?.schemas || {};
    console.log(`\nSchemas Defined: ${Object.keys(schemas).length}`);
    console.log(`Schemas: ${Object.keys(schemas).join(', ')}`);
    
    // Validation passed if no critical issues
    if (undocumentedCount === 0) {
      console.log('\n✅ Documentation validation passed!');
      process.exit(0);
    } else {
      console.log('\n❌ Documentation validation failed. Please fix the issues above.');
      process.exit(1);
    }
    
  } catch (error) {
    console.error('❌ Error validating documentation:', error);
    process.exit(1);
  }
}

// Run validation
validateDocs();
