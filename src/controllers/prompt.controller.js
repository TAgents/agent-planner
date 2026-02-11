const { supabaseAdmin: supabase } = require('../config/supabase');
const logger = require('../utils/logger');

/**
 * List prompt templates (user's own + plan-specific)
 */
const listPrompts = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { plan_id, type } = req.query;

    let query = supabase
      .from('prompt_templates')
      .select('*')
      .or(`user_id.eq.${userId},is_default.eq.true`);

    if (plan_id) {
      query = query.or(`plan_id.eq.${plan_id},plan_id.is.null`);
    }
    if (type) {
      query = query.eq('type', type);
    }

    const { data, error } = await query.order('created_at', { ascending: false });

    if (error) {
      await logger.error('Failed to list prompts', error);
      return res.status(500).json({ error: 'Failed to list prompts' });
    }

    res.json(data || []);
  } catch (error) {
    await logger.error('Unexpected error in listPrompts', error);
    next(error);
  }
};

/**
 * Create a prompt template
 */
const createPrompt = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { name, template, description, type = 'custom', plan_id, variables = [] } = req.body;

    if (!name || !template) {
      return res.status(400).json({ error: 'name and template are required' });
    }

    const { data, error } = await supabase
      .from('prompt_templates')
      .insert({
        user_id: userId,
        plan_id: plan_id || null,
        name,
        template,
        description: description || null,
        type,
        variables,
      })
      .select()
      .single();

    if (error) {
      await logger.error('Failed to create prompt', error);
      return res.status(500).json({ error: 'Failed to create prompt' });
    }

    res.status(201).json(data);
  } catch (error) {
    await logger.error('Unexpected error in createPrompt', error);
    next(error);
  }
};

/**
 * Update a prompt template
 */
const updatePrompt = async (req, res, next) => {
  try {
    const { promptId } = req.params;
    const userId = req.user.id;
    const { name, template, description, type, variables } = req.body;

    const updateData = { updated_at: new Date().toISOString() };
    if (name !== undefined) updateData.name = name;
    if (template !== undefined) updateData.template = template;
    if (description !== undefined) updateData.description = description;
    if (type !== undefined) updateData.type = type;
    if (variables !== undefined) updateData.variables = variables;

    const { data, error } = await supabase
      .from('prompt_templates')
      .update(updateData)
      .eq('id', promptId)
      .eq('user_id', userId)
      .select()
      .single();

    if (error) {
      await logger.error('Failed to update prompt', error);
      return res.status(500).json({ error: 'Failed to update prompt' });
    }

    res.json(data);
  } catch (error) {
    await logger.error('Unexpected error in updatePrompt', error);
    next(error);
  }
};

/**
 * Delete a prompt template
 */
const deletePrompt = async (req, res, next) => {
  try {
    const { promptId } = req.params;
    const userId = req.user.id;

    const { error } = await supabase
      .from('prompt_templates')
      .delete()
      .eq('id', promptId)
      .eq('user_id', userId);

    if (error) {
      await logger.error('Failed to delete prompt', error);
      return res.status(500).json({ error: 'Failed to delete prompt' });
    }

    res.status(204).send();
  } catch (error) {
    await logger.error('Unexpected error in deletePrompt', error);
    next(error);
  }
};

module.exports = {
  listPrompts,
  createPrompt,
  updatePrompt,
  deletePrompt
};
