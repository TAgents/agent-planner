/**
 * Template Routes
 * 
 * Handle plan templates - creating, listing, and using templates.
 */

const express = require('express');
const router = express.Router();
const { authenticate, optionalAuthenticate } = require('../middleware/auth.middleware');
const { supabaseAdmin } = require('../config/supabase');
const logger = require('../utils/logger');

/**
 * @swagger
 * /templates:
 *   get:
 *     summary: List available templates
 *     description: Get public templates, starter templates, and user's own templates
 *     tags: [Templates]
 *     parameters:
 *       - in: query
 *         name: category
 *         schema:
 *           type: string
 *         description: Filter by category
 *       - in: query
 *         name: starter
 *         schema:
 *           type: boolean
 *         description: Only show starter templates
 *       - in: query
 *         name: mine
 *         schema:
 *           type: boolean
 *         description: Only show user's own templates (requires auth)
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *         description: Search templates by title/description
 *     responses:
 *       200:
 *         description: List of templates
 */
router.get('/', optionalAuthenticate, async (req, res) => {
  try {
    const { category, starter, mine, search, limit = 50, offset = 0 } = req.query;
    const userId = req.user?.id;

    let query = supabaseAdmin
      .from('plan_templates')
      .select(`
        id,
        title,
        description,
        category,
        is_public,
        is_starter,
        use_count,
        created_at,
        owner_id,
        users!plan_templates_owner_id_fkey(name)
      `)
      .order('use_count', { ascending: false })
      .range(parseInt(offset), parseInt(offset) + parseInt(limit) - 1);

    // Filter by category
    if (category) {
      query = query.eq('category', category);
    }

    // Only starter templates
    if (starter === 'true') {
      query = query.eq('is_starter', true);
    }

    // Only user's own templates - requires authentication
    if (mine === 'true') {
      if (!userId) {
        // mine=true without auth - return empty result (not an error, just no "my" templates)
        return res.json({
          templates: [],
          categories: [],
          total: 0
        });
      }
      query = query.eq('owner_id', userId);
    } else {
      // Default: Show public + starter + own templates (if authenticated)
      if (userId) {
        query = query.or(`is_public.eq.true,is_starter.eq.true,owner_id.eq.${userId}`);
      } else {
        query = query.or('is_public.eq.true,is_starter.eq.true');
      }
    }

    // Search
    if (search) {
      query = query.textSearch('title', search, { type: 'websearch' });
    }

    const { data: templates, error, count } = await query;

    if (error) {
      await logger.error('Failed to fetch templates:', error);
      return res.status(500).json({ error: 'Failed to fetch templates' });
    }

    // Get unique categories for filtering
    const { data: categories } = await supabaseAdmin
      .from('plan_templates')
      .select('category')
      .or('is_public.eq.true,is_starter.eq.true');
    
    const uniqueCategories = [...new Set(categories?.map(c => c.category) || [])];

    return res.json({
      templates: templates.map(t => ({
        id: t.id,
        title: t.title,
        description: t.description,
        category: t.category,
        is_public: t.is_public,
        is_starter: t.is_starter,
        use_count: t.use_count,
        created_at: t.created_at,
        owner_name: t.users?.name || (t.is_starter ? 'AgentPlanner' : 'Unknown'),
        is_mine: t.owner_id === userId
      })),
      categories: uniqueCategories,
      total: templates.length
    });

  } catch (error) {
    await logger.error('List templates error:', error);
    return res.status(500).json({ error: 'Failed to list templates' });
  }
});

/**
 * @swagger
 * /templates/{id}:
 *   get:
 *     summary: Get template details
 *     description: Get a specific template including its structure
 *     tags: [Templates]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Template details with structure
 */
router.get('/:id', optionalAuthenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user?.id;

    const { data: template, error } = await supabaseAdmin
      .from('plan_templates')
      .select(`
        *,
        users!plan_templates_owner_id_fkey(name, email)
      `)
      .eq('id', id)
      .single();

    if (error || !template) {
      return res.status(404).json({ error: 'Template not found' });
    }

    // Check access
    if (!template.is_public && !template.is_starter && template.owner_id !== userId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    return res.json({
      id: template.id,
      title: template.title,
      description: template.description,
      category: template.category,
      structure: template.structure,
      is_public: template.is_public,
      is_starter: template.is_starter,
      use_count: template.use_count,
      created_at: template.created_at,
      owner_name: template.users?.name || (template.is_starter ? 'AgentPlanner' : 'Unknown'),
      is_mine: template.owner_id === userId
    });

  } catch (error) {
    await logger.error('Get template error:', error);
    return res.status(500).json({ error: 'Failed to get template' });
  }
});

/**
 * @swagger
 * /templates:
 *   post:
 *     summary: Create template from plan
 *     description: Save an existing plan as a reusable template
 *     tags: [Templates]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - plan_id
 *               - title
 *             properties:
 *               plan_id:
 *                 type: string
 *                 format: uuid
 *               title:
 *                 type: string
 *               description:
 *                 type: string
 *               category:
 *                 type: string
 *               is_public:
 *                 type: boolean
 *     responses:
 *       201:
 *         description: Template created
 */
router.post('/', authenticate, async (req, res) => {
  try {
    const { plan_id, title, description, category = 'general', is_public = false } = req.body;
    const userId = req.user.id;

    if (!plan_id || !title) {
      return res.status(400).json({ error: 'plan_id and title are required' });
    }

    // Get plan and verify ownership
    const { data: plan, error: planError } = await supabaseAdmin
      .from('plans')
      .select('id, title, owner_id')
      .eq('id', plan_id)
      .single();

    if (planError || !plan) {
      return res.status(404).json({ error: 'Plan not found' });
    }

    // Check ownership or collaborator access
    if (plan.owner_id !== userId) {
      const { data: collab } = await supabaseAdmin
        .from('plan_collaborators')
        .select('role')
        .eq('plan_id', plan_id)
        .eq('user_id', userId)
        .single();

      if (!collab) {
        return res.status(403).json({ error: 'You do not have access to this plan' });
      }
    }

    // Get plan structure (nodes)
    const { data: nodes, error: nodesError } = await supabaseAdmin
      .from('plan_nodes')
      .select('id, parent_id, node_type, title, description, status, order_index, context, agent_instructions')
      .eq('plan_id', plan_id)
      .order('order_index');

    if (nodesError) {
      await logger.error('Failed to fetch plan nodes:', nodesError);
      return res.status(500).json({ error: 'Failed to fetch plan structure' });
    }

    // Build hierarchical structure
    const structure = buildTemplateStructure(nodes);

    // Create template
    const { data: template, error: templateError } = await supabaseAdmin
      .from('plan_templates')
      .insert({
        title,
        description: description || `Template based on "${plan.title}"`,
        category,
        structure,
        is_public,
        is_starter: false,
        owner_id: userId
      })
      .select()
      .single();

    if (templateError) {
      await logger.error('Failed to create template:', templateError);
      return res.status(500).json({ error: 'Failed to create template' });
    }

    await logger.api(`Template created: ${template.id} from plan ${plan_id}`);

    return res.status(201).json({
      id: template.id,
      title: template.title,
      description: template.description,
      category: template.category,
      is_public: template.is_public,
      created_at: template.created_at
    });

  } catch (error) {
    await logger.error('Create template error:', error);
    return res.status(500).json({ error: 'Failed to create template' });
  }
});

/**
 * @swagger
 * /templates/{id}:
 *   put:
 *     summary: Update template
 *     description: Update template metadata (not structure)
 *     tags: [Templates]
 *     security:
 *       - bearerAuth: []
 */
router.put('/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const { title, description, category, is_public } = req.body;
    const userId = req.user.id;

    // Verify ownership
    const { data: template } = await supabaseAdmin
      .from('plan_templates')
      .select('owner_id, is_starter')
      .eq('id', id)
      .single();

    if (!template) {
      return res.status(404).json({ error: 'Template not found' });
    }

    if (template.is_starter) {
      return res.status(403).json({ error: 'Cannot modify starter templates' });
    }

    if (template.owner_id !== userId) {
      return res.status(403).json({ error: 'You can only update your own templates' });
    }

    const updates = {};
    if (title !== undefined) updates.title = title;
    if (description !== undefined) updates.description = description;
    if (category !== undefined) updates.category = category;
    if (is_public !== undefined) updates.is_public = is_public;
    updates.updated_at = new Date().toISOString();

    const { data: updated, error } = await supabaseAdmin
      .from('plan_templates')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      await logger.error('Failed to update template:', error);
      return res.status(500).json({ error: 'Failed to update template' });
    }

    return res.json(updated);

  } catch (error) {
    await logger.error('Update template error:', error);
    return res.status(500).json({ error: 'Failed to update template' });
  }
});

/**
 * @swagger
 * /templates/{id}:
 *   delete:
 *     summary: Delete template
 *     tags: [Templates]
 *     security:
 *       - bearerAuth: []
 */
router.delete('/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    // Verify ownership
    const { data: template } = await supabaseAdmin
      .from('plan_templates')
      .select('owner_id, is_starter')
      .eq('id', id)
      .single();

    if (!template) {
      return res.status(404).json({ error: 'Template not found' });
    }

    if (template.is_starter) {
      return res.status(403).json({ error: 'Cannot delete starter templates' });
    }

    if (template.owner_id !== userId) {
      return res.status(403).json({ error: 'You can only delete your own templates' });
    }

    const { error } = await supabaseAdmin
      .from('plan_templates')
      .delete()
      .eq('id', id);

    if (error) {
      await logger.error('Failed to delete template:', error);
      return res.status(500).json({ error: 'Failed to delete template' });
    }

    await logger.api(`Template deleted: ${id}`);

    return res.json({ success: true, message: 'Template deleted' });

  } catch (error) {
    await logger.error('Delete template error:', error);
    return res.status(500).json({ error: 'Failed to delete template' });
  }
});

/**
 * @swagger
 * /plans/from-template/{templateId}:
 *   post:
 *     summary: Create plan from template
 *     description: Create a new plan using a template structure
 *     tags: [Templates]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: templateId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               title:
 *                 type: string
 *                 description: Override template title
 *               description:
 *                 type: string
 *     responses:
 *       201:
 *         description: Plan created from template
 */
router.post('/from-template/:templateId', authenticate, async (req, res) => {
  try {
    const { templateId } = req.params;
    const { title, description } = req.body;
    const userId = req.user.id;

    // Get template
    const { data: template, error: templateError } = await supabaseAdmin
      .from('plan_templates')
      .select('*')
      .eq('id', templateId)
      .single();

    if (templateError || !template) {
      return res.status(404).json({ error: 'Template not found' });
    }

    // Check access
    if (!template.is_public && !template.is_starter && template.owner_id !== userId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Create plan
    const { data: plan, error: planError } = await supabaseAdmin
      .from('plans')
      .insert({
        title: title || template.title,
        description: description || template.description,
        status: 'draft',
        owner_id: userId
      })
      .select()
      .single();

    if (planError) {
      await logger.error('Failed to create plan from template:', planError);
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
      // Clean up plan
      await supabaseAdmin.from('plans').delete().eq('id', plan.id);
      return res.status(500).json({ error: 'Failed to create plan structure' });
    }

    // Create nodes from template structure
    if (template.structure?.phases) {
      await createNodesFromStructure(plan.id, rootNode.id, template.structure.phases);
    }

    // Increment template use count
    await supabaseAdmin
      .from('plan_templates')
      .update({ use_count: template.use_count + 1 })
      .eq('id', templateId);

    await logger.api(`Plan ${plan.id} created from template ${templateId}`);

    // Get created plan structure
    const { data: nodes } = await supabaseAdmin
      .from('plan_nodes')
      .select('*')
      .eq('plan_id', plan.id)
      .order('order_index');

    return res.status(201).json({
      plan: {
        id: plan.id,
        title: plan.title,
        description: plan.description,
        status: plan.status,
        created_at: plan.created_at
      },
      template_used: {
        id: template.id,
        title: template.title
      },
      nodes_created: nodes?.length || 0
    });

  } catch (error) {
    await logger.error('Create from template error:', error);
    return res.status(500).json({ error: 'Failed to create plan from template' });
  }
});

/**
 * Build template structure from plan nodes
 */
function buildTemplateStructure(nodes) {
  // Find root node
  const rootNode = nodes.find(n => n.node_type === 'root' || !n.parent_id);
  if (!rootNode) return { phases: [] };

  // Get phases
  const phases = nodes
    .filter(n => n.parent_id === rootNode.id && n.node_type === 'phase')
    .sort((a, b) => a.order_index - b.order_index)
    .map(phase => {
      const tasks = nodes
        .filter(n => n.parent_id === phase.id && n.node_type === 'task')
        .sort((a, b) => a.order_index - b.order_index)
        .map(task => ({
          title: task.title,
          description: task.description || '',
          context: task.context || '',
          agent_instructions: task.agent_instructions || ''
        }));

      return {
        title: phase.title,
        description: phase.description || '',
        tasks
      };
    });

  return { phases };
}

/**
 * Create nodes from template structure
 */
async function createNodesFromStructure(planId, parentId, phases) {
  for (let i = 0; i < phases.length; i++) {
    const phase = phases[i];
    
    // Create phase node
    const { data: phaseNode, error: phaseError } = await supabaseAdmin
      .from('plan_nodes')
      .insert({
        plan_id: planId,
        parent_id: parentId,
        node_type: 'phase',
        title: phase.title,
        description: phase.description,
        status: 'not_started',
        order_index: i
      })
      .select()
      .single();

    if (phaseError) {
      await logger.error('Failed to create phase node:', phaseError);
      continue;
    }

    // Create task nodes
    if (phase.tasks) {
      for (let j = 0; j < phase.tasks.length; j++) {
        const task = phase.tasks[j];
        
        // Merge acceptance_criteria into description for backward compatibility with old templates
        let taskDescription = task.description || '';
        if (task.acceptance_criteria) {
          taskDescription = taskDescription 
            ? `${taskDescription}\n\n**Acceptance Criteria:**\n${task.acceptance_criteria}`
            : task.acceptance_criteria;
        }
        
        const { error: taskError } = await supabaseAdmin
          .from('plan_nodes')
          .insert({
            plan_id: planId,
            parent_id: phaseNode.id,
            node_type: 'task',
            title: task.title,
            description: taskDescription,
            context: task.context || '',
            agent_instructions: task.agent_instructions || '',
            status: 'not_started',
            order_index: j
          });

        if (taskError) {
          await logger.error('Failed to create task node:', taskError);
        }
      }
    }
  }
}

module.exports = router;
