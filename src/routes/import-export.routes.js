/**
 * Import/Export Routes
 * 
 * Bulk import and export of plans in Markdown and JSON formats.
 * Markdown format is optimized for AI agent readability and editing.
 */

const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth.middleware');
const { supabaseAdmin } = require('../config/supabase');
const logger = require('../utils/logger');

/**
 * @swagger
 * /plans/{id}/export:
 *   get:
 *     summary: Export plan
 *     description: Export a plan in Markdown or JSON format
 *     tags: [Import/Export]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *       - in: query
 *         name: format
 *         schema:
 *           type: string
 *           enum: [markdown, json]
 *           default: markdown
 *     responses:
 *       200:
 *         description: Exported plan
 */
router.get('/:id/export', authenticate, async (req, res) => {
  try {
    const { id: planId } = req.params;
    const { format = 'markdown' } = req.query;
    const userId = req.user.id;

    // Get plan with access check
    const { data: plan, error: planError } = await supabaseAdmin
      .from('plans')
      .select('*')
      .eq('id', planId)
      .single();

    if (planError || !plan) {
      return res.status(404).json({ error: 'Plan not found' });
    }

    // Check access
    if (plan.owner_id !== userId) {
      const { data: collab } = await supabaseAdmin
        .from('plan_collaborators')
        .select('role')
        .eq('plan_id', planId)
        .eq('user_id', userId)
        .single();

      if (!collab) {
        return res.status(403).json({ error: 'Access denied' });
      }
    }

    // Get all nodes
    const { data: nodes, error: nodesError } = await supabaseAdmin
      .from('plan_nodes')
      .select('*')
      .eq('plan_id', planId)
      .order('order_index');

    if (nodesError) {
      await logger.error('Failed to fetch nodes for export:', nodesError);
      return res.status(500).json({ error: 'Failed to fetch plan data' });
    }

    // Build hierarchical structure
    const structure = buildHierarchy(nodes);

    if (format === 'json') {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename="${sanitizeFilename(plan.title)}.json"`);
      return res.json({
        version: '1.0',
        exported_at: new Date().toISOString(),
        plan: {
          title: plan.title,
          description: plan.description,
          status: plan.status,
          visibility: plan.visibility
        },
        structure: structure
      });
    }

    // Default: Markdown format
    const markdown = generateMarkdown(plan, structure);
    
    res.setHeader('Content-Type', 'text/markdown');
    res.setHeader('Content-Disposition', `attachment; filename="${sanitizeFilename(plan.title)}.md"`);
    return res.send(markdown);

  } catch (error) {
    await logger.error('Export error:', error);
    return res.status(500).json({ error: 'Failed to export plan' });
  }
});

/**
 * @swagger
 * /plans/import:
 *   post:
 *     summary: Import plan from Markdown or JSON
 *     description: Create a new plan from imported data
 *     tags: [Import/Export]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         text/markdown:
 *           schema:
 *             type: string
 *         application/json:
 *           schema:
 *             type: object
 *     responses:
 *       201:
 *         description: Plan created from import
 */
router.post('/import', authenticate, async (req, res) => {
  try {
    const userId = req.user.id;
    const contentType = req.headers['content-type'] || '';
    
    let planData;
    
    if (contentType.includes('application/json')) {
      // JSON import
      planData = parseJsonImport(req.body);
    } else if (contentType.includes('text/markdown') || contentType.includes('text/plain')) {
      // Markdown import
      const markdown = typeof req.body === 'string' ? req.body : req.body.toString();
      planData = parseMarkdownImport(markdown);
    } else if (req.body && req.body.markdown) {
      // JSON wrapper with markdown content
      planData = parseMarkdownImport(req.body.markdown);
    } else if (req.body && req.body.plan) {
      // JSON format in body
      planData = parseJsonImport(req.body);
    } else {
      return res.status(400).json({ 
        error: 'Invalid import format',
        message: 'Send markdown as text/markdown or JSON as application/json'
      });
    }

    if (!planData || !planData.title) {
      return res.status(400).json({ error: 'Could not parse plan data. Title is required.' });
    }

    // Create the plan
    const { data: plan, error: planError } = await supabaseAdmin
      .from('plans')
      .insert({
        title: planData.title,
        description: planData.description || '',
        status: planData.status || 'draft',
        owner_id: userId
      })
      .select()
      .single();

    if (planError) {
      await logger.error('Failed to create plan from import:', planError);
      return res.status(500).json({ error: 'Failed to create plan' });
    }

    // Create root node
    const { data: rootNode, error: rootError } = await supabaseAdmin
      .from('plan_nodes')
      .insert({
        plan_id: plan.id,
        node_type: 'root',
        title: plan.title,
        status: 'not_started',
        order_index: 0
      })
      .select()
      .single();

    if (rootError) {
      await logger.error('Failed to create root node:', rootError);
      await supabaseAdmin.from('plans').delete().eq('id', plan.id);
      return res.status(500).json({ error: 'Failed to create plan structure' });
    }

    // Create phases and tasks
    let nodesCreated = 1; // root node
    if (planData.phases) {
      for (let i = 0; i < planData.phases.length; i++) {
        const phase = planData.phases[i];
        
        const { data: phaseNode, error: phaseError } = await supabaseAdmin
          .from('plan_nodes')
          .insert({
            plan_id: plan.id,
            parent_id: rootNode.id,
            node_type: 'phase',
            title: phase.title,
            description: phase.description || '',
            status: mapStatus(phase.status),
            order_index: i
          })
          .select()
          .single();

        if (phaseError) {
          await logger.error('Failed to create phase:', phaseError);
          continue;
        }
        nodesCreated++;

        // Create tasks
        if (phase.tasks) {
          for (let j = 0; j < phase.tasks.length; j++) {
            const task = phase.tasks[j];
            
            const { error: taskError } = await supabaseAdmin
              .from('plan_nodes')
              .insert({
                plan_id: plan.id,
                parent_id: phaseNode.id,
                node_type: 'task',
                title: task.title,
                description: task.description || '',
                status: mapStatus(task.status),
                context: task.context || '',
                agent_instructions: task.agent_instructions || '',
                acceptance_criteria: task.acceptance_criteria || '',
                order_index: j
              });

            if (taskError) {
              await logger.error('Failed to create task:', taskError);
              continue;
            }
            nodesCreated++;
          }
        }
      }
    }

    await logger.api(`Plan imported: ${plan.id} with ${nodesCreated} nodes`);

    return res.status(201).json({
      success: true,
      plan: {
        id: plan.id,
        title: plan.title,
        status: plan.status
      },
      nodes_created: nodesCreated
    });

  } catch (error) {
    await logger.error('Import error:', error);
    return res.status(500).json({ error: 'Failed to import plan' });
  }
});

/**
 * Build hierarchical structure from flat nodes
 */
function buildHierarchy(nodes) {
  const nodeMap = new Map();
  nodes.forEach(n => nodeMap.set(n.id, { ...n, children: [] }));

  const root = nodes.find(n => n.node_type === 'root' || !n.parent_id);
  if (!root) return { phases: [] };

  // Build tree
  nodes.forEach(n => {
    if (n.parent_id && nodeMap.has(n.parent_id)) {
      nodeMap.get(n.parent_id).children.push(nodeMap.get(n.id));
    }
  });

  // Sort children by order_index
  nodeMap.forEach(n => {
    n.children.sort((a, b) => a.order_index - b.order_index);
  });

  // Extract phases and tasks
  const rootNode = nodeMap.get(root.id);
  const phases = rootNode.children
    .filter(n => n.node_type === 'phase')
    .map(phase => ({
      title: phase.title,
      description: phase.description,
      status: phase.status,
      tasks: phase.children
        .filter(n => n.node_type === 'task')
        .map(task => ({
          title: task.title,
          description: task.description,
          status: task.status,
          context: task.context,
          agent_instructions: task.agent_instructions,
          acceptance_criteria: task.acceptance_criteria
        }))
    }));

  return { phases };
}

/**
 * Generate Markdown from plan structure
 */
function generateMarkdown(plan, structure) {
  const lines = [];
  
  // Frontmatter
  lines.push('---');
  lines.push(`title: "${plan.title.replace(/"/g, '\\"')}"`);
  lines.push(`status: ${plan.status}`);
  lines.push(`exported: ${new Date().toISOString()}`);
  lines.push('format: agentplanner-v1');
  lines.push('---');
  lines.push('');
  
  // Plan title and description
  lines.push(`# ${plan.title}`);
  lines.push('');
  if (plan.description) {
    lines.push(plan.description);
    lines.push('');
  }
  
  // Phases
  if (structure.phases) {
    structure.phases.forEach((phase, i) => {
      lines.push(`## Phase ${i + 1}: ${phase.title}`);
      lines.push('');
      lines.push(`**Status:** ${phase.status}`);
      lines.push('');
      
      if (phase.description) {
        lines.push(phase.description);
        lines.push('');
      }
      
      // Tasks
      if (phase.tasks) {
        phase.tasks.forEach((task, j) => {
          lines.push(`### Task ${i + 1}.${j + 1}: ${task.title}`);
          lines.push('');
          lines.push(`**Status:** ${task.status}`);
          lines.push('');
          
          if (task.description) {
            lines.push('**Description:**');
            lines.push(task.description);
            lines.push('');
          }
          
          if (task.context) {
            lines.push('**Context:**');
            lines.push(task.context);
            lines.push('');
          }
          
          if (task.agent_instructions) {
            lines.push('**Agent Instructions:**');
            lines.push('```');
            lines.push(task.agent_instructions);
            lines.push('```');
            lines.push('');
          }
          
          if (task.acceptance_criteria) {
            lines.push('**Acceptance Criteria:**');
            lines.push(task.acceptance_criteria);
            lines.push('');
          }
        });
      }
    });
  }
  
  return lines.join('\n');
}

/**
 * Parse Markdown import
 */
function parseMarkdownImport(markdown) {
  const lines = markdown.split('\n');
  
  const plan = {
    title: '',
    description: '',
    status: 'draft',
    phases: []
  };
  
  let currentPhase = null;
  let currentTask = null;
  let currentField = null;
  let inFrontmatter = false;
  let inCodeBlock = false;
  let descriptionLines = [];
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    
    // Frontmatter handling
    if (trimmed === '---') {
      if (i === 0) {
        inFrontmatter = true;
        continue;
      } else if (inFrontmatter) {
        inFrontmatter = false;
        continue;
      }
    }
    
    if (inFrontmatter) {
      const match = trimmed.match(/^(\w+):\s*"?([^"]*)"?$/);
      if (match) {
        const [, key, value] = match;
        if (key === 'title') plan.title = value;
        if (key === 'status') plan.status = value;
      }
      continue;
    }
    
    // Code block handling
    if (trimmed.startsWith('```')) {
      inCodeBlock = !inCodeBlock;
      if (inCodeBlock) continue;
      if (!inCodeBlock && currentField === 'agent_instructions' && currentTask) {
        currentTask.agent_instructions = descriptionLines.join('\n').trim();
        descriptionLines = [];
        currentField = null;
      }
      continue;
    }
    
    if (inCodeBlock) {
      descriptionLines.push(line);
      continue;
    }
    
    // Plan title (# heading)
    if (trimmed.startsWith('# ') && !plan.title) {
      plan.title = trimmed.substring(2).trim();
      continue;
    }
    
    // Phase (## heading)
    if (trimmed.startsWith('## ')) {
      // Save previous task's pending field
      if (currentField && currentTask && descriptionLines.length > 0) {
        currentTask[currentField] = descriptionLines.join('\n').trim();
        descriptionLines = [];
      }
      
      const phaseTitle = trimmed.substring(3).replace(/^Phase\s+\d+:\s*/i, '').trim();
      currentPhase = {
        title: phaseTitle,
        description: '',
        status: 'not_started',
        tasks: []
      };
      plan.phases.push(currentPhase);
      currentTask = null;
      currentField = null;
      continue;
    }
    
    // Task (### heading)
    if (trimmed.startsWith('### ') && currentPhase) {
      // Save previous task's pending field
      if (currentField && currentTask && descriptionLines.length > 0) {
        currentTask[currentField] = descriptionLines.join('\n').trim();
        descriptionLines = [];
      }
      
      const taskTitle = trimmed.substring(4).replace(/^Task\s+[\d.]+:\s*/i, '').trim();
      currentTask = {
        title: taskTitle,
        description: '',
        status: 'not_started',
        context: '',
        agent_instructions: '',
        acceptance_criteria: ''
      };
      currentPhase.tasks.push(currentTask);
      currentField = null;
      continue;
    }
    
    // Status line
    if (trimmed.startsWith('**Status:**')) {
      const status = trimmed.replace('**Status:**', '').trim();
      if (currentTask) {
        currentTask.status = status;
      } else if (currentPhase) {
        currentPhase.status = status;
      }
      continue;
    }
    
    // Field markers
    if (trimmed === '**Description:**') {
      if (currentField && descriptionLines.length > 0) {
        currentTask[currentField] = descriptionLines.join('\n').trim();
      }
      currentField = 'description';
      descriptionLines = [];
      continue;
    }
    if (trimmed === '**Context:**') {
      if (currentField && descriptionLines.length > 0) {
        currentTask[currentField] = descriptionLines.join('\n').trim();
      }
      currentField = 'context';
      descriptionLines = [];
      continue;
    }
    if (trimmed === '**Agent Instructions:**') {
      if (currentField && descriptionLines.length > 0) {
        currentTask[currentField] = descriptionLines.join('\n').trim();
      }
      currentField = 'agent_instructions';
      descriptionLines = [];
      continue;
    }
    if (trimmed === '**Acceptance Criteria:**') {
      if (currentField && descriptionLines.length > 0) {
        currentTask[currentField] = descriptionLines.join('\n').trim();
      }
      currentField = 'acceptance_criteria';
      descriptionLines = [];
      continue;
    }
    
    // Collect content for current field
    if (currentField && currentTask) {
      descriptionLines.push(line);
    } else if (!currentPhase && !currentTask && trimmed && !trimmed.startsWith('**')) {
      // Plan description (content before first phase)
      plan.description += (plan.description ? '\n' : '') + line;
    }
  }
  
  // Save last pending field
  if (currentField && currentTask && descriptionLines.length > 0) {
    currentTask[currentField] = descriptionLines.join('\n').trim();
  }
  
  return plan;
}

/**
 * Parse JSON import
 */
function parseJsonImport(data) {
  if (data.plan && data.structure) {
    // Full export format
    return {
      title: data.plan.title,
      description: data.plan.description,
      status: data.plan.status,
      phases: data.structure.phases || []
    };
  }
  
  // Simple format
  return {
    title: data.title,
    description: data.description,
    status: data.status,
    phases: data.phases || []
  };
}

/**
 * Map status strings to valid values
 */
function mapStatus(status) {
  const statusMap = {
    'completed': 'completed',
    'complete': 'completed',
    'done': 'completed',
    'in_progress': 'in_progress',
    'in progress': 'in_progress',
    'active': 'in_progress',
    'blocked': 'blocked',
    'not_started': 'not_started',
    'not started': 'not_started',
    'pending': 'not_started',
    'todo': 'not_started',
    'cancelled': 'cancelled',
    'canceled': 'cancelled'
  };
  
  return statusMap[(status || '').toLowerCase()] || 'not_started';
}

/**
 * Sanitize filename
 */
function sanitizeFilename(name) {
  return name.replace(/[^a-z0-9]/gi, '_').substring(0, 50);
}

module.exports = router;
