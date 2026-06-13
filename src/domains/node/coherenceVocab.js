/**
 * Public coherence vocabulary (ring-3 BDI demotion).
 *
 * The coherence engine stores BDI-flavoured states on `plan_nodes.coherence_status`
 * (`coherent` / `stale_beliefs` / `contradiction_detected` / `unchecked`). Those
 * are an internal MECHANIC and stay as-is. The public API, however, should not
 * make callers learn "beliefs" jargon — so every response maps the internal
 * value to plain language here.
 *
 *   internal                public status   message
 *   ----------------------  --------------  --------------------------------------
 *   coherent                ok              (none)
 *   stale_beliefs           outdated        "May be working from outdated information."
 *   contradiction_detected  contradicted    "New knowledge contradicts this task's context."
 *   unchecked / null        unchecked       (none)
 */

const STATUS_MAP = {
  coherent: { status: 'ok', message: null },
  stale_beliefs: { status: 'outdated', message: 'May be working from outdated information.' },
  contradiction_detected: { status: 'contradicted', message: 'New knowledge contradicts this task\'s context.' },
  unchecked: { status: 'unchecked', message: null },
};

const DEFAULT = { status: 'unchecked', message: null };

/** Map an internal coherence_status to its public { status, message }. */
function toPublicCoherence(internal) {
  if (!internal) return DEFAULT;
  return STATUS_MAP[internal] || { status: internal, message: null };
}

/** Public status string only (e.g. for a node's `coherence_status` field). */
function publicCoherenceStatus(internal) {
  return toPublicCoherence(internal).status;
}

const PUBLIC_TO_INTERNAL = Object.fromEntries(
  Object.entries(STATUS_MAP).map(([internal, { status }]) => [status, internal])
);

const PUBLIC_STATUSES = Object.values(STATUS_MAP).map((v) => v.status);

/**
 * Map a public status (e.g. a filter value) back to the internal column value.
 * Accepts internal values too (idempotent), so callers can pass either.
 * Comma-separated lists are mapped element-wise.
 */
function toInternalCoherence(publicStatus) {
  if (!publicStatus) return publicStatus;
  return publicStatus
    .split(',')
    .map((s) => s.trim())
    .map((s) => PUBLIC_TO_INTERNAL[s] || s)
    .join(',');
}

module.exports = {
  toPublicCoherence,
  publicCoherenceStatus,
  toInternalCoherence,
  STATUS_MAP,
  PUBLIC_STATUSES,
};
