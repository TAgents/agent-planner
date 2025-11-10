-- Create node_assignments table for tracking user assignments to nodes
CREATE TABLE IF NOT EXISTS node_assignments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    node_id UUID NOT NULL REFERENCES plan_nodes(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    assigned_by UUID NOT NULL REFERENCES auth.users(id),
    assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    -- Ensure a user can only be assigned once to a node
    UNIQUE(node_id, user_id)
);

-- Create indexes for performance
CREATE INDEX idx_node_assignments_node_id ON node_assignments(node_id);
CREATE INDEX idx_node_assignments_user_id ON node_assignments(user_id);
CREATE INDEX idx_node_assignments_assigned_at ON node_assignments(assigned_at);

-- Create a view to get assignments with user details
CREATE OR REPLACE VIEW node_assignments_with_users AS
SELECT 
    na.id,
    na.node_id,
    na.user_id,
    na.assigned_by,
    na.assigned_at,
    u.email as user_email,
    u.raw_user_meta_data->>'name' as user_name,
    ab.email as assigned_by_email,
    ab.raw_user_meta_data->>'name' as assigned_by_name
FROM node_assignments na
JOIN auth.users u ON na.user_id = u.id
JOIN auth.users ab ON na.assigned_by = ab.id;

-- Function to check if a user can be assigned to a node
-- (User must be a collaborator on the plan)
CREATE OR REPLACE FUNCTION can_assign_user_to_node(
    p_node_id UUID,
    p_user_id UUID
) RETURNS BOOLEAN AS $$
DECLARE
    v_plan_id UUID;
    v_is_collaborator BOOLEAN;
BEGIN
    -- Get the plan_id from the node
    SELECT plan_id INTO v_plan_id
    FROM plan_nodes
    WHERE id = p_node_id;
    
    IF v_plan_id IS NULL THEN
        RETURN FALSE;
    END IF;
    
    -- Check if user is owner or collaborator
    SELECT EXISTS (
        SELECT 1 FROM plans WHERE id = v_plan_id AND owner_id = p_user_id
        UNION
        SELECT 1 FROM plan_collaborators WHERE plan_id = v_plan_id AND user_id = p_user_id
    ) INTO v_is_collaborator;
    
    RETURN v_is_collaborator;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- RLS policies for node_assignments
ALTER TABLE node_assignments ENABLE ROW LEVEL SECURITY;

-- Users can view assignments for nodes in plans they have access to
CREATE POLICY "Users can view node assignments" ON node_assignments
    FOR SELECT USING (
        node_id IN (
            SELECT pn.id 
            FROM plan_nodes pn
            JOIN plans p ON pn.plan_id = p.id
            WHERE p.owner_id = auth.uid()
            OR p.id IN (
                SELECT plan_id FROM plan_collaborators WHERE user_id = auth.uid()
            )
        )
    );

-- Users can create assignments for nodes in plans they own or have admin/editor role
CREATE POLICY "Users can create node assignments" ON node_assignments
    FOR INSERT WITH CHECK (
        node_id IN (
            SELECT pn.id 
            FROM plan_nodes pn
            JOIN plans p ON pn.plan_id = p.id
            WHERE p.owner_id = auth.uid()
            OR p.id IN (
                SELECT plan_id FROM plan_collaborators 
                WHERE user_id = auth.uid() 
                AND role IN ('admin', 'editor')
            )
        )
        AND can_assign_user_to_node(node_id, user_id)
    );

-- Users can delete assignments for nodes in plans they own or have admin/editor role
CREATE POLICY "Users can delete node assignments" ON node_assignments
    FOR DELETE USING (
        node_id IN (
            SELECT pn.id 
            FROM plan_nodes pn
            JOIN plans p ON pn.plan_id = p.id
            WHERE p.owner_id = auth.uid()
            OR p.id IN (
                SELECT plan_id FROM plan_collaborators 
                WHERE user_id = auth.uid() 
                AND role IN ('admin', 'editor')
            )
        )
    );
