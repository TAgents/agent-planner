/**
 * Success-criteria shape normalization.
 *
 * `goals.success_criteria` is jsonb and has been written in several shapes over
 * time:
 *   - string[]                          (the backend schema's "preferred" form)
 *   - object[]                          (structured criteria)
 *   - { criteria: [...] }               (legacy wrapped form — what the MCP wrote)
 *   - null / undefined
 *
 * The wrapped object form silently broke two quality dimensions: measurability
 * counted `Object.keys()` (always 1 for `{ criteria: [...] }`), and the
 * knowledge-grounding pass guarded on `Array.isArray` and skipped the wrapped
 * shape entirely. Normalize at every read site so counts and iteration are
 * correct regardless of which client wrote the goal.
 */

/**
 * Flatten any stored success_criteria shape into a plain array of criterion
 * entries (strings or objects, as stored). Returns [] for empty/unknown shapes.
 * @param {*} raw - the stored `goal.successCriteria` value
 * @returns {Array} flat list of criteria (never null)
 */
function normalizeCriteria(raw) {
  if (!raw) return [];
  let arr = raw;
  if (!Array.isArray(raw) && typeof raw === 'object') {
    arr = Array.isArray(raw.criteria) ? raw.criteria : [];
  }
  if (!Array.isArray(arr)) return [];
  return arr.filter((c) => c !== null && c !== undefined && c !== '');
}

/**
 * A criterion is "measurable" — and therefore countable toward goal attainment —
 * only when it carries enough structure to evaluate automatically: a metric, a
 * direction, and (for increase/decrease) a target. Plain-string criteria and
 * objects with only a statement are qualitative, not measurable.
 * @param {*} c - a single normalized criterion
 * @returns {boolean}
 */
function isMeasurableCriterion(c) {
  if (!c || typeof c !== 'object' || Array.isArray(c)) return false;
  if (typeof c.metric !== 'string' || c.metric.trim() === '') return false;
  if (c.direction === 'boolean') return true;
  if (c.direction === 'increase' || c.direction === 'decrease') {
    return c.target !== undefined && c.target !== null && c.target !== '';
  }
  return false;
}

/**
 * Has a measurable criterion reached its target? increase → current >= target,
 * decrease → current <= target, boolean → current is truthy. Returns false for
 * non-measurable criteria or a missing/blank current.
 * @param {*} c
 * @returns {boolean}
 */
function isCriterionMet(c) {
  if (!isMeasurableCriterion(c)) return false;
  const cur = c.current;
  if (cur === undefined || cur === null || cur === '') return false;
  if (c.direction === 'boolean') {
    if (typeof cur === 'number') return cur > 0;
    if (typeof cur === 'boolean') return cur;
    return !['false', 'no', '0', 'pending', 'not_started'].includes(String(cur).toLowerCase());
  }
  const curN = Number(cur);
  const tgtN = Number(c.target);
  if (Number.isNaN(curN) || Number.isNaN(tgtN)) return false;
  return c.direction === 'increase' ? curN >= tgtN : curN <= tgtN;
}

/**
 * Goal attainment over MEASURABLE criteria only — distinct from task/execution
 * progress. attainment_pct is null when a goal has no measurable criteria, so
 * qualitative goals aren't reported as 0% attained.
 * @param {*} raw - stored success_criteria
 * @returns {{measurable_count:number, met_count:number, attainment_pct:(number|null)}}
 */
function criteriaAttainment(raw) {
  const measurable = normalizeCriteria(raw).filter(isMeasurableCriterion);
  const metCount = measurable.filter(isCriterionMet).length;
  return {
    measurable_count: measurable.length,
    met_count: metCount,
    attainment_pct: measurable.length ? Math.round((metCount / measurable.length) * 100) : null,
  };
}

const TERMINAL_GOAL_STATUSES = ['achieved', 'abandoned', 'archived'];

/**
 * Decide a goal's status after a criteria change: auto-transition to 'achieved'
 * when every measurable criterion is met (attainment_pct === 100). Never
 * downgrades a terminal status, and never fires for goals with no measurable
 * criteria (qualitative goals stay where they are — a human closes those).
 * @param {*} rawCriteria - stored success_criteria
 * @param {string} currentStatus
 * @returns {string} the status the goal should have
 */
function autoAchieveStatus(rawCriteria, currentStatus) {
  if (TERMINAL_GOAL_STATUSES.includes(currentStatus)) return currentStatus;
  const { measurable_count, attainment_pct } = criteriaAttainment(rawCriteria);
  if (measurable_count > 0 && attainment_pct === 100) return 'achieved';
  return currentStatus;
}

/**
 * Canonicalize criteria into an array of objects each guaranteed an `id` and a
 * `statement`. Plain strings become { id, statement }; objects keep their own
 * id or get one assigned by index ('c{i}'). Used when WRITING criteria back
 * (e.g. recording progress) so stored criteria converge on the structured shape
 * and become individually addressable.
 * @param {*} raw - the stored `goal.successCriteria` value
 * @returns {Array<{id: string, statement?: string}>}
 */
function canonicalizeCriteria(raw) {
  return normalizeCriteria(raw).map((c, i) => {
    if (typeof c === 'string') return { id: `c${i}`, statement: c };
    return { id: c.id || `c${i}`, ...c };
  });
}

module.exports = {
  normalizeCriteria,
  isMeasurableCriterion,
  isCriterionMet,
  criteriaAttainment,
  autoAchieveStatus,
  canonicalizeCriteria,
};
