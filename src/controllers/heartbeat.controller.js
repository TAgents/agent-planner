const { supabaseAdmin: supabase } = require('../config/supabase');
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

    const { data, error } = await supabase
      .from('agent_heartbeats')
      .upsert({
        user_id: userId,
        last_seen_at: new Date().toISOString(),
        status,
        current_plan_id: plan_id || null,
        current_task_id: task_id || null,
      }, { onConflict: 'user_id' })
      .select()
      .single();

    if (error) {
      await logger.error('Failed to send heartbeat', error);
      return res.status(500).json({ error: 'Failed to send heartbeat' });
    }

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
    const { data: heartbeats, error: hbError } = await supabase
      .from('agent_heartbeats')
      .select('user_id, last_seen_at, status, current_plan_id, current_task_id')
      .eq('current_plan_id', planId);

    // Also get agents assigned to tasks in this plan
    const { data: assignedAgents } = await supabase
      .from('plan_nodes')
      .select('assigned_agent_id')
      .eq('plan_id', planId)
      .not('assigned_agent_id', 'is', null);

    const agentIds = new Set();
    (heartbeats || []).forEach(h => agentIds.add(h.user_id));
    (assignedAgents || []).forEach(a => agentIds.add(a.assigned_agent_id));

    if (agentIds.size === 0) {
      return res.json({ agents: [] });
    }

    // Get user info
    const { data: users } = await supabase
      .from('users')
      .select('id, name, email, capability_tags')
      .in('id', Array.from(agentIds));

    // Get all heartbeats for these agents
    const { data: allHeartbeats } = await supabase
      .from('agent_heartbeats')
      .select('*')
      .in('user_id', Array.from(agentIds));

    const heartbeatMap = new Map();
    (allHeartbeats || []).forEach(h => heartbeatMap.set(h.user_id, h));

    const agents = (users || []).map(user => {
      const hb = heartbeatMap.get(user.id);
      let computedStatus = 'offline';

      if (hb) {
        const lastSeen = new Date(hb.last_seen_at);
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
        capability_tags: user.capability_tags || [],
        status: computedStatus,
        last_seen_at: hb?.last_seen_at || null,
        current_task_id: hb?.current_task_id || null,
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
