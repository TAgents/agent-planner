/**
 * Canonical dependency-edge vocabulary (ring-2 consolidation).
 *
 * The dependency graph accumulated several near-synonymous edge types across
 * pivots (requires, informs, related_to, ...). The architecture review
 * collapsed the node→node vocabulary to two:
 *   - `blocks`     — source must complete before target can proceed (the only
 *                    type the critical-path / scheduling traversal walks).
 *   - `relates_to` — soft, non-blocking association.
 *
 * `achieves` is NOT a node→node type — it's a node→GOAL contribution edge,
 * created only via the goal achievers routes / plan-link cascade, and is kept
 * as the task-level goal-progress graph (see docs decision: held in ring-2).
 *
 * Legacy aliases are mapped onto the canonical pair rather than rejected, so
 * older callers don't break; unknown types are rejected.
 */

const NODE_DEPENDENCY_TYPES = ['blocks', 'relates_to'];
const GOAL_DEPENDENCY_TYPES = ['achieves'];

// Deprecated node→node aliases → canonical. `requires` was the inverse phrasing
// of blocks; informs/related_to were relates_to variants.
const LEGACY_ALIASES = {
  requires: 'blocks',
  informs: 'relates_to',
  related_to: 'relates_to',
};

/**
 * Normalise a requested node→node dependency type to the canonical vocabulary.
 * @returns {{ ok: true, type: string } | { ok: false, error: string }}
 */
function normalizeNodeDependencyType(input) {
  const raw = (input || 'blocks').toString();
  const mapped = LEGACY_ALIASES[raw] || raw;
  if (!NODE_DEPENDENCY_TYPES.includes(mapped)) {
    const shown = raw.length > 64 ? `${raw.slice(0, 64)}…` : raw;
    return {
      ok: false,
      error: `Invalid dependency_type "${shown}". Allowed: ${NODE_DEPENDENCY_TYPES.join(', ')} (node→goal '${GOAL_DEPENDENCY_TYPES[0]}' edges are created via the goal achievers routes).`,
    };
  }
  return { ok: true, type: mapped };
}

module.exports = {
  NODE_DEPENDENCY_TYPES,
  GOAL_DEPENDENCY_TYPES,
  LEGACY_ALIASES,
  normalizeNodeDependencyType,
};
