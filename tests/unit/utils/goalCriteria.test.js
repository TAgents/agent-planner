const {
  normalizeCriteria,
  isMeasurableCriterion,
  isCriterionMet,
  criteriaAttainment,
  autoAchieveStatus,
  coerceCriterionCurrent,
  canonicalizeCriteria,
} = require('../../../src/utils/goalCriteria');

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

describe('canonicalizeCriteria', () => {
  it('turns plain strings into { id, statement } with index-based ids', () => {
    expect(canonicalizeCriteria(['first', 'second'])).toEqual([
      { id: 'c0', statement: 'first' },
      { id: 'c1', statement: 'second' },
    ]);
  });

  it('preserves an existing id and all fields on objects', () => {
    const input = [{ id: 'latency', statement: 's', metric: 'p99', target: 100, direction: 'decrease' }];
    expect(canonicalizeCriteria(input)).toEqual(input);
  });

  it('assigns ids by index to objects missing one, keeping fields', () => {
    const out = canonicalizeCriteria([{ statement: 's', metric: 'm', target: 1, direction: 'increase' }]);
    expect(out[0]).toEqual({ id: 'c0', statement: 's', metric: 'm', target: 1, direction: 'increase' });
  });

  it('unwraps the legacy { criteria: [...] } shape before canonicalizing', () => {
    expect(canonicalizeCriteria({ criteria: ['a'] })).toEqual([{ id: 'c0', statement: 'a' }]);
  });

  it('returns [] for empty/unknown shapes', () => {
    expect(canonicalizeCriteria(null)).toEqual([]);
    expect(canonicalizeCriteria({})).toEqual([]);
  });
});

describe('isCriterionMet', () => {
  it('decrease: met when current <= target', () => {
    expect(isCriterionMet({ metric: 'p99', target: 100, current: 90, direction: 'decrease' })).toBe(true);
    expect(isCriterionMet({ metric: 'p99', target: 100, current: 140, direction: 'decrease' })).toBe(false);
  });

  it('increase: met when current >= target', () => {
    expect(isCriterionMet({ metric: 'customers', target: 10, current: 12, direction: 'increase' })).toBe(true);
    expect(isCriterionMet({ metric: 'customers', target: 10, current: 4, direction: 'increase' })).toBe(false);
  });

  it('boolean: met when current is truthy, not for falsey markers', () => {
    expect(isCriterionMet({ metric: 'shipped', direction: 'boolean', current: true })).toBe(true);
    expect(isCriterionMet({ metric: 'shipped', direction: 'boolean', current: 'done' })).toBe(true);
    expect(isCriterionMet({ metric: 'shipped', direction: 'boolean', current: 'false' })).toBe(false);
    expect(isCriterionMet({ metric: 'shipped', direction: 'boolean', current: 0 })).toBe(false);
  });

  it('is false when current is missing or the criterion is not measurable', () => {
    expect(isCriterionMet({ metric: 'p99', target: 100, direction: 'decrease' })).toBe(false);
    expect(isCriterionMet('a plain statement')).toBe(false);
  });
});

describe('criteriaAttainment', () => {
  it('computes attainment over measurable criteria only', () => {
    const criteria = [
      { metric: 'p99', target: 100, current: 90, direction: 'decrease' },   // met
      { metric: 'customers', target: 10, current: 4, direction: 'increase' }, // not met
      'a qualitative criterion',                                              // not measurable, ignored
    ];
    expect(criteriaAttainment(criteria)).toEqual({ measurable_count: 2, met_count: 1, attainment_pct: 50 });
  });

  it('reports attainment_pct null when no criterion is measurable', () => {
    expect(criteriaAttainment(['vague', 'also vague'])).toEqual({
      measurable_count: 0,
      met_count: 0,
      attainment_pct: null,
    });
  });

  it('handles the wrapped {criteria:[]} shape', () => {
    expect(criteriaAttainment({ criteria: [{ metric: 'm', target: 1, current: 5, direction: 'increase' }] }))
      .toEqual({ measurable_count: 1, met_count: 1, attainment_pct: 100 });
  });
});

describe('autoAchieveStatus', () => {
  const allMet = [
    { metric: 'a', direction: 'boolean', current: true },
    { metric: 'b', target: 10, direction: 'increase', current: 12 },
  ];
  const partial = [
    { metric: 'a', direction: 'boolean', current: true },
    { metric: 'b', target: 10, direction: 'increase', current: 4 },
  ];

  it("transitions active → achieved when every measurable criterion is met", () => {
    expect(autoAchieveStatus(allMet, 'active')).toBe('achieved');
  });

  it('leaves status unchanged when attainment is below 100%', () => {
    expect(autoAchieveStatus(partial, 'active')).toBe('active');
  });

  it('does not fire for goals with no measurable criteria', () => {
    expect(autoAchieveStatus(['qualitative only'], 'active')).toBe('active');
    expect(autoAchieveStatus([], 'active')).toBe('active');
  });

  it('never downgrades a terminal status', () => {
    expect(autoAchieveStatus(partial, 'abandoned')).toBe('abandoned');
    expect(autoAchieveStatus(allMet, 'archived')).toBe('archived');
    expect(autoAchieveStatus(allMet, 'achieved')).toBe('achieved');
  });

  it('promotes a draft goal too once fully attained', () => {
    expect(autoAchieveStatus(allMet, 'draft')).toBe('achieved');
  });
});

describe('coerceCriterionCurrent', () => {
  it('coerces a stringified boolean back to a real boolean', () => {
    const c = { direction: 'boolean' };
    expect(coerceCriterionCurrent(c, 'true')).toBe(true);
    expect(coerceCriterionCurrent(c, 'false')).toBe(false);
    expect(coerceCriterionCurrent(c, true)).toBe(true);
    expect(coerceCriterionCurrent(c, 'done')).toBe(true);
    expect(coerceCriterionCurrent(c, 'not_started')).toBe(false);
  });

  it('coerces a numeric string to a number for increase/decrease', () => {
    expect(coerceCriterionCurrent({ direction: 'decrease' }, '72')).toBe(72);
    expect(coerceCriterionCurrent({ direction: 'increase' }, 10)).toBe(10);
  });

  it('leaves non-numeric values and unknown directions untouched', () => {
    expect(coerceCriterionCurrent({ direction: 'increase' }, 'n/a')).toBe('n/a');
    expect(coerceCriterionCurrent({}, 'whatever')).toBe('whatever');
    expect(coerceCriterionCurrent({ direction: 'boolean' }, null)).toBeNull();
  });
});
