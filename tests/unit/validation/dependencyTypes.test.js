/**
 * Ring-2 dependency-vocabulary consolidation: node→node edges are limited to
 * `blocks` + `relates_to`, legacy aliases are mapped, unknowns rejected, and
 * the goal-only `achieves` type is not accepted on node→node creation.
 */
const {
  NODE_DEPENDENCY_TYPES,
  normalizeNodeDependencyType,
} = require('../../../src/validation/dependencyTypes');

describe('normalizeNodeDependencyType', () => {
  it('accepts the canonical node→node types', () => {
    for (const t of NODE_DEPENDENCY_TYPES) {
      expect(normalizeNodeDependencyType(t)).toEqual({ ok: true, type: t });
    }
  });

  it('defaults an omitted type to blocks', () => {
    expect(normalizeNodeDependencyType(undefined)).toEqual({ ok: true, type: 'blocks' });
  });

  it('maps legacy aliases onto the canonical pair', () => {
    expect(normalizeNodeDependencyType('requires').type).toBe('blocks');
    expect(normalizeNodeDependencyType('informs').type).toBe('relates_to');
    expect(normalizeNodeDependencyType('related_to').type).toBe('relates_to');
  });

  it('rejects the goal-only achieves type on node→node edges', () => {
    const r = normalizeNodeDependencyType('achieves');
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/achieves/);
  });

  it('rejects unknown types', () => {
    const r = normalizeNodeDependencyType('bogus');
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Allowed: blocks, relates_to/);
  });
});
