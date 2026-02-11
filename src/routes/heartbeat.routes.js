const express = require('express');
const router = express.Router();
const heartbeatController = require('../controllers/heartbeat.controller');
const { authenticate } = require('../middleware/auth.middleware');

router.post('/heartbeat', authenticate, heartbeatController.sendHeartbeat);
router.get('/plans/:planId/agent-status', authenticate, heartbeatController.getPlanAgentStatuses);

module.exports = router;
