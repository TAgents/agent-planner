/**
 * Validates the generated OpenAPI specs:
 *   - docs/openapi.v1.json — STRICT: the public surface must be fully
 *     documented (summary + responses on every operation, valid path keys).
 *     Any issue fails the build.
 *   - docs/openapi.json    — LENIENT: internal routes are unversioned and
 *     undocumented by design; issues are reported but don't fail.
 */
const fs = require('fs');
const path = require('path');

function collectIssues(spec) {
  const issues = [];
  let endpointCount = 0;

  Object.entries(spec.paths || {}).forEach(([route, methods]) => {
    if (!route.startsWith('/')) {
      issues.push(`Invalid path key "${route}" — a @swagger comment is producing malformed YAML`);
      return;
    }
    Object.entries(methods).forEach(([method, details]) => {
      endpointCount++;
      if (!details.summary) {
        issues.push(`${method.toUpperCase()} ${route}: Missing summary`);
      }
      if (!details.responses || Object.keys(details.responses).length === 0) {
        issues.push(`${method.toUpperCase()} ${route}: No responses defined`);
      }
      // Catch YAML artefacts: an unquoted description containing commas in a
      // flow mapping parses as extra keys (e.g. "agent requests": null).
      const RESPONSE_FIELDS = ['description', 'content', 'headers', 'links', '$ref'];
      Object.entries(details.responses || {}).forEach(([code, resp]) => {
        if (!resp || typeof resp !== 'object') {
          issues.push(`${method.toUpperCase()} ${route} ${code}: response is not an object`);
          return;
        }
        const stray = Object.keys(resp).filter(k => !RESPONSE_FIELDS.includes(k));
        if (stray.length > 0) {
          issues.push(`${method.toUpperCase()} ${route} ${code}: malformed response keys (${stray.join(', ')}) — quote descriptions containing commas`);
        }
      });
    });
  });

  return { endpointCount, issues };
}

function loadSpec(file) {
  const specPath = path.join(__dirname, '../docs', file);
  if (!fs.existsSync(specPath)) {
    console.error(`❌ ${file} not found. Run npm run docs:generate first.`);
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(specPath, 'utf8'));
}

function report(label, spec, { strict }) {
  const { endpointCount, issues } = collectIssues(spec);
  console.log(`\n━━ ${label} — ${spec.info.title} v${spec.info.version} ━━`);
  console.log(`Endpoints: ${endpointCount}, issues: ${issues.length}`);
  if (issues.length > 0) {
    const shown = strict ? issues : issues.slice(0, 15);
    shown.forEach(issue => console.log(`  - ${issue}`));
    if (!strict && issues.length > shown.length) {
      console.log(`  … and ${issues.length - shown.length} more (internal spec is lenient — not failing the build)`);
    }
  }
  return issues.length;
}

const v1Issues = report('PUBLIC v1 (strict)', loadSpec('openapi.v1.json'), { strict: true });
report('INTERNAL (lenient)', loadSpec('openapi.json'), { strict: false });

if (v1Issues > 0) {
  console.log('\n❌ v1 documentation validation failed — every public endpoint needs a summary and responses.');
  process.exit(1);
}
console.log('\n✅ v1 documentation validation passed.');
