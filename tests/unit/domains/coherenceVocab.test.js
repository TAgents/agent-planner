/**
 * Ring-3: the public coherence vocabulary maps internal BDI-flavoured states
 * to plain language. Internal column/engine values are unchanged (mechanic).
 */
const { toPublicCoherence, publicCoherenceStatus } = require('../../../src/domains/node/coherenceVocab');

describe('coherence vocabulary mapping', () => {
  it('maps internal states to plain-language public status', () => {
    expect(publicCoherenceStatus('coherent')).toBe('ok');
    expect(publicCoherenceStatus('stale_beliefs')).toBe('outdated');
    expect(publicCoherenceStatus('contradiction_detected')).toBe('contradicted');
    expect(publicCoherenceStatus('unchecked')).toBe('unchecked');
  });

  it('attaches a human message for the actionable states only', () => {
    expect(toPublicCoherence('stale_beliefs').message).toMatch(/outdated/i);
    expect(toPublicCoherence('contradiction_detected').message).toMatch(/contradict/i);
    expect(toPublicCoherence('coherent').message).toBeNull();
    expect(toPublicCoherence('unchecked').message).toBeNull();
  });

  it('defaults null/undefined to unchecked', () => {
    expect(toPublicCoherence(null)).toEqual({ status: 'unchecked', message: null });
    expect(toPublicCoherence(undefined)).toEqual({ status: 'unchecked', message: null });
  });

  it('does not leak BDI vocabulary (no "belief"/"desire"/"intention" in output)', () => {
    for (const internal of ['coherent', 'stale_beliefs', 'contradiction_detected', 'unchecked']) {
      const { status, message } = toPublicCoherence(internal);
      const blob = `${status} ${message || ''}`.toLowerCase();
      expect(blob).not.toMatch(/belief|desire|intention|stale_beliefs/);
    }
  });
});
