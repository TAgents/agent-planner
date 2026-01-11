const { supabase, supabaseAdmin } = require('../config/supabase');
const logger = require('../utils/logger');

/**
 * Get the GitHub access token for the authenticated user
 * Requires the user to have signed in with GitHub OAuth
 */
const getGitHubToken = async (req) => {
  // The provider_token is passed in the session when user authenticates via GitHub OAuth
  // We need to get it from the current session
  const authHeader = req.headers.authorization;
  if (!authHeader) return null;

  const token = authHeader.split(' ')[1];
  if (!token) return null;

  try {
    // Get the session to access provider_token
    const { data, error } = await supabaseAdmin.auth.getUser(token);

    if (error || !data.user) {
      await logger.github(`Failed to get user for GitHub token: ${error?.message}`);
      return null;
    }

    // Check if user signed in with GitHub
    if (data.user.app_metadata?.provider !== 'github') {
      await logger.github(`User ${data.user.email} did not sign in with GitHub`);
      return null;
    }

    // The provider_token should be stored in identities
    // Note: Supabase stores the OAuth provider token
    // We need to get it from the auth session
    const { data: sessionData, error: sessionError } = await supabase.auth.setSession({
      access_token: token,
      refresh_token: ''
    });

    if (sessionError) {
      // Try to get provider token from the database if stored
      await logger.github(`Session error: ${sessionError.message}`);
    }

    // Get the provider token from session
    if (sessionData?.session?.provider_token) {
      return sessionData.session.provider_token;
    }

    // If no provider token in session, check user metadata
    // The user might need to re-authenticate
    await logger.github(`No GitHub provider token found for user ${data.user.email}`);
    return null;
  } catch (error) {
    await logger.error('Error getting GitHub token', error);
    return null;
  }
};

/**
 * Make a request to the GitHub API
 */
const githubApiRequest = async (endpoint, options = {}, token) => {
  const baseUrl = 'https://api.github.com';
  const url = `${baseUrl}${endpoint}`;

  const headers = {
    'Accept': 'application/vnd.github.v3+json',
    'User-Agent': 'AgentPlanner-App',
    ...(token && { 'Authorization': `Bearer ${token}` })
  };

  const response = await fetch(url, {
    ...options,
    headers: {
      ...headers,
      ...options.headers
    }
  });

  // Check rate limit headers
  const remaining = response.headers.get('X-RateLimit-Remaining');
  const resetTime = response.headers.get('X-RateLimit-Reset');

  if (remaining && parseInt(remaining) < 10) {
    await logger.github(`GitHub API rate limit warning: ${remaining} requests remaining. Resets at ${new Date(resetTime * 1000).toISOString()}`);
  }

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`GitHub API error: ${response.status} - ${errorBody}`);
  }

  return response.json();
};

/**
 * List user's GitHub repositories
 */
const listRepos = async (req, res, next) => {
  try {
    await logger.github(`Fetching repos for user: ${req.user.email}`);

    const githubToken = await getGitHubToken(req);

    if (!githubToken) {
      return res.status(400).json({
        error: 'GitHub not connected',
        message: 'Please sign in with GitHub to access this feature',
        code: 'GITHUB_NOT_CONNECTED'
      });
    }

    // Fetch user's repos (including private ones if they authorized)
    const repos = await githubApiRequest('/user/repos?sort=updated&per_page=100', {}, githubToken);

    // Return simplified repo data
    const simplifiedRepos = repos.map(repo => ({
      id: repo.id,
      name: repo.name,
      full_name: repo.full_name,
      owner: repo.owner.login,
      description: repo.description,
      html_url: repo.html_url,
      private: repo.private,
      language: repo.language,
      stargazers_count: repo.stargazers_count,
      forks_count: repo.forks_count,
      updated_at: repo.updated_at,
      default_branch: repo.default_branch
    }));

    await logger.github(`Found ${simplifiedRepos.length} repos for user: ${req.user.email}`);
    res.json({ repos: simplifiedRepos });
  } catch (error) {
    await logger.error('Error listing GitHub repos', error);
    next(error);
  }
};

/**
 * Get repository details
 */
const getRepo = async (req, res, next) => {
  try {
    const { owner, name } = req.params;
    await logger.github(`Fetching repo details: ${owner}/${name}`);

    const githubToken = await getGitHubToken(req);

    // Public repos can be fetched without token
    const repo = await githubApiRequest(`/repos/${owner}/${name}`, {}, githubToken);

    res.json({
      id: repo.id,
      name: repo.name,
      full_name: repo.full_name,
      owner: repo.owner.login,
      description: repo.description,
      html_url: repo.html_url,
      private: repo.private,
      language: repo.language,
      stargazers_count: repo.stargazers_count,
      forks_count: repo.forks_count,
      open_issues_count: repo.open_issues_count,
      updated_at: repo.updated_at,
      default_branch: repo.default_branch,
      topics: repo.topics || []
    });
  } catch (error) {
    await logger.error(`Error getting repo ${req.params.owner}/${req.params.name}`, error);

    if (error.message.includes('404')) {
      return res.status(404).json({ error: 'Repository not found' });
    }
    next(error);
  }
};

/**
 * Get repository content (README and file structure)
 */
const getRepoContent = async (req, res, next) => {
  try {
    const { owner, name } = req.params;
    await logger.github(`Fetching repo content: ${owner}/${name}`);

    const githubToken = await getGitHubToken(req);

    // Get README
    let readme = null;
    try {
      const readmeData = await githubApiRequest(`/repos/${owner}/${name}/readme`, {}, githubToken);
      if (readmeData.content) {
        // Decode base64 content
        readme = Buffer.from(readmeData.content, 'base64').toString('utf-8');
      }
    } catch (readmeError) {
      await logger.github(`No README found for ${owner}/${name}`);
    }

    // Get root directory contents
    let fileStructure = [];
    try {
      const contents = await githubApiRequest(`/repos/${owner}/${name}/contents`, {}, githubToken);
      fileStructure = contents.map(item => ({
        name: item.name,
        type: item.type, // 'file' or 'dir'
        path: item.path,
        size: item.size
      }));
    } catch (contentsError) {
      await logger.github(`Could not fetch contents for ${owner}/${name}`);
    }

    // Get repo languages
    let languages = {};
    try {
      languages = await githubApiRequest(`/repos/${owner}/${name}/languages`, {}, githubToken);
    } catch (langError) {
      await logger.github(`Could not fetch languages for ${owner}/${name}`);
    }

    res.json({
      readme,
      file_structure: fileStructure,
      languages
    });
  } catch (error) {
    await logger.error(`Error getting repo content ${req.params.owner}/${req.params.name}`, error);

    if (error.message.includes('404')) {
      return res.status(404).json({ error: 'Repository not found' });
    }
    next(error);
  }
};

/**
 * Create a GitHub issue in a repository
 */
const createIssue = async (req, res, next) => {
  try {
    const { owner, name } = req.params;
    const { title, body, labels } = req.body;

    await logger.github(`Creating issue in ${owner}/${name}: "${title}"`);

    const githubToken = await getGitHubToken(req);

    if (!githubToken) {
      return res.status(400).json({
        error: 'GitHub not connected',
        message: 'Please sign in with GitHub to create issues',
        code: 'GITHUB_NOT_CONNECTED'
      });
    }

    if (!title) {
      return res.status(400).json({ error: 'Issue title is required' });
    }

    const issue = await githubApiRequest(`/repos/${owner}/${name}/issues`, {
      method: 'POST',
      body: JSON.stringify({
        title,
        body: body || '',
        labels: labels || []
      }),
      headers: {
        'Content-Type': 'application/json'
      }
    }, githubToken);

    await logger.github(`Created issue #${issue.number} in ${owner}/${name}`);

    res.status(201).json({
      id: issue.id,
      number: issue.number,
      title: issue.title,
      html_url: issue.html_url,
      state: issue.state,
      created_at: issue.created_at
    });
  } catch (error) {
    await logger.error(`Error creating issue in ${req.params.owner}/${req.params.name}`, error);

    if (error.message.includes('404')) {
      return res.status(404).json({ error: 'Repository not found or you do not have permission to create issues' });
    }
    if (error.message.includes('403')) {
      return res.status(403).json({ error: 'You do not have permission to create issues in this repository' });
    }
    next(error);
  }
};

/**
 * Bulk create GitHub issues from plan tasks
 */
const createIssuesFromTasks = async (req, res, next) => {
  try {
    const { owner, name } = req.params;
    const { tasks, planTitle, planUrl } = req.body;

    await logger.github(`Creating ${tasks?.length || 0} issues in ${owner}/${name} from plan: ${planTitle}`);

    const githubToken = await getGitHubToken(req);

    if (!githubToken) {
      return res.status(400).json({
        error: 'GitHub not connected',
        message: 'Please sign in with GitHub to create issues',
        code: 'GITHUB_NOT_CONNECTED'
      });
    }

    if (!tasks || !Array.isArray(tasks) || tasks.length === 0) {
      return res.status(400).json({ error: 'Tasks array is required' });
    }

    const results = [];
    const errors = [];

    for (const task of tasks) {
      try {
        // Build issue body with task details
        let issueBody = '';

        if (task.description) {
          issueBody += `## Description\n${task.description}\n\n`;
        }

        if (task.acceptance_criteria) {
          issueBody += `## Acceptance Criteria\n${task.acceptance_criteria}\n\n`;
        }

        if (task.context) {
          issueBody += `## Context\n${task.context}\n\n`;
        }

        // Add footer with link back to AgentPlanner
        issueBody += `---\n`;
        issueBody += `*Created from [${planTitle}](${planUrl}) via [AgentPlanner.io](https://agentplanner.io)*`;

        // Build labels based on node type and status
        const labels = [];
        if (task.node_type) {
          labels.push(task.node_type); // phase, task, milestone
        }
        if (task.status && task.status !== 'not_started') {
          labels.push(task.status); // in_progress, completed, blocked
        }

        const issue = await githubApiRequest(`/repos/${owner}/${name}/issues`, {
          method: 'POST',
          body: JSON.stringify({
            title: task.title,
            body: issueBody,
            labels
          }),
          headers: {
            'Content-Type': 'application/json'
          }
        }, githubToken);

        results.push({
          task_id: task.id,
          task_title: task.title,
          issue_number: issue.number,
          issue_url: issue.html_url,
          success: true
        });

        // Add a small delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 100));
      } catch (taskError) {
        errors.push({
          task_id: task.id,
          task_title: task.title,
          error: taskError.message,
          success: false
        });
      }
    }

    await logger.github(`Created ${results.length} issues, ${errors.length} errors in ${owner}/${name}`);

    res.status(201).json({
      created: results.length,
      failed: errors.length,
      results,
      errors
    });
  } catch (error) {
    await logger.error(`Error bulk creating issues in ${req.params.owner}/${req.params.name}`, error);
    next(error);
  }
};

/**
 * Search repositories (for autocomplete)
 */
const searchRepos = async (req, res, next) => {
  try {
    const { q } = req.query;

    if (!q || q.length < 2) {
      return res.status(400).json({ error: 'Query must be at least 2 characters' });
    }

    await logger.github(`Searching repos for: ${q}`);

    const githubToken = await getGitHubToken(req);

    // Search in user's repos first
    const searchQuery = githubToken
      ? `${q} user:${req.user.email?.split('@')[0] || ''}`
      : q;

    const searchResults = await githubApiRequest(
      `/search/repositories?q=${encodeURIComponent(searchQuery)}&sort=updated&per_page=20`,
      {},
      githubToken
    );

    const repos = searchResults.items?.map(repo => ({
      id: repo.id,
      name: repo.name,
      full_name: repo.full_name,
      owner: repo.owner.login,
      description: repo.description,
      html_url: repo.html_url,
      private: repo.private,
      language: repo.language,
      stargazers_count: repo.stargazers_count
    })) || [];

    res.json({ repos });
  } catch (error) {
    await logger.error('Error searching GitHub repos', error);
    next(error);
  }
};

/**
 * Check if user has GitHub connected
 */
const checkGitHubConnection = async (req, res, next) => {
  try {
    await logger.github(`Checking GitHub connection for: ${req.user.email}`);

    // Check if user has GitHub profile data
    const { data: userData, error } = await supabaseAdmin
      .from('users')
      .select('github_id, github_username, github_avatar_url')
      .eq('id', req.user.id)
      .single();

    if (error) {
      await logger.error('Error checking GitHub connection', error);
      return res.status(500).json({ error: 'Failed to check GitHub connection' });
    }

    const isConnected = !!(userData?.github_id && userData?.github_username);

    res.json({
      connected: isConnected,
      github_username: userData?.github_username || null,
      github_avatar_url: userData?.github_avatar_url || null
    });
  } catch (error) {
    await logger.error('Error checking GitHub connection', error);
    next(error);
  }
};

module.exports = {
  listRepos,
  getRepo,
  getRepoContent,
  createIssue,
  createIssuesFromTasks,
  searchRepos,
  checkGitHubConnection
};
