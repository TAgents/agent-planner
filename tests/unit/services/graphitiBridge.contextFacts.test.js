const { normalizeContextFacts } = require('../../../src/services/graphitiBridge');

// Layer 3 of the progressive context engine used to pass Graphiti facts into an
// agent's working context WITHOUT dropping superseded ones — so stale knowledge
// (a fact the graph had already replaced) could shape a decision. normalize must
// drop expired / past-invalid facts, sort by relevance, and cap.
const NOW = new Date('2026-06-26T12:00:00Z').getTime();

const current = { fact: 'X is true now', score: 0.9 };
const lowRel = { fact: 'tangentially related', score: 0.2 };
const expired = { fact: 'X used to be true', score: 0.95, expired_at: '2026-06-18T00:00:00Z' };
const pastInvalid = { fact: 'Y was true', score: 0.99, invalid_at: '2026-02-01T00:00:00Z' };
const futureInvalid = { fact: 'still valid for now', score: 0.5, invalid_at: '2026-12-01T00:00:00Z' };

describe('normalizeContextFacts — Layer 3 knowledge hygiene', () => {
  it('drops superseded facts (expired_at or past invalid_at)', () => {
    const out = normalizeContextFacts([current, expired, pastInvalid], 5, NOW);
    const contents = out.map(f => f.content);
    expect(contents).toContain('X is true now');
    expect(contents).not.toContain('X used to be true');
    expect(contents).not.toContain('Y was true');
  });

  it('keeps a fact whose invalid_at is in the future', () => {
    const out = normalizeContextFacts([futureInvalid], 5, NOW);
    expect(out).toHaveLength(1);
  });

  it('sorts by relevance descending and caps at maxResults', () => {
    const out = normalizeContextFacts([lowRel, current], 1, NOW);
    expect(out).toHaveLength(1);
    expect(out[0].content).toBe('X is true now'); // 0.9 beats 0.2
  });

  it('handles the {facts:[...]} and {results:[...]} envelopes', () => {
    expect(normalizeContextFacts({ facts: [current] }, 5, NOW)).toHaveLength(1);
    expect(normalizeContextFacts({ results: [current] }, 5, NOW)).toHaveLength(1);
  });

  it('returns [] for an empty/missing result', () => {
    expect(normalizeContextFacts(null, 5, NOW)).toEqual([]);
    expect(normalizeContextFacts(undefined, 5, NOW)).toEqual([]);
  });
});
