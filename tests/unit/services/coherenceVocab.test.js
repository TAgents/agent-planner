/**
 * Ring-3: the public coherence vocabulary maps internal BDI-flavoured states
 * to plain language. Internal column/engine values are unchanged (mechanic).
 */
const {
  toPublicCoherence,
  publicCoherenceStatus,
  toInternalCoherence,
  coherenceFields,
} = require('../../../src/services/coherenceVocab');

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

  it('falls back to unchecked (not the raw value) for an unmapped engine state', () => {
    // A future internal state we haven't translated must not leak through.
    expect(toPublicCoherence('goal_achieved')).toEqual({ status: 'unchecked', message: null });
  });
});

describe('toInternalCoherence (reverse map for the ?coherence_status= filter)', () => {
  it('maps public values back to internal column values', () => {
    expect(toInternalCoherence('ok')).toBe('coherent');
    expect(toInternalCoherence('outdated')).toBe('stale_beliefs');
    expect(toInternalCoherence('contradicted')).toBe('contradiction_detected');
    expect(toInternalCoherence('unchecked')).toBe('unchecked');
  });

  it('maps comma-separated lists element-wise', () => {
    expect(toInternalCoherence('outdated,contradicted')).toBe('stale_beliefs,contradiction_detected');
    expect(toInternalCoherence('ok, outdated')).toBe('coherent,stale_beliefs');
  });

  it('passes internal values through unchanged (idempotent)', () => {
    expect(toInternalCoherence('stale_beliefs')).toBe('stale_beliefs');
  });

  it('passes unknown values through as-is', () => {
    expect(toInternalCoherence('whatever')).toBe('whatever');
  });

  it('coherenceFields returns the spreadable response shape', () => {
    expect(coherenceFields('stale_beliefs')).toEqual({
      coherence_status: 'outdated',
      coherence_message: 'May be working from outdated information.',
    });
  });
});
