/**
 * API Client for Agent Planner
 *
 * Handles all REST API interactions with the Agent Planner backend.
 */

export class ApiClient {
  constructor(options) {
    this.baseUrl = options.baseUrl.replace(/\/$/, '');
    this.token = options.token;
    this.timeout = options.timeout || 30000;
  }

  /**
   * Make an authenticated API request
   */
  async request(method, path, body = null, options = {}) {
    const url = `${this.baseUrl}${path}`;

    const headers = {
      'Authorization': `Bearer ${this.token}`,
      'Content-Type': 'application/json',
      'User-Agent': 'Clawdbot-AgentPlanner-Skill/1.0'
    };

    const fetchOptions = {
      method,
      headers,
      signal: AbortSignal.timeout(this.timeout)
    };

    if (body && (method === 'POST' || method === 'PUT' || method === 'PATCH')) {
      fetchOptions.body = JSON.stringify(body);
    }

    const response = await fetch(url, fetchOptions);

    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: response.statusText }));
      throw new ApiError(response.status, error.message || 'Request failed', error);
    }

    // Handle 204 No Content
    if (response.status === 204) {
      return null;
    }

    return response.json();
  }

  /**
   * Health check endpoint
   */
  async healthCheck() {
    return this.request('GET', '/health');
  }

  /**
   * Plan operations
   */
  plans = {
    /**
     * Create a new plan
     */
    create: async (data) => {
      return this.request('POST', '/plans', {
        title: data.title,
        description: data.description || '',
        status: data.status || 'draft',
        metadata: data.metadata || {}
      });
    },

    /**
     * List plans with optional filters
     */
    list: async (options = {}) => {
      const params = new URLSearchParams();
      if (options.status) params.set('status', options.status);
      if (options.limit) params.set('limit', options.limit);
      if (options.page) params.set('page', options.page);
      if (options.search) params.set('search', options.search);

      const query = params.toString();
      return this.request('GET', `/plans${query ? `?${query}` : ''}`);
    },

    /**
     * Get a single plan with its root node
     */
    get: async (planId) => {
      return this.request('GET', `/plans/${planId}`);
    },

    /**
     * Update a plan
     */
    update: async (planId, data) => {
      return this.request('PUT', `/plans/${planId}`, data);
    },

    /**
     * Delete a plan
     */
    delete: async (planId) => {
      return this.request('DELETE', `/plans/${planId}`);
    },

    /**
     * Get plan progress
     */
    getProgress: async (planId) => {
      return this.request('GET', `/plans/${planId}/progress`);
    },

    /**
     * Get plan context (full tree with AI context)
     */
    getContext: async (planId) => {
      return this.request('GET', `/plans/${planId}/context`);
    },

    /**
     * Get plan tree structure
     */
    getTree: async (planId) => {
      return this.request('GET', `/plans/${planId}/tree`);
    }
  };

  /**
   * Node operations
   */
  nodes = {
    /**
     * Create a new node
     */
    create: async (planId, data) => {
      return this.request('POST', `/plans/${planId}/nodes`, {
        title: data.title,
        description: data.description || '',
        node_type: data.node_type || 'task',
        parent_id: data.parent_id || null,
        status: data.status || 'not_started',
        agent_instructions: data.agent_instructions || '',
        acceptance_criteria: data.acceptance_criteria || '',
        context: data.context || '',
        due_date: data.due_date || null,
        metadata: data.metadata || {}
      });
    },

    /**
     * Get a node by ID
     */
    get: async (nodeId) => {
      return this.request('GET', `/nodes/${nodeId}`);
    },

    /**
     * Update a node
     */
    update: async (nodeId, data) => {
      return this.request('PUT', `/nodes/${nodeId}`, data);
    },

    /**
     * Delete a node
     */
    delete: async (nodeId) => {
      return this.request('DELETE', `/nodes/${nodeId}`);
    },

    /**
     * Move a node to a new parent or position
     */
    move: async (nodeId, data) => {
      return this.request('PUT', `/nodes/${nodeId}/move`, {
        new_parent_id: data.new_parent_id,
        new_order: data.new_order
      });
    },

    /**
     * Get node children
     */
    getChildren: async (nodeId) => {
      return this.request('GET', `/nodes/${nodeId}/children`);
    },

    /**
     * Add a comment to a node
     */
    addComment: async (nodeId, data) => {
      return this.request('POST', `/nodes/${nodeId}/comments`, {
        content: data.content,
        comment_type: data.comment_type || 'agent'
      });
    },

    /**
     * Get comments for a node
     */
    getComments: async (nodeId) => {
      return this.request('GET', `/nodes/${nodeId}/comments`);
    },

    /**
     * Add an activity log to a node
     */
    addLog: async (nodeId, data) => {
      return this.request('POST', `/nodes/${nodeId}/logs`, {
        content: data.content,
        log_type: data.log_type || 'progress',
        tags: data.tags || []
      });
    },

    /**
     * Get logs for a node
     */
    getLogs: async (nodeId) => {
      return this.request('GET', `/nodes/${nodeId}/logs`);
    }
  };

  /**
   * Assignment operations
   */
  assignments = {
    /**
     * Assign a user to a node
     */
    assign: async (nodeId, userId) => {
      return this.request('POST', `/nodes/${nodeId}/assignments`, {
        user_id: userId
      });
    },

    /**
     * Remove assignment from a node
     */
    unassign: async (nodeId, userId) => {
      return this.request('DELETE', `/nodes/${nodeId}/assignments/${userId}`);
    },

    /**
     * Get assignments for a node
     */
    get: async (nodeId) => {
      return this.request('GET', `/nodes/${nodeId}/assignments`);
    }
  };

  /**
   * Search operations
   */
  search = {
    /**
     * Search across plans and nodes
     */
    query: async (options) => {
      const params = new URLSearchParams();
      if (options.q) params.set('q', options.q);
      if (options.type) params.set('type', options.type);
      if (options.status) params.set('status', options.status);
      if (options.plan_id) params.set('plan_id', options.plan_id);
      if (options.limit) params.set('limit', options.limit);

      const query = params.toString();
      return this.request('GET', `/search${query ? `?${query}` : ''}`);
    }
  };

  /**
   * User operations
   */
  users = {
    /**
     * Get current user profile
     */
    me: async () => {
      return this.request('GET', '/auth/me');
    },

    /**
     * Get user by ID
     */
    get: async (userId) => {
      return this.request('GET', `/users/${userId}`);
    },

    /**
     * Search users
     */
    search: async (query) => {
      return this.request('GET', `/users/search?q=${encodeURIComponent(query)}`);
    }
  };
}

/**
 * Custom API Error class
 */
export class ApiError extends Error {
  constructor(status, message, details = null) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.details = details;
  }

  get isNotFound() {
    return this.status === 404;
  }

  get isUnauthorized() {
    return this.status === 401;
  }

  get isForbidden() {
    return this.status === 403;
  }

  get isValidationError() {
    return this.status === 400;
  }

  get isServerError() {
    return this.status >= 500;
  }
}
