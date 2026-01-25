/**
 * Phase Command Handlers
 *
 * Handles all /phase subcommands for creating and managing phases within plans.
 * Phases are organizational groupings that contain tasks and milestones.
 */

/**
 * Add a phase to a plan
 * Usage: /phase add "Phase title" to #plan-id
 */
export async function addPhase(skill, parsed, context) {
  const { title, plan_id } = parsed.args;

  if (!title) {
    return skill.formatter.error('Please provide a phase title. Example: `/phase add "Development" to #plan-abc123`');
  }

  // Determine the plan
  let planId = plan_id;

  if (!planId) {
    if (skill.config.default_plan) {
      planId = skill.config.default_plan;
    } else {
      return skill.formatter.error('Please specify the plan. Example: `/phase add "Development" to #plan-abc123`');
    }
  }

  try {
    // Get the plan and its root node
    const plan = await skill.api.plans.get(planId);
    const rootNodeId = plan.root_node?.id || plan.root_node_id;

    if (!rootNodeId) {
      // Fetch plan tree to get root node
      const tree = await skill.api.plans.getTree(planId);
      if (!tree || !tree.id) {
        return skill.formatter.error('Could not find root node for this plan.');
      }
    }

    // Create the phase
    const phase = await skill.api.nodes.create(planId, {
      title,
      node_type: 'phase',
      parent_id: rootNodeId,
      status: 'not_started'
    });

    return skill.formatter.nodeCreated(phase, plan.title);
  } catch (error) {
    console.error('[AgentPlanner] Failed to add phase:', error);

    if (error.isNotFound) {
      return skill.formatter.notFound('plan', planId);
    }

    if (error.isUnauthorized) {
      return skill.formatter.unauthorized();
    }

    return skill.formatter.error(`Failed to add phase: ${error.message}`);
  }
}

/**
 * List all phases in a plan
 * Usage: /phase list #plan-id
 */
export async function listPhases(skill, parsed, context) {
  const { plan_id } = parsed.args;

  // Determine the plan
  let planId = plan_id;

  if (!planId) {
    if (skill.config.default_plan) {
      planId = skill.config.default_plan;
    } else {
      return skill.formatter.error('Please specify the plan. Example: `/phase list #plan-abc123`');
    }
  }

  try {
    // Get plan tree
    const tree = await skill.api.plans.getTree(planId);

    if (!tree || !tree.children) {
      return 'No phases found in this plan.';
    }

    // Filter for phases only
    const phases = tree.children.filter(node => node.node_type === 'phase');

    if (phases.length === 0) {
      const plan = await skill.api.plans.get(planId);
      return `No phases found in "${plan.title}". Add one with:\n\`/phase add "Phase Name" to #plan-${planId.slice(0, 8)}\``;
    }

    return skill.formatter.nodesList(phases, 'Phases');
  } catch (error) {
    console.error('[AgentPlanner] Failed to list phases:', error);

    if (error.isNotFound) {
      return skill.formatter.notFound('plan', planId);
    }

    if (error.isUnauthorized) {
      return skill.formatter.unauthorized();
    }

    return skill.formatter.error(`Failed to list phases: ${error.message}`);
  }
}
