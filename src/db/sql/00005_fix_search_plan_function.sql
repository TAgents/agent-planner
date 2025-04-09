-- Fix the search_plan function to resolve ambiguous column references
CREATE OR REPLACE FUNCTION search_plan(
    input_plan_id UUID,
    search_query TEXT
) RETURNS TABLE (
    id UUID,
    type TEXT,
    title TEXT,
    content TEXT,
    created_at TIMESTAMPTZ,
    user_id UUID
) AS $$
BEGIN
    -- Return matching nodes
    RETURN QUERY
    SELECT 
        n.id,
        'node'::TEXT as type,
        n.title,
        n.description as content,
        n.created_at,
        p.owner_id as user_id
    FROM 
        plan_nodes n
    JOIN 
        plans p ON n.plan_id = p.id
    WHERE 
        n.plan_id = input_plan_id AND
        (
            n.title ILIKE '%' || search_query || '%' OR
            n.description ILIKE '%' || search_query || '%' OR
            n.context ILIKE '%' || search_query || '%' OR
            n.agent_instructions ILIKE '%' || search_query || '%' OR
            n.acceptance_criteria ILIKE '%' || search_query || '%'
        );
    
    -- Return matching comments
    RETURN QUERY
    SELECT 
        c.id,
        'comment'::TEXT as type,
        'Comment on ' || n.title as title,
        c.content,
        c.created_at,
        c.user_id
    FROM 
        plan_comments c
    JOIN 
        plan_nodes n ON c.plan_node_id = n.id
    WHERE 
        n.plan_id = input_plan_id AND
        c.content ILIKE '%' || search_query || '%';
    
    -- Return matching logs
    RETURN QUERY
    SELECT 
        l.id,
        'log'::TEXT as type,
        'Log for ' || n.title as title,
        l.content,
        l.created_at,
        l.user_id
    FROM 
        plan_node_logs l
    JOIN 
        plan_nodes n ON l.plan_node_id = n.id
    WHERE 
        n.plan_id = input_plan_id AND
        l.content ILIKE '%' || search_query || '%';
    
    -- Return matching artifacts
    RETURN QUERY
    SELECT 
        a.id,
        'artifact'::TEXT as type,
        a.name as title,
        a.url as content,
        a.created_at,
        a.created_by as user_id
    FROM 
        plan_node_artifacts a
    JOIN 
        plan_nodes n ON a.plan_node_id = n.id
    WHERE 
        n.plan_id = input_plan_id AND
        a.name ILIKE '%' || search_query || '%';
END;
$$ LANGUAGE plpgsql;
