/**
 * Plan Command Handlers
 *
 * Handles all /plan subcommands for creating, viewing, and managing plans.
 */

/**
 * Create a new plan
 * Usage: /plan create "My Plan Title"
 */
export async function createPlan(skill, parsed, context) {
  const { title } = parsed.args;

  if (!title) {
    return skill.formatter.error('Please provide a plan title. Example: `/plan create "Website Redesign"`');
  }

  try {
    const plan = await skill.api.plans.create({
      title,
      status: 'draft'
    });

    return skill.formatter.planCreated(plan);
  } catch (error) {
    console.error('[AgentPlanner] Failed to create plan:', error);

    if (error.isUnauthorized) {
      return skill.formatter.unauthorized();
    }

    return skill.formatter.error(`Failed to create plan: ${error.message}`);
  }
}

/**
 * List all plans for the current user
 * Usage: /plan list [status]
 */
export async function listPlans(skill, parsed, context) {
  const { status } = parsed.args;

  try {
    const result = await skill.api.plans.list({
      status,
      limit: 20
    });

    // Handle paginated response
    const plans = result.plans || result;

    return skill.formatter.plansList(plans);
  } catch (error) {
    console.error('[AgentPlanner] Failed to list plans:', error);

    if (error.isUnauthorized) {
      return skill.formatter.unauthorized();
    }

    return skill.formatter.error(`Failed to list plans: ${error.message}`);
  }
}

/**
 * Show details of a specific plan
 * Usage: /plan show #plan-id
 */
export async function showPlan(skill, parsed, context) {
  const { id } = parsed.args;

  if (!id) {
    return skill.formatter.error('Please provide a plan ID. Example: `/plan show #plan-abc123`');
  }

  try {
    // Fetch plan and tree in parallel
    const [plan, treeResult] = await Promise.all([
      skill.api.plans.get(id),
      skill.api.plans.getTree(id).catch(() => null)
    ]);

    // Get progress
    const progress = await skill.api.plans.getProgress(id).catch(() => null);
    if (progress) {
      plan.progress = progress.progress;
    }

    return skill.formatter.planDetails(plan, treeResult);
  } catch (error) {
    console.error('[AgentPlanner] Failed to show plan:', error);

    if (error.isNotFound) {
      return skill.formatter.notFound('plan', id);
    }

    if (error.isUnauthorized) {
      return skill.formatter.unauthorized();
    }

    return skill.formatter.error(`Failed to get plan: ${error.message}`);
  }
}

/**
 * Delete a plan
 * Usage: /plan delete #plan-id
 */
export async function deletePlan(skill, parsed, context) {
  const { id } = parsed.args;

  if (!id) {
    return skill.formatter.error('Please provide a plan ID. Example: `/plan delete #plan-abc123`');
  }

  try {
    // Get plan details first for the response
    const plan = await skill.api.plans.get(id);

    await skill.api.plans.delete(id);

    // Unsubscribe channel from this plan
    if (context.channel) {
      skill.unsubscribeChannel(context.channel.id, id);
    }

    return skill.formatter.planDeleted(plan);
  } catch (error) {
    console.error('[AgentPlanner] Failed to delete plan:', error);

    if (error.isNotFound) {
      return skill.formatter.notFound('plan', id);
    }

    if (error.isUnauthorized) {
      return skill.formatter.unauthorized();
    }

    if (error.isForbidden) {
      return skill.formatter.error('You do not have permission to delete this plan.');
    }

    return skill.formatter.error(`Failed to delete plan: ${error.message}`);
  }
}

/**
 * Show plan progress
 * Usage: /plan progress #plan-id
 */
export async function progressPlan(skill, parsed, context) {
  const { id } = parsed.args;

  if (!id) {
    // Check for default plan
    if (skill.config.default_plan) {
      parsed.args.id = skill.config.default_plan;
      return progressPlan(skill, parsed, context);
    }
    return skill.formatter.error('Please provide a plan ID. Example: `/plan progress #plan-abc123`');
  }

  try {
    const [plan, progress] = await Promise.all([
      skill.api.plans.get(id),
      skill.api.plans.getProgress(id)
    ]);

    return skill.formatter.planProgress(plan, progress);
  } catch (error) {
    console.error('[AgentPlanner] Failed to get progress:', error);

    if (error.isNotFound) {
      return skill.formatter.notFound('plan', id);
    }

    if (error.isUnauthorized) {
      return skill.formatter.unauthorized();
    }

    return skill.formatter.error(`Failed to get progress: ${error.message}`);
  }
}

/**
 * Subscribe to plan updates
 * Usage: /plan subscribe #plan-id
 */
export async function subscribePlan(skill, parsed, context) {
  const { id } = parsed.args;

  if (!id) {
    return skill.formatter.error('Please provide a plan ID. Example: `/plan subscribe #plan-abc123`');
  }

  try {
    // Verify plan exists and user has access
    const plan = await skill.api.plans.get(id);

    // Subscribe the channel
    if (context.channel) {
      skill.subscribeChannel(context.channel.id, id);
    }

    return skill.formatter.subscribed(plan);
  } catch (error) {
    console.error('[AgentPlanner] Failed to subscribe:', error);

    if (error.isNotFound) {
      return skill.formatter.notFound('plan', id);
    }

    if (error.isUnauthorized) {
      return skill.formatter.unauthorized();
    }

    return skill.formatter.error(`Failed to subscribe: ${error.message}`);
  }
}

/**
 * Unsubscribe from plan updates
 * Usage: /plan unsubscribe #plan-id
 */
export async function unsubscribePlan(skill, parsed, context) {
  const { id } = parsed.args;

  if (!id) {
    return skill.formatter.error('Please provide a plan ID. Example: `/plan unsubscribe #plan-abc123`');
  }

  try {
    // Get plan for confirmation message
    const plan = await skill.api.plans.get(id);

    // Unsubscribe the channel
    if (context.channel) {
      skill.unsubscribeChannel(context.channel.id, id);
    }

    return skill.formatter.unsubscribed(plan);
  } catch (error) {
    console.error('[AgentPlanner] Failed to unsubscribe:', error);

    if (error.isNotFound) {
      return skill.formatter.notFound('plan', id);
    }

    return skill.formatter.error(`Failed to unsubscribe: ${error.message}`);
  }
}
