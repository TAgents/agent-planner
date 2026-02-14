// ─── Data Access Layer ───────────────────────────────────────────
// Single entry point for all database operations.
// Controllers/services should NEVER import drizzle/pg directly.

export { usersDal } from './users.dal.mjs';
export { plansDal } from './plans.dal.mjs';
export { nodesDal } from './nodes.dal.mjs';
export { collaboratorsDal } from './collaborators.dal.mjs';
export { logsDal } from './logs.dal.mjs';
export { commentsDal } from './comments.dal.mjs';
export { tokensDal } from './tokens.dal.mjs';
export { goalsDal } from './goals.dal.mjs';
export { decisionsDal } from './decisions.dal.mjs';
export { knowledgeDal } from './knowledge.dal.mjs';
export { agentsDal } from './agents.dal.mjs';
export { auditDal } from './audit.dal.mjs';
export { searchDal } from './search.dal.mjs';
export { heartbeatsDal } from './heartbeats.dal.mjs';
export { invitesDal } from './invites.dal.mjs';
export { slackDal, webhooksDal } from './integrations.dal.mjs';
