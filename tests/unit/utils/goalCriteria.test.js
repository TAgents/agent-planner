const { normalizeCriteria, isMeasurableCriterion } = require('../../../src/utils/goalCriteria');

describe('normalizeCriteria', () => {
  it('returns a string[] unchanged', () => {
    expect(normalizeCriteria(['a', 'b', 'c'])).toEqual(['a', 'b', 'c']);
  });

  it('returns an object[] unchanged', () => {
    const arr = [{ statement: 'x', metric: 'latency', target: 100 }];
    expect(normalizeCriteria(arr)).toEqual(arr);
  });

  it('unwraps the legacy { criteria: [...] } shape', () => {
    // This is the shape the MCP historically wrote. Counting Object.keys() on it
    // returned 1, mis-scoring measurability for every multi-criterion goal.
    const wrapped = { criteria: ['one', 'two', 'three', 'four', 'five', 'six'] };
    expect(normalizeCriteria(wrapped)).toHaveLength(6);
  });

  it('treats null / undefined as no criteria', () => {
    expect(normalizeCriteria(null)).toEqual([]);
    expect(normalizeCriteria(undefined)).toEqual([]);
  });

  it('treats an unknown object shape as no criteria (not one)', () => {
    expect(normalizeCriteria({ foo: 'bar' })).toEqual([]);
    expect(normalizeCriteria({})).toEqual([]);
  });

  it('drops null/empty entries so the count reflects real criteria', () => {
    expect(normalizeCriteria(['a', '', null, undefined, 'b'])).toEqual(['a', 'b']);
    expect(normalizeCriteria({ criteria: ['a', null, ''] })).toEqual(['a']);
  });
});

describe('isMeasurableCriterion', () => {
  it('is false for plain-string (qualitative) criteria', () => {
    expect(isMeasurableCriterion('make it fast')).toBe(false);
  });

  it('is false for an object with only a statement', () => {
    expect(isMeasurableCriterion({ statement: 'make it fast' })).toBe(false);
  });

  it('is true for increase/decrease with metric + target + direction', () => {
    expect(isMeasurableCriterion({ metric: 'p99 latency', target: 100, direction: 'decrease' })).toBe(true);
    expect(isMeasurableCriterion({ metric: 'paying customers', target: 10, direction: 'increase' })).toBe(true);
  });

  it('is false when target is missing for increase/decrease', () => {
    expect(isMeasurableCriterion({ metric: 'p99 latency', direction: 'decrease' })).toBe(false);
  });

  it('is true for a boolean criterion with a metric (target optional)', () => {
    expect(isMeasurableCriterion({ metric: 'oauth shipped', direction: 'boolean' })).toBe(true);
  });

  it('is false without a metric, or with an unknown direction', () => {
    expect(isMeasurableCriterion({ target: 100, direction: 'decrease' })).toBe(false);
    expect(isMeasurableCriterion({ metric: 'x', target: 1, direction: 'sideways' })).toBe(false);
  });

  it('is false for null / non-objects', () => {
    expect(isMeasurableCriterion(null)).toBe(false);
    expect(isMeasurableCriterion(42)).toBe(false);
  });
});
