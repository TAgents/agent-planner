const { auth, adminAuth } = require('../services/supabase-auth');
const { usersDal } = require('../db/dal.cjs');
const logger = require('../utils/logger');

/**
 * Get the GitHub access token for the authenticated user
 */
const getGitHubToken = async (req) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return null;
  const token = authHeader.split(' ')[1];
  if (!token) return null;

  try {
    const { data, error } = await adminAuth.getUser(token);
    if (error || !data.user) return null;
    if (data.user.app_metadata?.provider !== 'github') return null;

    const { data: sessionData } = await auth.setSession({ access_token: token, refresh_token: '' });
    if (sessionData?.session?.provider_token) return sessionData.session.provider_token;

    return null;
  } catch (error) {
    await logger.error('Error getting GitHub token', error);
    return null;
  }
};

const githubApiRequest = async (endpoint, options = {}, token) => {
  const url = `https://api.github.com${endpoint}`;
  const headers = {
    'Accept': 'application/vnd.github.v3+json',
    'User-Agent': 'AgentPlanner-App',
    ...(token && { 'Authorization': `Bearer ${token}` })
  };

  const response = await fetch(url, { ...options, headers: { ...headers, ...options.headers } });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`GitHub API error: ${response.status} - ${errorBody}`);
  }

  return response.json();
};

const listRepos = async (req, res, next) => {
  try {
    const githubToken = await getGitHubToken(req);
    if (!githubToken) {
      return res.status(400).json({ error: 'GitHub not connected', code: 'GITHUB_NOT_CONNECTED' });
    }

    const repos = await githubApiRequest('/user/repos?sort=updated&per_page=100', {}, githubToken);
    res.json({
      repos: repos.map(repo => ({
        id: repo.id, name: repo.name, full_name: repo.full_name, owner: repo.owner.login,
        description: repo.description, html_url: repo.html_url, private: repo.private,
        language: repo.language, stargazers_count: repo.stargazers_count,
        forks_count: repo.forks_count, updated_at: repo.updated_at, default_branch: repo.default_branch
      }))
    });
  } catch (error) {
    next(error);
  }
};

const getRepo = async (req, res, next) => {
  try {
    const { owner, name } = req.params;
    const githubToken = await getGitHubToken(req);
    const repo = await githubApiRequest(`/repos/${owner}/${name}`, {}, githubToken);

    res.json({
      id: repo.id, name: repo.name, full_name: repo.full_name, owner: repo.owner.login,
      description: repo.description, html_url: repo.html_url, private: repo.private,
      language: repo.language, stargazers_count: repo.stargazers_count,
      forks_count: repo.forks_count, open_issues_count: repo.open_issues_count,
      updated_at: repo.updated_at, default_branch: repo.default_branch, topics: repo.topics || []
    });
  } catch (error) {
    if (error.message.includes('404')) return res.status(404).json({ error: 'Repository not found' });
    next(error);
  }
};

const getRepoContent = async (req, res, next) => {
  try {
    const { owner, name } = req.params;
    const githubToken = await getGitHubToken(req);

    let readme = null;
    try {
      const readmeData = await githubApiRequest(`/repos/${owner}/${name}/readme`, {}, githubToken);
      if (readmeData.content) readme = Buffer.from(readmeData.content, 'base64').toString('utf-8');
    } catch (e) {}

    let fileStructure = [];
    try {
      const contents = await githubApiRequest(`/repos/${owner}/${name}/contents`, {}, githubToken);
      fileStructure = contents.map(item => ({ name: item.name, type: item.type, path: item.path, size: item.size }));
    } catch (e) {}

    let languages = {};
    try { languages = await githubApiRequest(`/repos/${owner}/${name}/languages`, {}, githubToken); } catch (e) {}

    res.json({ readme, file_structure: fileStructure, languages });
  } catch (error) {
    if (error.message.includes('404')) return res.status(404).json({ error: 'Repository not found' });
    next(error);
  }
};

const createIssue = async (req, res, next) => {
  try {
    const { owner, name } = req.params;
    const { title, body, labels } = req.body;
    const githubToken = await getGitHubToken(req);

    if (!githubToken) return res.status(400).json({ error: 'GitHub not connected', code: 'GITHUB_NOT_CONNECTED' });
    if (!title) return res.status(400).json({ error: 'Issue title is required' });

    const issue = await githubApiRequest(`/repos/${owner}/${name}/issues`, {
      method: 'POST',
      body: JSON.stringify({ title, body: body || '', labels: labels || [] }),
      headers: { 'Content-Type': 'application/json' }
    }, githubToken);

    res.status(201).json({
      id: issue.id, number: issue.number, title: issue.title,
      html_url: issue.html_url, state: issue.state, created_at: issue.created_at
    });
  } catch (error) {
    if (error.message.includes('404')) return res.status(404).json({ error: 'Repository not found' });
    if (error.message.includes('403')) return res.status(403).json({ error: 'Permission denied' });
    next(error);
  }
};

const createIssuesFromTasks = async (req, res, next) => {
  try {
    const { owner, name } = req.params;
    const { tasks, planTitle, planUrl } = req.body;
    const githubToken = await getGitHubToken(req);

    if (!githubToken) return res.status(400).json({ error: 'GitHub not connected', code: 'GITHUB_NOT_CONNECTED' });
    if (!tasks || !Array.isArray(tasks) || tasks.length === 0) return res.status(400).json({ error: 'Tasks array is required' });

    const results = [];
    const errors = [];

    for (const task of tasks) {
      try {
        let issueBody = '';
        if (task.description) issueBody += `## Description\n${task.description}\n\n`;
        if (task.context) issueBody += `## Context\n${task.context}\n\n`;
        issueBody += `---\n*Created from [${planTitle}](${planUrl}) via [AgentPlanner.io](https://agentplanner.io)*`;

        const labels = [];
        if (task.node_type) labels.push(task.node_type);
        if (task.status && task.status !== 'not_started') labels.push(task.status);

        const issue = await githubApiRequest(`/repos/${owner}/${name}/issues`, {
          method: 'POST', body: JSON.stringify({ title: task.title, body: issueBody, labels }),
          headers: { 'Content-Type': 'application/json' }
        }, githubToken);

        results.push({ task_id: task.id, task_title: task.title, issue_number: issue.number, issue_url: issue.html_url, success: true });
        await new Promise(resolve => setTimeout(resolve, 100));
      } catch (taskError) {
        errors.push({ task_id: task.id, task_title: task.title, error: taskError.message, success: false });
      }
    }

    res.status(201).json({ created: results.length, failed: errors.length, results, errors });
  } catch (error) {
    next(error);
  }
};

const searchRepos = async (req, res, next) => {
  try {
    const { q } = req.query;
    if (!q || q.length < 2) return res.status(400).json({ error: 'Query must be at least 2 characters' });

    const githubToken = await getGitHubToken(req);
    const searchResults = await githubApiRequest(`/search/repositories?q=${encodeURIComponent(q)}&sort=updated&per_page=20`, {}, githubToken);

    res.json({
      repos: (searchResults.items || []).map(repo => ({
        id: repo.id, name: repo.name, full_name: repo.full_name, owner: repo.owner.login,
        description: repo.description, html_url: repo.html_url, private: repo.private,
        language: repo.language, stargazers_count: repo.stargazers_count
      }))
    });
  } catch (error) {
    next(error);
  }
};

const checkGitHubConnection = async (req, res, next) => {
  try {
    const userData = await usersDal.findById(req.user.id);
    const isConnected = !!(userData?.githubId && userData?.githubUsername);

    res.json({
      connected: isConnected,
      github_username: userData?.githubUsername || null,
      github_avatar_url: userData?.githubAvatarUrl || null
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  listRepos, getRepo, getRepoContent, createIssue,
  createIssuesFromTasks, searchRepos, checkGitHubConnection
};
