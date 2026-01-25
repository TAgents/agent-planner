/**
 * Task Command Handlers
 *
 * Handles all /task subcommands for creating and managing tasks within plans.
 */

/**
 * Add a task to a plan or phase
 * Usage: /task add "Task title" to #parent-id
 */
export async function addTask(skill, parsed, context) {
  const { title, parent_id } = parsed.args;

  if (!title) {
    return skill.formatter.error('Please provide a task title. Example: `/task add "Design homepage" to #plan-abc123`');
  }

  // Determine the parent - either provided or from default plan
  let parentId = parent_id;
  let planId = null;

  if (!parentId) {
    if (skill.config.default_plan) {
      // Use default plan's root node
      parentId = skill.config.default_plan;
      planId = skill.config.default_plan;
    } else {
      return skill.formatter.error('Please specify where to add the task. Example: `/task add "Task name" to #plan-abc123`');
    }
  }

  try {
    // If parent is a plan ID, we need to get the root node
    let parent;
    let rootNodeId;

    try {
      // First try to get as a node
      parent = await skill.api.nodes.get(parentId);
      planId = parent.plan_id;
      rootNodeId = parent.id;
    } catch (nodeError) {
      // If not found as node, try as plan
      if (nodeError.isNotFound) {
        const plan = await skill.api.plans.get(parentId);
        planId = plan.id;
        // Get root node ID from plan
        rootNodeId = plan.root_node?.id || plan.root_node_id;

        if (!rootNodeId) {
          // Fetch plan tree to get root node
          const tree = await skill.api.plans.getTree(planId);
          rootNodeId = tree.id;
        }
        parent = { title: plan.title };
      } else {
        throw nodeError;
      }
    }

    // Create the task
    const task = await skill.api.nodes.create(planId, {
      title,
      node_type: 'task',
      parent_id: rootNodeId,
      status: 'not_started'
    });

    return skill.formatter.nodeCreated(task, parent.title);
  } catch (error) {
    console.error('[AgentPlanner] Failed to add task:', error);

    if (error.isNotFound) {
      return skill.formatter.notFound('plan or node', parentId);
    }

    if (error.isUnauthorized) {
      return skill.formatter.unauthorized();
    }

    return skill.formatter.error(`Failed to add task: ${error.message}`);
  }
}

/**
 * Update task status
 * Usage: /task status #task-id completed
 */
export async function updateTaskStatus(skill, parsed, context) {
  const { id, status } = parsed.args;

  if (!id) {
    return skill.formatter.error('Please provide a task ID. Example: `/task status #task-abc123 completed`');
  }

  const validStatuses = ['not_started', 'in_progress', 'completed', 'blocked'];
  if (!status || !validStatuses.includes(status)) {
    return skill.formatter.error(`Invalid status. Use one of: ${validStatuses.join(', ')}`);
  }

  try {
    const node = await skill.api.nodes.update(id, { status });

    return skill.formatter.nodeUpdated(node, { status });
  } catch (error) {
    console.error('[AgentPlanner] Failed to update task status:', error);

    if (error.isNotFound) {
      return skill.formatter.notFound('task', id);
    }

    if (error.isUnauthorized) {
      return skill.formatter.unauthorized();
    }

    return skill.formatter.error(`Failed to update status: ${error.message}`);
  }
}

/**
 * Assign a user to a task
 * Usage: /task assign #task-id @username
 */
export async function assignTask(skill, parsed, context) {
  const { id, user: username } = parsed.args;

  if (!id) {
    return skill.formatter.error('Please provide a task ID. Example: `/task assign #task-abc123 @john`');
  }

  if (!username) {
    return skill.formatter.error('Please specify a user to assign. Example: `/task assign #task-abc123 @john`');
  }

  try {
    // First get the node to display the title
    const node = await skill.api.nodes.get(id);

    // Search for the user
    const users = await skill.api.users.search(username);

    if (!users || users.length === 0) {
      return skill.formatter.error(`Could not find user "@${username}"`);
    }

    // Use first matching user
    const user = users[0];

    // Create assignment
    await skill.api.assignments.assign(id, user.id);

    return skill.formatter.userAssigned(node.title, user.display_name || user.email || username);
  } catch (error) {
    console.error('[AgentPlanner] Failed to assign task:', error);

    if (error.isNotFound) {
      return skill.formatter.notFound('task', id);
    }

    if (error.isUnauthorized) {
      return skill.formatter.unauthorized();
    }

    return skill.formatter.error(`Failed to assign task: ${error.message}`);
  }
}

/**
 * Add a comment to a task
 * Usage: /task comment #task-id "Comment message"
 */
export async function commentTask(skill, parsed, context) {
  const { id, content } = parsed.args;

  if (!id) {
    return skill.formatter.error('Please provide a task ID. Example: `/task comment #task-abc123 "Great progress!"`');
  }

  if (!content) {
    return skill.formatter.error('Please provide a comment. Example: `/task comment #task-abc123 "Great progress!"`');
  }

  try {
    // Get node for title
    const node = await skill.api.nodes.get(id);

    // Add the comment
    await skill.api.nodes.addComment(id, {
      content,
      comment_type: 'agent' // Comments from clawdbot are marked as agent
    });

    return skill.formatter.commentAdded(node.title);
  } catch (error) {
    console.error('[AgentPlanner] Failed to add comment:', error);

    if (error.isNotFound) {
      return skill.formatter.notFound('task', id);
    }

    if (error.isUnauthorized) {
      return skill.formatter.unauthorized();
    }

    return skill.formatter.error(`Failed to add comment: ${error.message}`);
  }
}

/**
 * Add an activity log to a task
 * Usage: /task log #task-id "Log message"
 */
export async function logTask(skill, parsed, context) {
  const { id, content } = parsed.args;

  if (!id) {
    return skill.formatter.error('Please provide a task ID. Example: `/task log #task-abc123 "Completed API integration"`');
  }

  if (!content) {
    return skill.formatter.error('Please provide a log message. Example: `/task log #task-abc123 "Completed API integration"`');
  }

  try {
    // Get node for title
    const node = await skill.api.nodes.get(id);

    // Determine log type from content keywords
    let logType = 'progress';
    const lowerContent = content.toLowerCase();

    if (lowerContent.includes('decided') || lowerContent.includes('decision') || lowerContent.includes('chose')) {
      logType = 'decision';
    } else if (lowerContent.includes('challenge') || lowerContent.includes('issue') || lowerContent.includes('problem') || lowerContent.includes('blocked')) {
      logType = 'challenge';
    } else if (lowerContent.includes('because') || lowerContent.includes('reasoning') || lowerContent.includes('rationale')) {
      logType = 'reasoning';
    }

    // Add the log
    await skill.api.nodes.addLog(id, {
      content,
      log_type: logType,
      tags: ['clawdbot']
    });

    return skill.formatter.logAdded(node.title, logType);
  } catch (error) {
    console.error('[AgentPlanner] Failed to add log:', error);

    if (error.isNotFound) {
      return skill.formatter.notFound('task', id);
    }

    if (error.isUnauthorized) {
      return skill.formatter.unauthorized();
    }

    return skill.formatter.error(`Failed to add log: ${error.message}`);
  }
}
