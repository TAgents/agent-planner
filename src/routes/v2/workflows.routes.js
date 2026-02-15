/**
 * Workflows v2 Routes
 * 
 * Proxy layer for Hatchet workflow management.
 * Provides authenticated access to workflow runs, templates, and events.
 */
const express = require('express');
const router = express.Router();
const { authenticate } = require('../../middleware/auth.middleware');
const logger = require('../../utils/logger');

// Lazy-load Hatchet client (ESM) — cached after first load
let _hatchetModule = null;
async function getHatchet() {
  if (!_hatchetModule) {
    _hatchetModule = await import('../../utils/hatchet.mjs');
  }
  return _hatchetModule;
}

// For testing: allow injecting a mock
function _setHatchetModule(mock) {
  _hatchetModule = mock;
}

// GET /api/workflows/runs — list workflow runs
router.get('/runs', authenticate, async (req, res) => {
  try {
    const hatchet = await getHatchet();
    const { status, limit, offset } = req.query;
    const result = await hatchet.listWorkflowRuns({
      status: status || undefined,
      limit: limit ? parseInt(limit, 10) : 20,
      offset: offset ? parseInt(offset, 10) : 0,
    });
    res.json(result);
  } catch (err) {
    await logger.error('List workflow runs error:', err);
    res.status(500).json({ error: 'Failed to list workflow runs' });
  }
});

// GET /api/workflows/runs/:runId — get single run with step details
router.get('/runs/:runId', authenticate, async (req, res) => {
  try {
    const hatchet = await getHatchet();
    const run = await hatchet.getWorkflowRun(req.params.runId);
    if (!run) {
      return res.status(404).json({ error: 'Workflow run not found' });
    }
    res.json(run);
  } catch (err) {
    await logger.error('Get workflow run error:', err);
    res.status(500).json({ error: 'Failed to get workflow run' });
  }
});

// GET /api/workflows/templates — list available workflow templates
router.get('/templates', authenticate, async (req, res) => {
  try {
    const hatchet = await getHatchet();
    const workflows = await hatchet.listWorkflows();
    res.json({ workflows });
  } catch (err) {
    await logger.error('List workflow templates error:', err);
    res.status(500).json({ error: 'Failed to list workflow templates' });
  }
});

// GET /api/workflows/events — list events
router.get('/events', authenticate, async (req, res) => {
  try {
    const hatchet = await getHatchet();
    const { limit, offset } = req.query;
    const result = await hatchet.listEvents({
      limit: limit ? parseInt(limit, 10) : 20,
      offset: offset ? parseInt(offset, 10) : 0,
    });
    res.json(result);
  } catch (err) {
    await logger.error('List workflow events error:', err);
    res.status(500).json({ error: 'Failed to list workflow events' });
  }
});

// POST /api/workflows/trigger — manually trigger a workflow
router.post('/trigger', authenticate, async (req, res) => {
  try {
    const hatchet = await getHatchet();
    const { workflowName, input } = req.body;
    if (!workflowName) {
      return res.status(400).json({ error: 'workflowName is required' });
    }
    const result = await hatchet.triggerWorkflow(workflowName, input || {});
    res.status(201).json(result);
  } catch (err) {
    await logger.error('Trigger workflow error:', err);
    res.status(500).json({ error: 'Failed to trigger workflow' });
  }
});

router._setHatchetModule = _setHatchetModule;
module.exports = router;
