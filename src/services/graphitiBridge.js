/**
 * Graphiti Bridge Service
 *
 * Server-to-server bridge between AgentPlanner API and the internal Graphiti
 * MCP server. Graphiti is an invisible backend — agents and users never
 * interact with it directly. All knowledge operations are proxied through
 * AgentPlanner API using the same auth token.
 *
 * Architecture:
 *   Agent → AgentPlanner MCP → AgentPlanner API → [this bridge] → Graphiti MCP (internal)
 *
 * Protocol: Graphiti uses MCP Streamable HTTP (JSON-RPC over HTTP with SSE responses).
 * Each bridge instance maintains an MCP session with the Graphiti server.
 *
 * Multi-tenancy: each organization gets its own FalkorDB graph namespace
 * via the group_id parameter (org_{org_id}).
 */

const http = require('http');

const GRAPHITI_URL = process.env.GRAPHITI_INTERNAL_URL || '';
const REQUEST_TIMEOUT = 30_000; // 30s — entity extraction can be slow

let sessionId = null;
let available = false;
let graphitiHost = '';
let graphitiPort = 8000;
let rpcId = 0;

// ─── Low-level HTTP helpers ──────────────────────────────────

/**
 * Make a raw HTTP request to the Graphiti MCP endpoint.
 * Uses Node's built-in http module to set Host: localhost (required by uvicorn).
 * Parses SSE responses (data: lines) back into JSON.
 */
function mcpRequest(payload) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(payload);
    const headers = {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(data),
      'Accept': 'application/json, text/event-stream',
      'Host': `localhost:${graphitiPort}`,
    };
    if (sessionId) headers['Mcp-Session-Id'] = sessionId;

    const req = http.request({
      hostname: graphitiHost,
      port: graphitiPort,
      path: '/mcp',
      method: 'POST',
      headers,
      timeout: REQUEST_TIMEOUT,
    }, res => {
      let body = '';
      res.on('data', d => body += d);
      res.on('end', () => {
        // Capture session ID from response
        if (res.headers['mcp-session-id']) {
          sessionId = res.headers['mcp-session-id'];
        }

        // Parse SSE response — look for "data: " lines
        const dataLines = body.split('\n').filter(l => l.startsWith('data: '));
        if (dataLines.length > 0) {
          try {
            const parsed = JSON.parse(dataLines[0].replace('data: ', ''));
            resolve({ status: res.statusCode, data: parsed });
          } catch {
            resolve({ status: res.statusCode, data: body });
          }
        } else {
          // Try parsing as plain JSON
          try {
            resolve({ status: res.statusCode, data: JSON.parse(body) });
          } catch {
            resolve({ status: res.statusCode, data: body });
          }
        }
      });
    });

    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Request timeout')); });
    req.write(data);
    req.end();
  });
}

/**
 * Simple health check via GET /health (doesn't need MCP session).
 */
function healthCheck() {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: graphitiHost,
      port: graphitiPort,
      path: '/health',
      method: 'GET',
      timeout: 5000,
    }, res => {
      let body = '';
      res.on('data', d => body += d);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(body) });
        } catch {
          resolve({ status: res.statusCode, data: body });
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Health check timeout')); });
    req.end();
  });
}

// ─── Session management ──────────────────────────────────────

/**
 * Initialize MCP session with Graphiti.
 */
async function initSession() {
  const res = await mcpRequest({
    jsonrpc: '2.0',
    id: ++rpcId,
    method: 'initialize',
    params: {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'agentplanner-bridge', version: '2.0' },
    },
  });

  if (res.status !== 200 || res.data?.error) {
    throw new Error(`MCP init failed: ${JSON.stringify(res.data?.error || res.data)}`);
  }

  // Send initialized notification (no response expected)
  await mcpRequest({ jsonrpc: '2.0', method: 'notifications/initialized' });

  return res.data?.result;
}

// ─── Public API ──────────────────────────────────────────────

/**
 * Initialize the bridge. Call once at startup.
 * Gracefully degrades if Graphiti is not configured or not reachable.
 */
async function init() {
  if (!GRAPHITI_URL) {
    console.log('[graphiti-bridge] GRAPHITI_INTERNAL_URL not set — knowledge graph disabled');
    available = false;
    return false;
  }

  // Parse URL
  try {
    const url = new URL(GRAPHITI_URL);
    graphitiHost = url.hostname;
    graphitiPort = parseInt(url.port) || 8000;
  } catch {
    console.warn('[graphiti-bridge] Invalid GRAPHITI_INTERNAL_URL:', GRAPHITI_URL);
    available = false;
    return false;
  }

  try {
    // Health check first
    const health = await healthCheck();
    if (health.status !== 200) throw new Error(`Health check returned ${health.status}`);

    // Initialize MCP session
    const initResult = await initSession();
    available = true;
    console.log('[graphiti-bridge] Connected to Graphiti at', GRAPHITI_URL);
    console.log('[graphiti-bridge] Server:', initResult?.serverInfo?.name, '| Session:', sessionId);
    return true;
  } catch (err) {
    console.warn('[graphiti-bridge] Graphiti not reachable at', GRAPHITI_URL, '—', err.message);
    available = false;
  }
  return false;
}

function isAvailable() {
  return available;
}

/**
 * Call a Graphiti MCP tool via the established session.
 */
async function callTool(toolName, args) {
  if (!available) return null;

  try {
    const res = await mcpRequest({
      jsonrpc: '2.0',
      id: ++rpcId,
      method: 'tools/call',
      params: { name: toolName, arguments: args },
    });

    // Handle session expiry — re-init and retry once
    if (res.status === 404 || res.status === 410) {
      console.log('[graphiti-bridge] Session expired, re-initializing...');
      sessionId = null;
      await initSession();
      const retry = await mcpRequest({
        jsonrpc: '2.0',
        id: ++rpcId,
        method: 'tools/call',
        params: { name: toolName, arguments: args },
      });
      return parseToolResult(retry.data);
    }

    return parseToolResult(res.data);
  } catch (err) {
    console.error(`[graphiti-bridge] Tool call ${toolName} failed:`, err.message);
    return null;
  }
}

/**
 * Extract the text result from an MCP tool response.
 */
function parseToolResult(data) {
  if (data?.error) {
    console.error('[graphiti-bridge] Tool error:', data.error.message);
    return null;
  }
  const result = data?.result;
  if (!result?.content) return result;

  const textContent = result.content.find(c => c.type === 'text');
  if (textContent?.text) {
    try { return JSON.parse(textContent.text); } catch { return textContent.text; }
  }
  return result;
}

// ─── Knowledge Operations ────────────────────────────────────

/**
 * Add an episode (knowledge entry) to Graphiti.
 * Graphiti tool: add_memory (requires name + episode_body).
 */
async function addEpisode({ content, group_id, name, source, source_description }) {
  return callTool('add_memory', {
    name: name || content.substring(0, 100),
    episode_body: content,
    group_id: group_id || 'default',
    source: source || 'text',
    source_description: source_description || 'AgentPlanner knowledge entry',
  });
}

/**
 * Search for relevant knowledge facts in Graphiti.
 * Graphiti tool: search_memory_facts (group_ids is an array).
 */
async function searchMemory({ query, group_id, max_results = 10 }) {
  // Transitional: include 'default' namespace so legacy data remains accessible
  const group_ids = [group_id || 'default'];
  if (group_id && group_id !== 'default') group_ids.push('default');
  return callTool('search_memory_facts', {
    query,
    group_ids,
    max_facts: max_results,
  });
}

/**
 * Search for entity nodes in Graphiti.
 * Graphiti tool: search_nodes (group_ids is an array).
 */
async function searchEntities({ query, group_id, max_results = 10 }) {
  // Transitional: include 'default' namespace so legacy data remains accessible
  const group_ids = [group_id || 'default'];
  if (group_id && group_id !== 'default') group_ids.push('default');
  return callTool('search_nodes', {
    query,
    group_ids,
    max_nodes: max_results,
  });
}

/**
 * Delete an episode from Graphiti.
 * Graphiti tool: delete_episode (uses uuid, not episode_id).
 */
async function deleteEpisode(episodeId) {
  return callTool('delete_episode', { uuid: episodeId });
}

/**
 * Get recent episodes from Graphiti.
 * Graphiti tool: get_episodes (group_ids is an array).
 */
async function getEpisodes({ group_id, max_episodes = 10 }) {
  // Transitional: include 'default' namespace so legacy data remains accessible
  const group_ids = [group_id || 'default'];
  if (group_id && group_id !== 'default') group_ids.push('default');
  return callTool('get_episodes', {
    group_ids,
    max_episodes,
  });
}

/**
 * Get the status/health of the Graphiti service.
 */
async function getStatus() {
  try {
    const health = await healthCheck();
    return { available: health.status === 200, status: health.data };
  } catch (err) {
    return { available: false, reason: err.message };
  }
}

// ─── Convenience helpers ─────────────────────────────────────

/**
 * Build the Graphiti group_id for an organization.
 * Each org gets its own isolated graph namespace.
 */
function orgGroupId(orgId) {
  return orgId ? `org_${orgId}` : 'default';
}

/**
 * Build group_id from a user object (preferred over orgGroupId).
 * Falls back to user-specific namespace instead of shared 'default'.
 */
function getGroupId(user) {
  if (user.organizationId) return `org_${user.organizationId}`;
  return `user_${user.id}`;
}

/**
 * Query Graphiti for knowledge relevant to a plan/task.
 * Used by the progressive context engine at Layer 3.
 */
async function queryForContext(planId, query, orgId, maxResults = 5) {
  if (!available) return [];

  const result = await searchMemory({
    query,
    group_id: orgGroupId(orgId),
    max_results: maxResults,
  });

  if (!result) return [];

  // Normalize response into simple array of facts
  if (Array.isArray(result)) {
    return result.map(r => ({
      content: r.fact || r.content || r.text || String(r),
      source: 'graphiti',
      relevance: r.score || r.relevance,
    }));
  }
  if (result.facts) return result.facts.map(f => ({
    content: f.fact || f.content || String(f),
    source: 'graphiti',
    relevance: f.score || f.relevance,
  }));
  if (result.results) return result.results.map(r => ({
    content: r.fact || r.content || String(r),
    source: 'graphiti',
    relevance: r.score,
  }));

  return [];
}

/**
 * Detect potential contradictions by searching for facts with expired_at set.
 * Graphiti marks old facts as expired when new contradicting info arrives.
 * Returns both current and superseded facts for a given query.
 */
async function detectContradictions({ query, group_id, max_results = 10 }) {
  if (!available) return { current: [], superseded: [], contradictions_found: false };

  const result = await searchMemory({ query, group_id, max_results });
  if (!result) return { current: [], superseded: [], contradictions_found: false };

  // Normalize result into facts array
  let facts = [];
  if (Array.isArray(result)) facts = result;
  else if (result.facts) facts = result.facts;
  else if (result.results) facts = result.results;
  else if (result.message && result.facts) facts = result.facts;

  const current = facts.filter(f => !f.expired_at);
  const superseded = facts.filter(f => f.expired_at);

  return {
    current: current.map(f => ({
      uuid: f.uuid,
      fact: f.fact || f.content,
      valid_at: f.valid_at,
      name: f.name,
    })),
    superseded: superseded.map(f => ({
      uuid: f.uuid,
      fact: f.fact || f.content,
      valid_at: f.valid_at,
      expired_at: f.expired_at,
      name: f.name,
    })),
    contradictions_found: superseded.length > 0,
  };
}

module.exports = {
  init,
  isAvailable,
  addEpisode,
  searchMemory,
  searchEntities,
  deleteEpisode,
  getEpisodes,
  getStatus,
  orgGroupId,
  getGroupId,
  queryForContext,
  detectContradictions,
  callTool,
};
