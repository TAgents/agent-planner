const { v4: uuidv4 } = require('uuid');
const { supabase } = require('../config/supabase');

/**
 * Helper function to check if a user has access to a plan with specified roles
 * @param {string} planId - Plan ID
 * @param {string} userId - User ID
 * @param {string[]} [roles] - Optional array of required roles (e.g., ['owner', 'admin', 'editor'])
 * @returns {Promise<boolean>} - Whether the user has access
 */
const checkPlanAccess = async (planId, userId, roles = []) => {
  // Check if the user is the owner
  const { data: plan, error: planError } = await supabase
    .from('plans')
    .select('owner_id')
    .eq('id', planId)
    .single();

  if (planError) {
    // Plan not found or other error
    return false;
  }

  // If user is the owner, they always have access
  if (plan.owner_id === userId) {
    return roles.length === 0 || roles.includes('owner');
  }

  // Otherwise, check if they're a collaborator with appropriate role
  const { data: collab, error: collabError } = await supabase
    .from('plan_collaborators')
    .select('role')
    .eq('plan_id', planId)
    .eq('user_id', userId)
    .single();

  if (collabError) {
    // Not a collaborator or other error
    return false;
  }

  // If roles specified, check if the user's role is included
  if (roles.length > 0) {
    return roles.includes(collab.role);
  }

  // Otherwise, any collaborator role grants access
  return true;
};

/**
 * Add an artifact to a node
 */
const addArtifact = async (req, res, next) => {
  try {
    const { id: planId, nodeId } = req.params;
    const { name, content_type, url, metadata } = req.body;
    const userId = req.user.id;

    // Validate required fields
    if (!name) {
      return res.status(400).json({ error: 'Artifact name is required' });
    }
    if (!content_type) {
      return res.status(400).json({ error: 'Content type is required' });
    }
    if (!url) {
      return res.status(400).json({ error: 'URL is required' });
    }

    // Check if the user has edit access to this plan
    const hasAccess = await checkPlanAccess(planId, userId, ['owner', 'admin', 'editor']);
    if (!hasAccess) {
      return res.status(403).json({ error: 'You do not have permission to add artifacts to this plan' });
    }

    // Check if node exists and belongs to this plan
    const { data: node, error: nodeError } = await supabase
      .from('plan_nodes')
      .select('id')
      .eq('id', nodeId)
      .eq('plan_id', planId)
      .single();

    if (nodeError) {
      if (nodeError.code === 'PGRST116') {
        return res.status(404).json({ error: 'Node not found in this plan' });
      }
      return res.status(500).json({ error: nodeError.message });
    }

    // Create the artifact
    const { data, error } = await supabase
      .from('plan_node_artifacts')
      .insert([
        {
          id: uuidv4(),
          plan_node_id: nodeId,
          name,
          content_type,
          url,
          created_at: new Date(),
          created_by: userId,
          metadata: metadata || {},
        },
      ])
      .select();

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    // Add a log entry for this artifact creation
    await supabase.from('plan_node_logs').insert([
      {
        id: uuidv4(),
        plan_node_id: nodeId,
        user_id: userId,
        content: `Added artifact "${name}"`,
        log_type: 'progress',
        created_at: new Date(),
      },
    ]);

    res.status(201).json(data[0]);
  } catch (error) {
    next(error);
  }
};

/**
 * Get artifacts for a node
 */
const getNodeArtifacts = async (req, res, next) => {
  try {
    const { id: planId, nodeId } = req.params;
    const userId = req.user.id;

    // Check if the user has access to this plan
    const hasAccess = await checkPlanAccess(planId, userId);
    if (!hasAccess) {
      return res.status(403).json({ error: 'You do not have access to this plan' });
    }

    // Check if node exists and belongs to this plan
    const { data: node, error: nodeError } = await supabase
      .from('plan_nodes')
      .select('id')
      .eq('id', nodeId)
      .eq('plan_id', planId)
      .single();

    if (nodeError) {
      if (nodeError.code === 'PGRST116') {
        return res.status(404).json({ error: 'Node not found in this plan' });
      }
      return res.status(500).json({ error: nodeError.message });
    }

    // Get artifacts for this node
    const { data, error } = await supabase
      .from('plan_node_artifacts')
      .select(`
        id, 
        name, 
        content_type, 
        url, 
        created_at,
        created_by,
        user:created_by (id, name, email),
        metadata
      `)
      .eq('plan_node_id', nodeId)
      .order('created_at', { ascending: false });

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    res.json(data);
  } catch (error) {
    next(error);
  }
};

/**
 * Get a specific artifact
 */
const getArtifact = async (req, res, next) => {
  try {
    const { id: planId, nodeId, artifactId } = req.params;
    const userId = req.user.id;

    // Check if the user has access to this plan
    const hasAccess = await checkPlanAccess(planId, userId);
    if (!hasAccess) {
      return res.status(403).json({ error: 'You do not have access to this plan' });
    }

    // Get the artifact
    const { data: artifact, error } = await supabase
      .from('plan_node_artifacts')
      .select(`
        id, 
        plan_node_id,
        name, 
        content_type, 
        url, 
        created_at,
        created_by,
        user:created_by (id, name, email),
        metadata,
        node:plan_node_id (id, title, plan_id)
      `)
      .eq('id', artifactId)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return res.status(404).json({ error: 'Artifact not found' });
      }
      return res.status(500).json({ error: error.message });
    }

    // Verify this artifact belongs to the specified node and plan
    if (artifact.plan_node_id !== nodeId || artifact.node.plan_id !== planId) {
      return res.status(404).json({ error: 'Artifact not found in this node/plan' });
    }

    res.json(artifact);
  } catch (error) {
    next(error);
  }
};

/**
 * Update an artifact
 */
const updateArtifact = async (req, res, next) => {
  try {
    const { id: planId, nodeId, artifactId } = req.params;
    const { name, content_type, url, metadata } = req.body;
    const userId = req.user.id;

    // Check if the user has edit access to this plan
    const hasAccess = await checkPlanAccess(planId, userId, ['owner', 'admin', 'editor']);
    if (!hasAccess) {
      return res.status(403).json({ error: 'You do not have permission to update artifacts in this plan' });
    }

    // Check if artifact exists and belongs to this node/plan
    const { data: existingArtifact, error: artifactError } = await supabase
      .from('plan_node_artifacts')
      .select(`
        id, 
        plan_node_id,
        node:plan_node_id (plan_id)
      `)
      .eq('id', artifactId)
      .single();

    if (artifactError) {
      if (artifactError.code === 'PGRST116') {
        return res.status(404).json({ error: 'Artifact not found' });
      }
      return res.status(500).json({ error: artifactError.message });
    }

    // Verify this artifact belongs to the specified node and plan
    if (existingArtifact.plan_node_id !== nodeId || existingArtifact.node.plan_id !== planId) {
      return res.status(404).json({ error: 'Artifact not found in this node/plan' });
    }

    // Update only provided fields
    const updates = {};
    if (name !== undefined) updates.name = name;
    if (content_type !== undefined) updates.content_type = content_type;
    if (url !== undefined) updates.url = url;
    if (metadata !== undefined) updates.metadata = metadata;

    // Perform the update
    const { data, error } = await supabase
      .from('plan_node_artifacts')
      .update(updates)
      .eq('id', artifactId)
      .select();

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    res.json(data[0]);
  } catch (error) {
    next(error);
  }
};

/**
 * Delete an artifact
 */
const deleteArtifact = async (req, res, next) => {
  try {
    const { id: planId, nodeId, artifactId } = req.params;
    const userId = req.user.id;

    // Check if the user has edit access to this plan
    const hasAccess = await checkPlanAccess(planId, userId, ['owner', 'admin', 'editor']);
    if (!hasAccess) {
      return res.status(403).json({ error: 'You do not have permission to delete artifacts in this plan' });
    }

    // Check if artifact exists and belongs to this node/plan
    const { data: existingArtifact, error: artifactError } = await supabase
      .from('plan_node_artifacts')
      .select(`
        id, 
        name,
        plan_node_id,
        node:plan_node_id (plan_id)
      `)
      .eq('id', artifactId)
      .single();

    if (artifactError) {
      if (artifactError.code === 'PGRST116') {
        return res.status(404).json({ error: 'Artifact not found' });
      }
      return res.status(500).json({ error: artifactError.message });
    }

    // Verify this artifact belongs to the specified node and plan
    if (existingArtifact.plan_node_id !== nodeId || existingArtifact.node.plan_id !== planId) {
      return res.status(404).json({ error: 'Artifact not found in this node/plan' });
    }

    // Delete the artifact
    const { error } = await supabase
      .from('plan_node_artifacts')
      .delete()
      .eq('id', artifactId);

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    // Add a log entry for this deletion
    await supabase.from('plan_node_logs').insert([
      {
        id: uuidv4(),
        plan_node_id: nodeId,
        user_id: userId,
        content: `Deleted artifact "${existingArtifact.name}"`,
        log_type: 'progress',
        created_at: new Date(),
      },
    ]);

    res.status(204).send();
  } catch (error) {
    next(error);
  }
};

/**
 * List all artifacts across the plan
 */
const getPlanArtifacts = async (req, res, next) => {
  try {
    const { id: planId } = req.params;
    const userId = req.user.id;

    // Check if the user has access to this plan
    const hasAccess = await checkPlanAccess(planId, userId);
    if (!hasAccess) {
      return res.status(403).json({ error: 'You do not have access to this plan' });
    }

    // Get all nodes for this plan
    const { data: nodes, error: nodesError } = await supabase
      .from('plan_nodes')
      .select('id')
      .eq('plan_id', planId);

    if (nodesError) {
      return res.status(500).json({ error: nodesError.message });
    }

    const nodeIds = nodes.map(node => node.id);

    // Get artifacts for all nodes in this plan
    const { data, error } = await supabase
      .from('plan_node_artifacts')
      .select(`
        id, 
        name, 
        content_type, 
        url, 
        created_at,
        created_by,
        user:created_by (id, name, email),
        metadata,
        node:plan_node_id (id, title, node_type)
      `)
      .in('plan_node_id', nodeIds)
      .order('created_at', { ascending: false });

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    res.json(data);
  } catch (error) {
    next(error);
  }
};

module.exports = {
  addArtifact,
  getNodeArtifacts,
  getArtifact,
  updateArtifact,
  deleteArtifact,
  getPlanArtifacts,
};
