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

module.exports = { normalizeCriteria };
