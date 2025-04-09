const { v4: uuidv4 } = require('uuid');
const { supabaseAdmin: supabase } = require('../config/supabase');

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

/**
 * Download an artifact file
 */
const downloadArtifact = async (req, res, next) => {
  try {
    const { path: filePath, filename } = req.query;
    
    // Make this route work even without authentication in development
    if (process.env.NODE_ENV === 'development' && !req.user) {
      console.log('Development mode: bypassing authentication for file download');
      req.user = { id: 'dev-user' };
    }
    
    const userId = req.user?.id;
    
    // Log the request with more details
    console.log(`Download request: path=${filePath}, filename=${filename}, user=${userId}`);
    
    // Check if file exists
    const fs = require('fs');
    const { promisify } = require('util');
    const pathModule = require('path');
    const access = promisify(fs.access);
    const stat = promisify(fs.stat);
    
    // Validate path parameter
    if (!filePath) {
      return res.status(400).json({ error: 'Path parameter is required' });
    }
    
    // Basic security check to prevent path traversal
    if (filePath.includes('../') || filePath.includes('..\\')) {
      return res.status(400).json({ error: 'Invalid path: path traversal not allowed' });
    }

    // Check if the path exists
    console.log(`Checking if file exists: ${filePath}`);
    const pathExists = fs.existsSync(filePath);
    console.log(`Path exists check: ${pathExists ? 'File exists' : 'File NOT found'}`);
    
    if (!pathExists) {
      // Try to find the file in the expected directory structure
      const projectRoot = process.cwd();
      console.log(`Project root: ${projectRoot}`);
      
      // First try to decode the URI-encoded path
      let decodedPath = filePath;
      try {
        if (filePath.includes('%')) {
          decodedPath = decodeURIComponent(filePath);
          console.log(`Decoded path: ${decodedPath}`);
          // Check if decoded path exists
          if (fs.existsSync(decodedPath)) {
            console.log(`Found file at decoded path: ${decodedPath}`);
            filePath = decodedPath;
            pathExists = true;
          }
        }
      } catch (e) {
        console.error('Error decoding path:', e);
      }
      
      if (!pathExists) {
        // Try some common directories
        const possibleLocations = [
          filePath,
          decodedPath,
          pathModule.join(projectRoot, filePath),
          pathModule.join(projectRoot, decodedPath),
          pathModule.join(projectRoot, '..', filePath),
          pathModule.join(projectRoot, '..', decodedPath),
          // If the path starts with /Users, treat as absolute
          filePath.startsWith('/Users') ? filePath : null,
          decodedPath.startsWith('/Users') ? decodedPath : null,
          // Try docs directory if path includes 'docs'
          filePath.includes('docs') ? pathModule.join(projectRoot, '..', 'docs', pathModule.basename(filePath)) : null,
          decodedPath.includes('docs') ? pathModule.join(projectRoot, '..', 'docs', pathModule.basename(decodedPath)) : null,
          // Try finding the file by name in common directories
          pathModule.join(projectRoot, '..', 'docs', pathModule.basename(filePath)),
          pathModule.join(projectRoot, '..', 'docs', pathModule.basename(decodedPath)),
          pathModule.join(projectRoot, '..', 'docs', 'agent-assignment', pathModule.basename(filePath)),
          pathModule.join(projectRoot, '..', 'docs', 'agent-assignment', pathModule.basename(decodedPath))
        ].filter(Boolean);
        
        console.log('Trying possible file locations:', possibleLocations);
        
        // Find the first location that exists
        let foundLocation = null;
        for (const location of possibleLocations) {
          if (fs.existsSync(location)) {
            foundLocation = location;
            console.log(`Found file at: ${foundLocation}`);
            break;
          }
        }
        
        if (!foundLocation) {
          return res.status(404).json({ error: `File not found at path: ${filePath}` });
        }
        
        // Use the found location
        filePath = foundLocation;
      }
    }

    try {
      // Get file stats
      const fileStat = await stat(filePath);
      
      // If it's a directory, return an error
      if (fileStat.isDirectory()) {
        return res.status(400).json({ error: 'Path is a directory, not a file' });
      }
      
      // Determine content type based on file extension
      const fileExtension = pathModule.extname(filePath).toLowerCase();
      const mimeTypes = {
        '.txt': 'text/plain',
        '.pdf': 'application/pdf',
        '.doc': 'application/msword',
        '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        '.xls': 'application/vnd.ms-excel',
        '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        '.md': 'text/markdown',
        '.json': 'application/json',
        '.csv': 'text/csv',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.png': 'image/png',
        '.gif': 'image/gif',
        '.svg': 'image/svg+xml',
        '.js': 'application/javascript',
        '.html': 'text/html',
        '.css': 'text/css',
      };
      
      const contentType = mimeTypes[fileExtension] || 'application/octet-stream';
      const finalFilename = filename || pathModule.basename(filePath);
      
      console.log(`Serving file download: ${filePath} as ${finalFilename} (${contentType}), size: ${fileStat.size} bytes`);

      // Set appropriate headers for download
      res.set({
        'Content-Type': contentType,
        'Content-Disposition': `attachment; filename="${finalFilename}"`,
        'Content-Length': fileStat.size,
        'Cache-Control': 'no-cache',
        'X-Content-Type-Options': 'nosniff'
      });

      // Stream the file to the response
      const fileStream = fs.createReadStream(filePath);
      fileStream.pipe(res);
      
      // Handle errors in the stream
      fileStream.on('error', (err) => {
        console.error(`Error streaming file (${filePath}): ${err.message}`);
        if (!res.headersSent) {
          res.status(500).json({ error: 'Error reading file' });
        } else {
          res.end();
        }
      });
      
      // Handle completion
      fileStream.on('end', () => {
        console.log(`File download completed: ${filePath}`);
      });
    } catch (err) {
      console.error(`File access error (${filePath}): ${err.message}`);
      return res.status(404).json({ error: `File not found or inaccessible: ${err.message}` });
    }
  } catch (error) {
    console.error(`Error in downloadArtifact controller: ${error.message}`);
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
  downloadArtifact
};
