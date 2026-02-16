/**
 * Agent Integration Routes
 *
 * - MCP tool listing and execution for external agents
 * - Agent callback endpoint for session completion
 */
const express = require('express');
const router = express.Router();
const { authenticate } = require('../../middleware/auth.middleware');
const { getToolDefinitions, executeTool } = require('../../mcp/tools');
const logger = require('../../utils/logger');

// GET /api/v2/agent/tools — list available MCP tools
router.get('/tools', authenticate, async (req, res) => {
  try {
    const tools = getToolDefinitions();
    res.json({ tools });
  } catch (err) {
    await logger.error('List MCP tools error:', err);
    res.status(500).json({ error: 'Failed to list tools' });
  }
});

// POST /api/v2/agent/tools/:toolName — execute an MCP tool
router.post('/tools/:toolName', authenticate, async (req, res) => {
  try {
    const result = await executeTool(req.params.toolName, req.body);
    res.json(result);
  } catch (err) {
    await logger.error(`Execute tool ${req.params.toolName} error:`, err);
    res.status(500).json({ error: 'Tool execution failed' });
  }
});

// POST /api/v2/agent/callback — webhook callback from agent sessions
router.post('/callback', async (req, res) => {
  try {
    const { sessionId, status, result, metadata } = req.body;

    // Verify callback token if configured
    const callbackToken = process.env.AGENT_CALLBACK_TOKEN;
    if (callbackToken) {
      const authHeader = req.headers.authorization;
      if (!authHeader || authHeader !== `Bearer ${callbackToken}`) {
        return res.status(401).json({ error: 'Invalid callback token' });
      }
    }

    await logger.api(`Agent callback: session=${sessionId} status=${status}`);

    // Process the agent's response
    if (metadata?.taskId && status === 'completed') {
      const dal = require('../../db/dal.cjs');
      try {
        await dal.nodesDal.update(metadata.taskId, { status: 'completed' });
        await dal.logsDal.create({
          planNodeId: metadata.taskId,
          content: `Agent session ${sessionId} completed: ${result?.summary || '(no summary)'}`,
          logType: 'progress',
          metadata: { sessionId, source: 'agent-callback' },
        });
      } catch (dbErr) {
        await logger.error(`Agent callback DB error: ${dbErr.message}`);
      }
    }

    // Publish event for downstream processing
    try {
      const messageBus = require('../../services/messageBus');
      await messageBus.publish('agent:response:received', {
        requestId: sessionId,
        nodeId: metadata?.taskId,
        response: result?.summary,
        adapter: metadata?.adapter || 'unknown',
      });
    } catch { /* best effort */ }

    res.json({ received: true });
  } catch (err) {
    await logger.error('Agent callback error:', err);
    res.status(500).json({ error: 'Callback processing failed' });
  }
});

module.exports = router;
