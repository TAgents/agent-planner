/**
 * Milestone Command Handlers
 *
 * Handles all /milestone subcommands for creating and managing milestones.
 * Milestones are significant checkpoints within plans or phases.
 */

/**
 * Add a milestone to a plan or phase
 * Usage: /milestone add "Milestone title" to #parent-id
 */
export async function addMilestone(skill, parsed, context) {
  const { title, parent_id } = parsed.args;

  if (!title) {
    return skill.formatter.error('Please provide a milestone title. Example: `/milestone add "Beta Launch" to #phase-abc123`');
  }

  // Determine the parent
  let parentId = parent_id;
  let planId = null;

  if (!parentId) {
    if (skill.config.default_plan) {
      parentId = skill.config.default_plan;
      planId = skill.config.default_plan;
    } else {
      return skill.formatter.error('Please specify where to add the milestone. Example: `/milestone add "Beta Launch" to #plan-abc123`');
    }
  }

  try {
    // Determine if parent is a plan or node
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
        rootNodeId = plan.root_node?.id || plan.root_node_id;

        if (!rootNodeId) {
          const tree = await skill.api.plans.getTree(planId);
          rootNodeId = tree.id;
        }
        parent = { title: plan.title };
      } else {
        throw nodeError;
      }
    }

    // Create the milestone
    const milestone = await skill.api.nodes.create(planId, {
      title,
      node_type: 'milestone',
      parent_id: rootNodeId,
      status: 'not_started'
    });

    return skill.formatter.nodeCreated(milestone, parent.title);
  } catch (error) {
    console.error('[AgentPlanner] Failed to add milestone:', error);

    if (error.isNotFound) {
      return skill.formatter.notFound('plan or phase', parentId);
    }

    if (error.isUnauthorized) {
      return skill.formatter.unauthorized();
    }

    return skill.formatter.error(`Failed to add milestone: ${error.message}`);
  }
}

/**
 * List all milestones in a plan
 * Usage: /milestone list #plan-id
 */
export async function listMilestones(skill, parsed, context) {
  const { plan_id } = parsed.args;

  // Determine the plan
  let planId = plan_id;

  if (!planId) {
    if (skill.config.default_plan) {
      planId = skill.config.default_plan;
    } else {
      return skill.formatter.error('Please specify the plan. Example: `/milestone list #plan-abc123`');
    }
  }

  try {
    // Get plan tree
    const tree = await skill.api.plans.getTree(planId);

    if (!tree) {
      return 'No milestones found in this plan.';
    }

    // Recursively collect all milestones
    const milestones = collectMilestones(tree);

    if (milestones.length === 0) {
      const plan = await skill.api.plans.get(planId);
      return `No milestones found in "${plan.title}". Add one with:\n\`/milestone add "Milestone Name" to #plan-${planId.slice(0, 8)}\``;
    }

    return skill.formatter.nodesList(milestones, 'Milestones');
  } catch (error) {
    console.error('[AgentPlanner] Failed to list milestones:', error);

    if (error.isNotFound) {
      return skill.formatter.notFound('plan', planId);
    }

    if (error.isUnauthorized) {
      return skill.formatter.unauthorized();
    }

    return skill.formatter.error(`Failed to list milestones: ${error.message}`);
  }
}

/**
 * Recursively collect milestones from tree
 */
function collectMilestones(node) {
  const milestones = [];

  if (node.node_type === 'milestone') {
    milestones.push(node);
  }

  if (node.children) {
    for (const child of node.children) {
      milestones.push(...collectMilestones(child));
    }
  }

  return milestones;
}
