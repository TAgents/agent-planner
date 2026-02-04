/**
 * Decision → Knowledge Auto-capture Service
 * 
 * Automatically creates knowledge entries when decisions are resolved.
 */

const { supabaseAdmin } = require('../config/supabase');
const logger = require('../utils/logger');
const { generateEmbedding, createSearchableText, isConfigured: isEmbeddingConfigured } = require('./embedding');

/**
 * Create a knowledge entry from a resolved decision
 * 
 * @param {Object} decision - The resolved decision request
 * @param {string} planId - Plan UUID
 * @param {string} userId - User who resolved (for created_by)
 */
async function captureDecisionAsKnowledge(decision, planId, userId) {
  try {
    // Only capture decided decisions
    if (decision.status !== 'decided') {
      await logger.api(`Skipping knowledge capture - decision status is ${decision.status}`);
      return null;
    }

    // Get or create knowledge store for this plan
    const store = await getOrCreatePlanStore(planId, userId);
    if (!store) {
      await logger.error('Failed to get/create knowledge store for plan');
      return null;
    }

    // Build the knowledge entry content
    const title = `Decision: ${decision.title}`;
    const content = buildDecisionContent(decision);
    const tags = extractDecisionTags(decision);

    // Build metadata linking back to the decision
    const metadata = {
      source: 'decision_request',
      decision_id: decision.id,
      node_id: decision.node_id,
      urgency: decision.urgency,
      requested_by_agent: decision.requested_by_agent_name,
      decided_at: decision.decided_at
    };

    // Generate embedding for semantic search
    let embedding = null;
    if (isEmbeddingConfigured()) {
      const searchableText = createSearchableText({ title, content, tags });
      embedding = await generateEmbedding(searchableText);
      if (embedding) {
        await logger.api('Generated embedding for decision knowledge entry');
      }
    }

    // Create the knowledge entry
    const { data: entry, error } = await supabaseAdmin
      .from('knowledge_entries')
      .insert({
        store_id: store.id,
        entry_type: 'decision',
        title,
        content,
        tags,
        metadata,
        created_by: userId,
        embedding
      })
      .select()
      .single();

    if (error) {
      await logger.error('Failed to create decision knowledge entry:', error);
      return null;
    }

    await logger.api(`Decision captured as knowledge entry: ${entry.id} in store ${store.id}`);
    return entry;

  } catch (err) {
    await logger.error('Error in captureDecisionAsKnowledge:', err);
    return null;
  }
}

/**
 * Get or create a knowledge store for a plan
 */
async function getOrCreatePlanStore(planId, userId) {
  try {
    // Check for existing store
    const { data: existing } = await supabaseAdmin
      .from('knowledge_stores')
      .select('*')
      .eq('scope', 'plan')
      .eq('scope_id', planId)
      .single();

    if (existing) {
      return existing;
    }

    // Get plan name for store name
    const { data: plan } = await supabaseAdmin
      .from('plans')
      .select('title')
      .eq('id', planId)
      .single();

    // Create new store using upsert to handle race conditions
    const { data: newStore, error } = await supabaseAdmin
      .from('knowledge_stores')
      .upsert({
        name: `${plan?.title || 'Plan'} Knowledge`,
        description: 'Auto-created knowledge store for plan decisions and learnings',
        scope: 'plan',
        scope_id: planId
      }, { 
        onConflict: 'scope,scope_id',
        ignoreDuplicates: false 
      })
      .select()
      .single();

    if (error) {
      await logger.error('Failed to create knowledge store:', error);
      return null;
    }

    await logger.api(`Created knowledge store for plan: ${newStore.id}`);
    return newStore;

  } catch (err) {
    await logger.error('Error in getOrCreatePlanStore:', err);
    return null;
  }
}

/**
 * Build structured content from a decision
 */
function buildDecisionContent(decision) {
  const sections = [];

  // Context
  sections.push('## Context');
  sections.push(decision.context);
  sections.push('');

  // Options considered (if any)
  if (decision.options && decision.options.length > 0) {
    sections.push('## Options Considered');
    decision.options.forEach((opt, i) => {
      const recommended = opt.recommendation ? ' ⭐ (recommended)' : '';
      sections.push(`### ${i + 1}. ${opt.option}${recommended}`);
      
      if (opt.pros && opt.pros.length > 0) {
        sections.push('**Pros:**');
        opt.pros.forEach(pro => sections.push(`- ${pro}`));
      }
      
      if (opt.cons && opt.cons.length > 0) {
        sections.push('**Cons:**');
        opt.cons.forEach(con => sections.push(`- ${con}`));
      }
      sections.push('');
    });
  }

  // Decision made
  sections.push('## Decision');
  sections.push(decision.decision);
  sections.push('');

  // Rationale (if provided)
  if (decision.rationale) {
    sections.push('## Rationale');
    sections.push(decision.rationale);
  }

  return sections.join('\n');
}

/**
 * Extract relevant tags from a decision
 */
function extractDecisionTags(decision) {
  const tags = ['decision'];
  
  // Add urgency as tag
  if (decision.urgency) {
    tags.push(decision.urgency);
  }
  
  // Add agent tag if requested by agent
  if (decision.requested_by_agent_name) {
    tags.push('agent-requested');
  }
  
  // Extract simple keywords from title (basic extraction)
  const titleWords = decision.title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .split(/\s+/)
    .filter(w => w.length > 3 && !['the', 'and', 'for', 'with', 'this', 'that', 'from'].includes(w))
    .slice(0, 3);
  
  tags.push(...titleWords);
  
  return [...new Set(tags)]; // Deduplicate
}

module.exports = {
  captureDecisionAsKnowledge,
  getOrCreatePlanStore,
  buildDecisionContent,
  extractDecisionTags
};
