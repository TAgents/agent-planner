const service = require('./agentLoop.service');

function handleError(error, res, next) {
  if (error instanceof service.AgentLoopError) {
    return res.status(error.statusCode).json({
      error: error.message,
      code: error.code,
      ...(error.details ? error.details : {}),
    });
  }
  return next(error);
}

async function briefing(req, res, next) {
  try {
    const result = await service.getBriefing(req.user, req.query);
    res.json(result);
  } catch (error) {
    handleError(error, res, next);
  }
}

async function startWorkSession(req, res, next) {
  try {
    const result = await service.startWorkSession(req.user, req.body || {});
    res.status(result.dry_run ? 200 : 201).json(result);
  } catch (error) {
    handleError(error, res, next);
  }
}

async function completeWorkSession(req, res, next) {
  try {
    const result = await service.finishWorkSession(req.user, req.params.sessionId, {
      ...(req.body || {}),
      status: 'completed',
    });
    res.json(result);
  } catch (error) {
    handleError(error, res, next);
  }
}

async function blockWorkSession(req, res, next) {
  try {
    const result = await service.finishWorkSession(req.user, req.params.sessionId, {
      ...(req.body || {}),
      status: 'blocked',
    });
    res.json(result);
  } catch (error) {
    handleError(error, res, next);
  }
}

async function createIntention(req, res, next) {
  try {
    const result = await service.createIntention(req.user, req.body || {});
    res.status(201).json(result);
  } catch (error) {
    handleError(error, res, next);
  }
}

module.exports = {
  briefing,
  startWorkSession,
  completeWorkSession,
  blockWorkSession,
  createIntention,
};
