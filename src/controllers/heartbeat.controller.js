const { heartbeatsDal, nodesDal, usersDal } = require('../db/dal');
const logger = require('../utils/logger');

const IDLE_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes
const OFFLINE_THRESHOLD_MS = 15 * 60 * 1000; // 15 minutes

/**
 * Send a heartbeat (agent reports it's alive)
 */
const sendHeartbeat = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { plan_id, task_id, status = 'active' } = req.body;

    const data = await heartbeatsDal.upsert({
      userId: userId,
      lastSeenAt: new Date(),
      status,
      currentPlanId: plan_id || null,
      currentTaskId: task_id || null,
    });

    res.json(data);
  } catch (error) {
    await logger.error('Unexpected error in sendHeartbeat', error);
    next(error);
  }
};

/**
 * Get agent statuses for a plan
 */
const getPlanAgentStatuses = async (req, res, next) => {
  try {
    const { planId } = req.params;
    const now = new Date();

    // Get all agents that have been seen on this plan or are assigned to tasks in this plan
    const heartbeats = await heartbeatsDal.findByPlanId(planId);

    // Also get agents assigned to tasks in this plan
    const assignedAgentIds = await nodesDal.getAssignedAgentIds(planId);

    const agentIds = new Set();
    heartbeats.forEach(h => agentIds.add(h.userId));
    assignedAgentIds.forEach(id => agentIds.add(id));

    if (agentIds.size === 0) {
      return res.json({ agents: [] });
    }

    // Get user info
    const users = await usersDal.findByIds(Array.from(agentIds));

    // Get all heartbeats for these agents
    const allHeartbeats = await heartbeatsDal.findByUserIds(Array.from(agentIds));

    const heartbeatMap = new Map();
    allHeartbeats.forEach(h => heartbeatMap.set(h.userId, h));

    const agents = users.map(user => {
      const hb = heartbeatMap.get(user.id);
      let computedStatus = 'offline';

      if (hb) {
        const lastSeen = new Date(hb.lastSeenAt);
        const elapsed = now.getTime() - lastSeen.getTime();

        if (elapsed < IDLE_THRESHOLD_MS) {
          computedStatus = hb.status === 'active' ? 'active' : 'online';
        } else if (elapsed < OFFLINE_THRESHOLD_MS) {
          computedStatus = 'idle';
        } else {
          computedStatus = 'offline';
        }
      }

      return {
        id: user.id,
        name: user.name,
        email: user.email,
        capability_tags: user.capabilityTags || [],
        status: computedStatus,
        last_seen_at: hb?.lastSeenAt || null,
        current_task_id: hb?.currentTaskId || null,
      };
    });

    res.json({ agents });
  } catch (error) {
    await logger.error('Unexpected error in getPlanAgentStatuses', error);
    next(error);
  }
};

module.exports = {
  sendHeartbeat,
  getPlanAgentStatuses
};
