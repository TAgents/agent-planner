// Public coherence vocabulary (ring-3): the coherence engine's internal
// BDI-flavoured states are a mechanic; the API maps them to plain language so
// callers never see "beliefs" jargon. internal value → { public status, human message }.
const logger = require('../utils/logger');

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
  // An unmapped value means the engine grew a state we haven't translated.
  // Warn to surface the drift, and fall back to `unchecked` rather than leak
  // the raw internal jargon to consumers.
  if (!STATUS_MAP[internal]) {
    logger.warn(`[coherenceVocab] Unknown internal coherence status: ${internal}`);
    return DEFAULT;
  }
  return STATUS_MAP[internal];
}

/** Public status string only (e.g. for a node's `coherence_status` field). */
function publicCoherenceStatus(internal) {
  return toPublicCoherence(internal).status;
}

/**
 * Response fields for a node's coherence, computed in one lookup. Spread into
 * a response object: `{ ...coherenceFields(n.coherenceStatus) }`.
 */
function coherenceFields(internal) {
  const { status, message } = toPublicCoherence(internal);
  return { coherence_status: status, coherence_message: message };
}

const PUBLIC_TO_INTERNAL = Object.fromEntries(
  Object.entries(STATUS_MAP).map(([internal, { status }]) => [status, internal])
);

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
  coherenceFields,
  toInternalCoherence,
  STATUS_MAP,
};
