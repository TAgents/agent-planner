const { normalizeCriteria } = require('../../../src/utils/goalCriteria');

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
