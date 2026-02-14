/**
 * Hatchet Client Utility
 * 
 * Proxy layer for Hatchet's admin API.
 * Returns empty arrays when Hatchet is unavailable.
 */
import logger from './logger.js';

let client = null;
let initialized = false;

async function getClient() {
  if (initialized) return client;
  initialized = true;

  const token = process.env.HATCHET_CLIENT_TOKEN;
  if (!token) {
    await logger.warn('HATCHET_CLIENT_TOKEN not set — workflow routes will return empty data');
    return null;
  }

  try {
    const { Hatchet } = await import('@hatchet-dev/typescript-sdk');
    client = Hatchet.init({ token });
    return client;
  } catch (err) {
    await logger.warn('Failed to initialize Hatchet client:', err.message);
    return null;
  }
}

export async function listWorkflowRuns(opts = {}) {
  try {
    const c = await getClient();
    if (!c) return { rows: [], pagination: { total: 0 } };
    const admin = c.admin;
    const result = await admin.listWorkflowRuns({
      status: opts.status,
      limit: opts.limit || 20,
      offset: opts.offset || 0,
    });
    return result;
  } catch (err) {
    await logger.error('Hatchet listWorkflowRuns error:', err);
    return { rows: [], pagination: { total: 0 } };
  }
}

export async function getWorkflowRun(runId) {
  try {
    const c = await getClient();
    if (!c) return null;
    const result = await c.admin.getWorkflowRun(runId);
    return result;
  } catch (err) {
    await logger.error('Hatchet getWorkflowRun error:', err);
    return null;
  }
}

export async function listWorkflows() {
  try {
    const c = await getClient();
    if (!c) return [];
    const result = await c.admin.listWorkflows();
    return result;
  } catch (err) {
    await logger.error('Hatchet listWorkflows error:', err);
    return [];
  }
}

export async function listEvents(opts = {}) {
  try {
    const c = await getClient();
    if (!c) return { rows: [], pagination: { total: 0 } };
    const result = await c.admin.listEvents({
      limit: opts.limit || 20,
      offset: opts.offset || 0,
    });
    return result;
  } catch (err) {
    await logger.error('Hatchet listEvents error:', err);
    return { rows: [], pagination: { total: 0 } };
  }
}

export async function triggerWorkflow(workflowName, input = {}) {
  try {
    const c = await getClient();
    if (!c) return { triggered: false, message: 'Hatchet not configured' };
    const result = await c.admin.runWorkflow(workflowName, input);
    return { triggered: true, workflowRunId: result?.workflowRunId || null };
  } catch (err) {
    await logger.error('Hatchet triggerWorkflow error:', err);
    return { triggered: false, error: err.message };
  }
}

// For testing — allow resetting the client
export function _resetClient() {
  client = null;
  initialized = false;
}
